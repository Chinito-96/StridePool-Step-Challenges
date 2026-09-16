import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import app from "../app";
import { createSession } from "../lib/auth";
import {
  dailyStepRecordsTable,
  db,
  healthSourceConnectionsTable,
  pool,
  sessionsTable,
  stepSourceSamplesTable,
  usersTable,
} from "@workspace/db";
import { and, eq, inArray, isNull } from "drizzle-orm";

const runId = `source-ingestion-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const userId = `${runId}-user`;
const secondUserId = `${runId}-second-user`;
const today = new Date().toISOString().slice(0, 10);

type ApiResult = {
  status: number;
  body: unknown;
};

type IngestResponse = {
  source: string;
  acceptedCount: number;
  pendingReviewCount: number;
  steps: number;
  samples: Array<{
    sourceSampleId: string;
    verificationStatus: string;
    reviewFlags: string[];
  }>;
};

let server: Server | undefined;
let baseUrl = "";
let session = "";
let secondSession = "";

function dateDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function sample(
  sourceSampleId: string,
  overrides: Partial<{
    recordDate: string;
    steps: number;
    startTime: string;
    endTime: string;
    recordedAt: string | null;
    rawPayload: Record<string, unknown>;
  }> = {},
) {
  const recordDate = overrides.recordDate ?? today;
  return {
    sourceSampleId,
    recordDate,
    steps: overrides.steps ?? 800,
    startTime: overrides.startTime ?? `${recordDate}T08:00:00.000Z`,
    endTime: overrides.endTime ?? `${recordDate}T08:30:00.000Z`,
    recordedAt: overrides.recordedAt === undefined
      ? `${recordDate}T08:31:00.000Z`
      : overrides.recordedAt,
    rawPayload: overrides.rawPayload ?? { provider: "test", sourceSampleId },
  };
}

async function request(
  path: string,
  options: RequestInit = {},
  sessionId = session,
): Promise<ApiResult> {
  const { headers, ...init } = options;
  const requestHeaders = new Headers(headers);
  requestHeaders.set("cookie", `sid=${sessionId}`);
  if (init.body && !requestHeaders.has("content-type")) {
    requestHeaders.set("content-type", "application/json");
  }

  const response = await fetch(`${baseUrl}/api${path}`, {
    ...init,
    headers: requestHeaders,
  });
  const text = await response.text();
  const isJson = response.headers.get("content-type")?.includes("application/json");
  return {
    status: response.status,
    body: text ? (isJson ? JSON.parse(text) : text) : null,
  };
}

async function ingest(
  source: "apple_health" | "health_connect",
  samples: ReturnType<typeof sample>[],
  sessionId = session,
): Promise<IngestResponse> {
  const result = await request(`/stridepool/sources/${source}/samples`, {
    method: "POST",
    body: JSON.stringify({ samples }),
  }, sessionId);
  assert.equal(result.status, 200);
  return result.body as IngestResponse;
}

describe("StridePool source sample ingestion", () => {
  before(async () => {
    await db.insert(usersTable).values({
      id: userId,
      email: `${userId}@example.test`,
      displayName: "Source Ingestion Test",
    });
    await db.insert(usersTable).values({
      id: secondUserId,
      email: `${secondUserId}@example.test`,
      displayName: "Second Source Ingestion Test",
    });
    session = await createSession({
      user: {
        id: userId,
        email: `${userId}@example.test`,
        firstName: "Source",
        lastName: "Ingestion",
        profileImageUrl: null,
      },
      access_token: "test-access-token",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    });
    secondSession = await createSession({
      user: {
        id: secondUserId,
        email: `${secondUserId}@example.test`,
        firstName: "Second",
        lastName: "Ingestion",
        profileImageUrl: null,
      },
      access_token: "second-test-access-token",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    });

    const listeningServer = app.listen(0);
    server = listeningServer;
    await new Promise<void>((resolve, reject) => {
      listeningServer.once("listening", resolve);
      listeningServer.once("error", reject);
    });
    const address = listeningServer.address();
    if (!address || typeof address === "string") {
      throw new Error("The source ingestion test server did not expose a TCP address.");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await db.delete(stepSourceSamplesTable).where(eq(stepSourceSamplesTable.userId, userId));
    await db.delete(stepSourceSamplesTable).where(eq(stepSourceSamplesTable.userId, secondUserId));
    await db.delete(dailyStepRecordsTable).where(eq(dailyStepRecordsTable.userId, userId));
    await db.delete(dailyStepRecordsTable).where(eq(dailyStepRecordsTable.userId, secondUserId));
    await db.delete(healthSourceConnectionsTable).where(eq(healthSourceConnectionsTable.userId, userId));
    await db.delete(healthSourceConnectionsTable).where(eq(healthSourceConnectionsTable.userId, secondUserId));
    await db.delete(sessionsTable).where(eq(sessionsTable.sid, session));
    await db.delete(sessionsTable).where(eq(sessionsTable.sid, secondSession));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
    await db.delete(usersTable).where(eq(usersTable.id, secondUserId));
    await pool.end();
  });

  it("rejects legacy manual, CSV, and demo ingestion routes", async () => {
    for (const source of ["manual", "csv_import", "demo"]) {
      const result = await request(`/stridepool/sources/${source}/samples`, {
        method: "POST",
        body: JSON.stringify({ samples: [sample(`${source}-sample`)] }),
      });
      assert.equal(result.status, 400);
    }

    const legacySync = await request("/stridepool/sync", {
      method: "POST",
      body: JSON.stringify({ source: "manual", steps: 4_321 }),
    });
    assert.equal(legacySync.status, 404);
  });

  it("normalizes Apple Health samples and makes duplicate uploads idempotent", async () => {
    const firstSample = sample("apple-sample-1", {
      steps: 1_200,
      rawPayload: {
        source: "Apple Health",
        quantity: "stepCount",
        originalUnit: "count",
      },
    });
    const first = await ingest("apple_health", [firstSample, firstSample]);

    assert.equal(first.source, "apple_health");
    assert.equal(first.acceptedCount, 1);
    assert.equal(first.pendingReviewCount, 0);
    assert.equal(first.steps, 1_200);
    assert.deepEqual(first.samples, [{
      sourceSampleId: "apple-sample-1",
      verificationStatus: "verified",
      reviewFlags: [],
    }]);

    const [stored] = await db.select().from(stepSourceSamplesTable).where(and(
      eq(stepSourceSamplesTable.userId, userId),
      eq(stepSourceSamplesTable.source, "apple_health"),
      eq(stepSourceSamplesTable.sourceSampleId, "apple-sample-1"),
    ));
    assert.ok(stored);
    assert.equal(stored.recordDate, today);
    assert.equal(stored.steps, 1_200);
    assert.deepEqual(stored.rawPayload, firstSample.rawPayload);
    assert.equal(stored.verificationStatus, "verified");

    const duplicate = await ingest("apple_health", [firstSample]);
    assert.equal(duplicate.acceptedCount, 0);
    assert.equal(duplicate.pendingReviewCount, 0);
    assert.deepEqual(duplicate.samples, []);
    assert.equal(duplicate.steps, 1_200);

    const storedRows = await db.select({ id: stepSourceSamplesTable.id })
      .from(stepSourceSamplesTable)
      .where(and(
        eq(stepSourceSamplesTable.userId, userId),
        eq(stepSourceSamplesTable.source, "apple_health"),
        eq(stepSourceSamplesTable.sourceSampleId, "apple-sample-1"),
      ));
    assert.equal(storedRows.length, 1);
  });

  it("normalizes Health Connect samples and scopes idempotency by source", async () => {
    const result = await ingest("health_connect", [sample("health-connect-sample-1", {
      steps: 900,
      rawPayload: {
        source: "Health Connect",
        dataOrigin: "com.example.walking",
        recordType: "StepsRecord",
      },
    })]);

    assert.equal(result.source, "health_connect");
    assert.equal(result.acceptedCount, 1);
    assert.equal(result.pendingReviewCount, 0);
    assert.equal(result.steps, 2_100);

    const [stored] = await db.select().from(stepSourceSamplesTable).where(and(
      eq(stepSourceSamplesTable.userId, userId),
      eq(stepSourceSamplesTable.source, "health_connect"),
      eq(stepSourceSamplesTable.sourceSampleId, "health-connect-sample-1"),
    ));
    assert.ok(stored);
    assert.equal(stored.recordDate, today);
    assert.equal(stored.steps, 900);
    assert.deepEqual(stored.rawPayload, {
      source: "Health Connect",
      dataOrigin: "com.example.walking",
      recordType: "StepsRecord",
    });
    assert.equal(stored.verificationStatus, "verified");

    const duplicate = await ingest("health_connect", [sample("health-connect-sample-1", { steps: 999 })]);
    assert.equal(duplicate.acceptedCount, 0);
    assert.deepEqual(duplicate.samples, []);

    const [sameIdDifferentSource] = await db.select({ id: stepSourceSamplesTable.id })
      .from(stepSourceSamplesTable)
      .where(and(
        eq(stepSourceSamplesTable.userId, userId),
        eq(stepSourceSamplesTable.sourceSampleId, "health-connect-sample-1"),
      ));
    assert.ok(sameIdDifferentSource);
  });

  it("flags burst, backfilled, per-sample, and aggregate daily anomalies", async () => {
    const burst = sample("burst-sample", {
      steps: 1_501,
      startTime: `${today}T10:00:00.000Z`,
      endTime: `${today}T10:04:00.000Z`,
      recordedAt: `${today}T10:05:00.000Z`,
    });
    const backfilledDate = dateDaysAgo(3);
    const backfilled = sample("backfilled-sample", {
      recordDate: backfilledDate,
      steps: 500,
      recordedAt: `${today}T10:00:00.000Z`,
    });
    const perSampleDate = dateDaysAgo(4);
    const perSample = sample("per-sample-total-sample", {
      recordDate: perSampleDate,
      steps: 60_001,
    });

    const flagged = await ingest("health_connect", [burst, backfilled, perSample]);
    assert.equal(flagged.acceptedCount, 3);
    assert.equal(flagged.pendingReviewCount, 3);
    assert.deepEqual(flagged.samples.map((item) => item.reviewFlags), [
      ["burst_rate"],
      ["backfilled_data"],
      ["implausible_sample_total", "implausible_daily_total"],
    ]);

    const baseline = await ingest("health_connect", [sample("daily-baseline", {
      recordDate: dateDaysAgo(5),
      steps: 59_000,
    })]);
    assert.equal(baseline.pendingReviewCount, 0);

    const aggregate = await ingest("health_connect", [sample("daily-overage", {
      recordDate: dateDaysAgo(5),
      steps: 2_000,
    })]);
    assert.equal(aggregate.pendingReviewCount, 1);
    assert.deepEqual(aggregate.samples[0]?.reviewFlags, ["implausible_daily_total"]);

    const [overageStored] = await db.select().from(stepSourceSamplesTable).where(and(
      eq(stepSourceSamplesTable.userId, userId),
      eq(stepSourceSamplesTable.sourceSampleId, "daily-overage"),
    ));
    assert.ok(overageStored);
    assert.equal(overageStored.verificationStatus, "pending_review");
    assert.deepEqual(overageStored.reviewFlags, ["implausible_daily_total"]);
  });

  it("rebuilds daily totals from verified samples only", async () => {
    const recordDate = dateDaysAgo(6);
    const verified = await ingest("apple_health", [sample("verified-daily-sample", {
      recordDate,
      steps: 1_000,
    })]);
    assert.equal(verified.pendingReviewCount, 0);

    const pending = await ingest("apple_health", [sample("pending-daily-sample", {
      recordDate,
      steps: 1_600,
      startTime: `${recordDate}T12:00:00.000Z`,
      endTime: `${recordDate}T12:04:00.000Z`,
      recordedAt: `${recordDate}T12:05:00.000Z`,
    })]);
    assert.equal(pending.pendingReviewCount, 1);
    assert.deepEqual(pending.samples[0]?.reviewFlags, ["burst_rate"]);

    const [dailyRecord] = await db.select().from(dailyStepRecordsTable).where(and(
      eq(dailyStepRecordsTable.userId, userId),
      isNull(dailyStepRecordsTable.challengeId),
      eq(dailyStepRecordsTable.recordDate, recordDate),
    ));
    assert.ok(dailyRecord);
    assert.equal(dailyRecord.steps, 1_000);
    assert.equal(dailyRecord.verified, true);

    const samples = await db.select({
      sourceSampleId: stepSourceSamplesTable.sourceSampleId,
      verificationStatus: stepSourceSamplesTable.verificationStatus,
    }).from(stepSourceSamplesTable).where(and(
      eq(stepSourceSamplesTable.userId, userId),
      inArray(stepSourceSamplesTable.sourceSampleId, ["verified-daily-sample", "pending-daily-sample"]),
    ));
    assert.deepEqual(samples.sort((a, b) => a.sourceSampleId.localeCompare(b.sourceSampleId)), [
      { sourceSampleId: "pending-daily-sample", verificationStatus: "pending_review" },
      { sourceSampleId: "verified-daily-sample", verificationStatus: "verified" },
    ]);
  });

  it("isolates overlapping source IDs, daily totals, and review queues by account", async () => {
    const beforeUserA = (await request("/stridepool/bootstrap")).body as {
      steps: number;
      healthSources: Array<{ source: string; verifiedSamples: number; pendingReview: number }>;
    };
    const beforeUserB = (await request("/stridepool/bootstrap", {}, secondSession)).body as {
      steps: number;
      healthSources: Array<{ source: string; verifiedSamples: number; pendingReview: number }>;
    };
    const beforeUserASamples = await db.select({
      steps: stepSourceSamplesTable.steps,
    }).from(stepSourceSamplesTable).where(and(
      eq(stepSourceSamplesTable.userId, userId),
      eq(stepSourceSamplesTable.recordDate, today),
      eq(stepSourceSamplesTable.verificationStatus, "verified"),
    ));
    const beforeUserBSamples = await db.select({
      steps: stepSourceSamplesTable.steps,
    }).from(stepSourceSamplesTable).where(and(
      eq(stepSourceSamplesTable.userId, secondUserId),
      eq(stepSourceSamplesTable.recordDate, today),
      eq(stepSourceSamplesTable.verificationStatus, "verified"),
    ));
    const beforeUserASourceSteps = beforeUserASamples.reduce((total, sample) => total + sample.steps, 0);
    const beforeUserBSourceSteps = beforeUserBSamples.reduce((total, sample) => total + sample.steps, 0);
    const sharedSampleId = "shared-account-sample";
    const userAPendingSampleId = "user-a-pending-sample";
    const userBPendingSampleId = "user-b-pending-sample";
    const pendingDate = dateDaysAgo(1);
    const fullDayStart = `${today}T00:00:00.000Z`;
    const fullDayEnd = `${today}T23:59:00.000Z`;

    const userAApple = await ingest("apple_health", [sample(sharedSampleId, {
      steps: 1_000,
      startTime: fullDayStart,
      endTime: fullDayEnd,
      recordedAt: fullDayEnd,
    })]);
    const userBApple = await ingest("apple_health", [sample(sharedSampleId, {
      steps: 59_500,
      startTime: fullDayStart,
      endTime: fullDayEnd,
      recordedAt: fullDayEnd,
    })], secondSession);
    const userAHealthConnect = await ingest("health_connect", [sample(sharedSampleId, {
      steps: 700,
      startTime: fullDayStart,
      endTime: fullDayEnd,
      recordedAt: fullDayEnd,
    })]);
    const userBHealthConnect = await ingest("health_connect", [sample(sharedSampleId, {
      steps: 800,
      startTime: fullDayStart,
      endTime: fullDayEnd,
      recordedAt: fullDayEnd,
    })], secondSession);

    assert.equal(userAApple.acceptedCount, 1);
    assert.equal(userAApple.samples[0]?.verificationStatus, "verified");
    assert.equal(userBApple.acceptedCount, 1);
    assert.equal(userBApple.samples[0]?.verificationStatus, "verified");
    assert.equal(userAHealthConnect.acceptedCount, 1);
    assert.equal(userBHealthConnect.acceptedCount, 1);
    assert.equal(userBHealthConnect.samples[0]?.verificationStatus, "pending_review");

    const userAPending = await ingest("apple_health", [sample(userAPendingSampleId, {
      recordDate: pendingDate,
      steps: 1_600,
      startTime: `${pendingDate}T12:00:00.000Z`,
      endTime: `${pendingDate}T12:04:00.000Z`,
      recordedAt: `${pendingDate}T12:05:00.000Z`,
    })]);
    const userBPending = await ingest("apple_health", [sample(userBPendingSampleId, {
      recordDate: pendingDate,
      steps: 1_700,
      startTime: `${pendingDate}T12:00:00.000Z`,
      endTime: `${pendingDate}T12:04:00.000Z`,
      recordedAt: `${pendingDate}T12:05:00.000Z`,
    })], secondSession);
    assert.equal(userAPending.acceptedCount, 1);
    assert.equal(userAPending.samples[0]?.verificationStatus, "pending_review");
    assert.equal(userBPending.acceptedCount, 1);
    assert.equal(userBPending.samples[0]?.verificationStatus, "pending_review");

    const duplicateUserAApple = await ingest("apple_health", [sample(sharedSampleId, { steps: 9_999 })]);
    const duplicateUserBApple = await ingest("apple_health", [sample(sharedSampleId, { steps: 9_999 })], secondSession);
    const duplicateUserAHealthConnect = await ingest("health_connect", [sample(sharedSampleId, { steps: 9_999 })]);
    const duplicateUserBHealthConnect = await ingest("health_connect", [sample(sharedSampleId, { steps: 9_999 })], secondSession);
    assert.equal(duplicateUserAApple.acceptedCount, 0);
    assert.equal(duplicateUserBApple.acceptedCount, 0);
    assert.equal(duplicateUserAHealthConnect.acceptedCount, 0);
    assert.equal(duplicateUserBHealthConnect.acceptedCount, 0);

    const userABootstrap = (await request("/stridepool/bootstrap")).body as {
      steps: number;
      stepReviews: Array<{ sourceSampleId: string }>;
      healthSources: Array<{ source: string; verifiedSamples: number; pendingReview: number }>;
    };
    const userBBootstrap = (await request("/stridepool/bootstrap", {}, secondSession)).body as {
      steps: number;
      stepReviews: Array<{ sourceSampleId: string }>;
      healthSources: Array<{ source: string; verifiedSamples: number; pendingReview: number }>;
    };

    assert.equal(userAApple.steps, beforeUserASourceSteps + 1_000);
    assert.equal(userAHealthConnect.steps, beforeUserASourceSteps + 1_700);
    assert.equal(userBApple.steps, beforeUserBSourceSteps + 59_500);
    assert.equal(userBHealthConnect.steps, beforeUserBSourceSteps + 59_500);
    assert.equal(userABootstrap.steps, userAHealthConnect.steps);
    assert.equal(userBBootstrap.steps, userBHealthConnect.steps);
    assert.ok(userABootstrap.stepReviews.some((review) => review.sourceSampleId === userAPendingSampleId));
    assert.ok(!userABootstrap.stepReviews.some((review) => review.sourceSampleId === userBPendingSampleId));
    assert.ok(userBBootstrap.stepReviews.some((review) => review.sourceSampleId === userBPendingSampleId));
    assert.ok(!userBBootstrap.stepReviews.some((review) => review.sourceSampleId === userAPendingSampleId));
    assert.deepEqual(
      userABootstrap.healthSources.map(({ source, verifiedSamples, pendingReview }) => ({ source, verifiedSamples, pendingReview })),
      beforeUserA.healthSources.map(({ source, verifiedSamples, pendingReview }) => ({
        source,
        verifiedSamples: verifiedSamples + 1,
        pendingReview: pendingReview + (source === "apple_health" ? 1 : 0),
      })),
    );
    assert.deepEqual(
      userBBootstrap.healthSources.map(({ source, verifiedSamples, pendingReview }) => ({ source, verifiedSamples, pendingReview })),
      beforeUserB.healthSources.map(({ source, verifiedSamples, pendingReview }) => ({
        source,
        verifiedSamples: verifiedSamples + (source === "apple_health" ? 1 : 0),
        pendingReview: pendingReview + 1,
      })),
    );

    const storedSharedSamples = await db.select({
      userId: stepSourceSamplesTable.userId,
      source: stepSourceSamplesTable.source,
      sourceSampleId: stepSourceSamplesTable.sourceSampleId,
    }).from(stepSourceSamplesTable).where(and(
      inArray(stepSourceSamplesTable.userId, [userId, secondUserId]),
      inArray(stepSourceSamplesTable.sourceSampleId, [sharedSampleId, userAPendingSampleId, userBPendingSampleId]),
    ));
    assert.equal(storedSharedSamples.length, 6);
    assert.equal(new Set(storedSharedSamples.map((row) => `${row.userId}:${row.source}:${row.sourceSampleId}`)).size, 6);
  });

  it("records denied, stale, and revoked native permission states", async () => {
    const denied = await request("/stridepool/sources/apple_health/connection", {
      method: "POST",
      body: JSON.stringify({ status: "denied" }),
    });
    assert.equal(denied.status, 200);
    assert.equal((denied.body as { status: string }).status, "denied");

    const deniedSources = await request("/stridepool/sources");
    assert.equal((deniedSources.body as { sources: Array<{ source: string; status: string }> }).sources.find((item) => item.source === "apple_health")?.status, "denied");

    const connected = await request("/stridepool/sources/apple_health/connection", {
      method: "POST",
      body: JSON.stringify({ status: "connected" }),
    });
    assert.equal(connected.status, 200);
    await db.update(healthSourceConnectionsTable).set({
      lastSyncedAt: new Date(Date.now() - 37 * 60 * 60 * 1000),
    }).where(and(eq(healthSourceConnectionsTable.userId, userId), eq(healthSourceConnectionsTable.source, "apple_health")));
    const staleSources = await request("/stridepool/sources");
    assert.equal((staleSources.body as { sources: Array<{ source: string; status: string }> }).sources.find((item) => item.source === "apple_health")?.status, "stale");

    const revoked = await request("/stridepool/sources/apple_health/connection", {
      method: "POST",
      body: JSON.stringify({ status: "revoked" }),
    });
    assert.equal(revoked.status, 200);
    const revokedSources = await request("/stridepool/sources");
    assert.equal((revokedSources.body as { sources: Array<{ source: string; status: string }> }).sources.find((item) => item.source === "apple_health")?.status, "revoked");
  });
});