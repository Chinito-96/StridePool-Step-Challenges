import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import app from "../app";
import { createSession } from "../lib/auth";
import {
  challengesTable,
  dailyStepRecordsTable,
  db,
  entriesTable,
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
const sharedChallengeId = `${runId}-shared-challenge`;
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
    await db.delete(challengesTable).where(eq(challengesTable.id, sharedChallengeId));
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

  it("records failed delivery, keeps verified steps unchanged, and clears the failure after retry", async () => {
    const before = (await request("/stridepool/bootstrap")).body as { steps: number };
    const sourceBefore = (await request("/stridepool/sources")).body as { sources: Array<{ source: string; lastSyncedAt: string | null }> };
    const previousSuccess = sourceBefore.sources.find((item) => item.source === "apple_health")?.lastSyncedAt ?? null;
    const failure = await request("/stridepool/sources/apple_health/delivery", {
      method: "POST",
      body: JSON.stringify({ outcome: "failure", reason: "offline" }),
    });
    assert.equal(failure.status, 200);
    const failedSource = failure.body as { lastAttemptedAt: string; lastSyncedAt: string | null; deliveryFailure: string; nextRetryAt: string };
    assert.equal(failedSource.deliveryFailure, "offline");
    assert.ok(failedSource.lastAttemptedAt);
    assert.ok(failedSource.nextRetryAt);
    assert.equal(failedSource.lastSyncedAt, previousSuccess);
    assert.equal(((await request("/stridepool/bootstrap")).body as { steps: number }).steps, before.steps);

    const invalid = await request("/stridepool/sources/apple_health/delivery", {
      method: "POST",
      body: JSON.stringify({ outcome: "failure" }),
    });
    assert.equal(invalid.status, 400);

    const duplicate = await ingest("apple_health", [sample("apple-sample-1")]);
    assert.equal(duplicate.acceptedCount, 0);
    const success = await request("/stridepool/sources/apple_health/delivery", {
      method: "POST",
      body: JSON.stringify({ outcome: "success" }),
    });
    assert.equal(success.status, 200);
    const recovered = success.body as { deliveryFailure: null; nextRetryAt: null; lastSyncedAt: string };
    assert.equal(recovered.deliveryFailure, null);
    assert.equal(recovered.nextRetryAt, null);
    assert.ok(recovered.lastSyncedAt);
    assert.equal(((await request("/stridepool/bootstrap")).body as { steps: number }).steps, before.steps);

    const delayed = await request("/stridepool/sources/apple_health/delivery", {
      method: "POST",
      body: JSON.stringify({ outcome: "failure", reason: "offline", attemptedAt: new Date(Date.now() - 60000).toISOString() }),
    });
    assert.equal(delayed.status, 200);
    assert.equal((delayed.body as { deliveryFailure: null }).deliveryFailure, null);
  });

  it("retries a partial multi-day delivery without advancing the successful cursor", async () => {
    const source = "health_connect";
    const first = sample("multi-day-first", { recordDate: dateDaysAgo(20), steps: 320 });
    const later = sample("multi-day-later", { recordDate: dateDaysAgo(19), steps: 410 });
    const before = (await request("/stridepool/sources")).body as { sources: Array<{ source: string; lastSyncedAt: string | null }> };
    const cursor = before.sources.find((item) => item.source === source)?.lastSyncedAt ?? null;

    assert.equal((await ingest(source, [first])).acceptedCount, 1);
    const partial = (await request("/stridepool/sources")).body as { sources: Array<{ source: string; lastSyncedAt: string | null }> };
    assert.equal(partial.sources.find((item) => item.source === source)?.lastSyncedAt ?? null, cursor);
    const interrupted = await request(`/stridepool/sources/${source}/samples`, {
      method: "POST",
      body: JSON.stringify({ samples: [{ ...later, steps: -1 }] }),
    });
    assert.equal(interrupted.status, 400);
    const failed = await request(`/stridepool/sources/${source}/delivery`, {
      method: "POST",
      body: JSON.stringify({ outcome: "failure", reason: "upload_failed" }),
    });
    assert.equal(failed.status, 200);
    assert.equal((failed.body as { lastSyncedAt: string | null }).lastSyncedAt, cursor);

    // The next read includes both IDs; the first batch must not count twice.
    const retry = await ingest(source, [first, later]);
    assert.equal(retry.acceptedCount, 1);
    const done = await request(`/stridepool/sources/${source}/delivery`, {
      method: "POST",
      body: JSON.stringify({ outcome: "success" }),
    });
    assert.equal(done.status, 200);
    assert.equal((done.body as { deliveryFailure: null }).deliveryFailure, null);
    const rows = await db.select().from(stepSourceSamplesTable).where(and(
      eq(stepSourceSamplesTable.userId, userId),
      eq(stepSourceSamplesTable.source, source),
      inArray(stepSourceSamplesTable.sourceSampleId, [first.sourceSampleId, later.sourceSampleId]),
    ));
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row.steps).sort((a, b) => a - b), [320, 410]);
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

  it("keeps mirrored challenge records and leaderboard progress account-scoped for shared health IDs", async () => {
    // Use days untouched by the personal-total fixtures, within the same free challenge.
    const recordDate = dateDaysAgo(2);
    const pendingOnlyDate = dateDaysAgo(1);
    await db.insert(challengesTable).values({
      id: sharedChallengeId,
      name: "Shared health ID isolation",
      theme: "Test",
      level: "Open",
      startDate: recordDate,
      endDate: today,
      days: 3,
      dailyGoal: 1_000,
      entryFee: "0",
      participantCount: 2,
      color: "#000000",
      community: true,
    });
    // Participants enrolled before this historical challenge started;
    // the public join endpoint correctly rejects late enrollment.
    await db.insert(entriesTable).values([userId, secondUserId].map((id) => ({
      userId: id,
      challengeId: sharedChallengeId,
      entryFee: "0",
      status: "active",
      joinedAt: new Date(`${dateDaysAgo(3)}T00:00:00.000Z`),
    })));

    async function assertProgress(userASteps: number, userBSteps: number) {
      const records = await db.select({
        userId: dailyStepRecordsTable.userId,
        recordDate: dailyStepRecordsTable.recordDate,
        steps: dailyStepRecordsTable.steps,
        verified: dailyStepRecordsTable.verified,
      }).from(dailyStepRecordsTable).where(eq(dailyStepRecordsTable.challengeId, sharedChallengeId));
      const expected = [userId, secondUserId].flatMap((id, index) => {
        const steps = index === 0 ? userASteps : userBSteps;
        return steps ? [{ userId: id, recordDate, steps, verified: true }] : [];
      });
      assert.deepEqual(
        records.filter((row) => row.recordDate === recordDate).sort((a, b) => a.userId.localeCompare(b.userId)),
        expected.sort((a, b) => a.userId.localeCompare(b.userId)),
      );
      for (const row of records.filter((row) => row.recordDate === pendingOnlyDate)) {
        assert.equal(row.steps, 0);
        assert.equal(row.verified, false);
      }
      for (const [sessionId, currentUserId] of [[session, userId], [secondSession, secondUserId]]) {
        const result = await request(`/stridepool/challenges/${sharedChallengeId}/leaderboard`, {}, sessionId);
        assert.equal(result.status, 200);
        const { leaderboard } = result.body as {
          leaderboard: Array<{ userId: string; steps: number; completedDays: number; isCurrentUser: boolean }>;
        };
        assert.equal(leaderboard.length, 2);
        for (const [id, steps] of [[userId, userASteps], [secondUserId, userBSteps]] as const) {
          const participant = leaderboard.find((row) => row.userId === id);
          assert.ok(participant);
          assert.equal(participant.steps, steps);
          assert.equal(participant.completedDays, steps >= 1_000 ? 1 : 0);
          assert.equal(participant.isCurrentUser, id === currentUserId);
        }
      }
    }

    await assertProgress(0, 0);
    const sharedId = "shared-challenge-source-id";
    const uploads = [
      { source: "apple_health", sessionId: session, steps: 1_200, totals: [1_200, 0] },
      { source: "apple_health", sessionId: secondSession, steps: 2_400, totals: [1_200, 2_400] },
      { source: "health_connect", sessionId: session, steps: 600, totals: [1_800, 2_400] },
      { source: "health_connect", sessionId: secondSession, steps: 900, totals: [1_800, 3_300] },
    ] as const;
    for (const upload of uploads) {
      const response = await ingest(upload.source, [sample(sharedId, {
        recordDate,
        steps: upload.steps,
      })], upload.sessionId);
      assert.equal(response.acceptedCount, 1);
      assert.equal(response.pendingReviewCount, 0);
      assert.equal(response.samples[0]?.verificationStatus, "verified");
      await assertProgress(upload.totals[0], upload.totals[1]);
    }

    // Held samples on a verified day and a pending-only day must never advance either participant.
    for (const source of ["apple_health", "health_connect"] as const) {
      for (const sessionId of [session, secondSession]) {
        const response = await ingest(source, [recordDate, pendingOnlyDate].map((date) => sample(
          `shared-challenge-pending-${date}`,
          {
            recordDate: date,
            steps: 1_600,
            startTime: `${date}T12:00:00.000Z`,
            endTime: `${date}T12:04:00.000Z`,
            recordedAt: `${date}T12:05:00.000Z`,
          },
        )), sessionId);
        assert.equal(response.acceptedCount, 2);
        assert.equal(response.pendingReviewCount, 2);
        assert.ok(response.samples.every((row) => row.verificationStatus === "pending_review"));
        await assertProgress(1_800, 3_300);
      }
    }

    for (const upload of uploads) {
      const retry = await ingest(upload.source, [sample(sharedId, { recordDate, steps: 9_999 })], upload.sessionId);
      assert.equal(retry.acceptedCount, 0);
      await assertProgress(1_800, 3_300);
    }
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

  it("counts overlapping concurrent uploads once per account and source", { timeout: 20_000 }, async () => {
    for (const [index, source] of (["apple_health", "health_connect"] as const).entries()) {
      const recordDate = dateDaysAgo(7 + index);
      const blocker = await pool.connect();
      const uploads: Array<Promise<IngestResponse>> = [];
      const accounts = [
        { id: userId, session, multiplier: 1 },
        { id: secondUserId, session: secondSession, multiplier: 2 },
      ];
      try {
        await blocker.query("BEGIN");
        await blocker.query("SELECT id FROM users WHERE id = ANY($1::varchar[]) ORDER BY id FOR UPDATE", [
          accounts.map((account) => account.id),
        ]);
        const { rows: [backend] } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");

        for (const account of accounts) {
          const makeSample = (id: string, steps: number) => sample(`race-${source}-${id}`, {
            recordDate,
            steps: steps * account.multiplier,
          });
          uploads.push(
            ingest(source, [makeSample("shared", 800), makeSample("first", 500)], account.session),
            ingest(source, [makeSample("shared", 800), makeSample("second", 700)], account.session),
          );
        }
        // Observe all four requests waiting on our lock (including waiters
        // behind another waiter). Timing or Promise.all alone does not prove
        // that the ingestion requests actually overlapped.
        const deadline = Date.now() + 5_000;
        let waiting = 0;
        while (waiting < uploads.length && Date.now() < deadline) {
          const { rows: [row] } = await pool.query<{ count: string }>(`
            WITH RECURSIVE blocked(pid) AS (
              SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))
              UNION
              SELECT activity.pid FROM pg_stat_activity activity
              JOIN blocked ON blocked.pid = ANY(pg_blocking_pids(activity.pid))
            )
            SELECT count(*) FROM blocked
            JOIN pg_stat_activity USING (pid)
            WHERE query LIKE '/* stridepool source ingestion */%'
          `, [backend!.pid]);
          waiting = Number(row!.count);
          if (waiting < uploads.length) await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.equal(waiting, 4, "all authenticated uploads must reach the database lock before release");
        await blocker.query("COMMIT");
        const responses = await Promise.all(uploads);

        for (const [accountIndex, account] of accounts.entries()) {
          const pair = responses.slice(accountIndex * 2, accountIndex * 2 + 2);
          assert.deepEqual(pair.map((result) => result.acceptedCount).sort(), [1, 2]);
          assert.ok(pair.every((result) => result.pendingReviewCount === 0));
          const acceptedIds = pair.flatMap((result) => result.samples.map((item) => item.sourceSampleId));
          assert.equal(acceptedIds.length, 3);
          assert.equal(new Set(acceptedIds).size, 3);

          const stored = await db.select().from(stepSourceSamplesTable).where(and(
            eq(stepSourceSamplesTable.userId, account.id),
            eq(stepSourceSamplesTable.source, source),
            eq(stepSourceSamplesTable.recordDate, recordDate),
          ));
          assert.equal(stored.length, 3);
          assert.equal(new Set(stored.map((item) => item.sourceSampleId)).size, 3);
          assert.ok(stored.every((item) => item.verificationStatus === "verified"));
          assert.equal(stored.reduce((total, item) => total + item.steps, 0), 2_000 * account.multiplier);

          const personalRecords = () => db.select().from(dailyStepRecordsTable).where(and(
            eq(dailyStepRecordsTable.userId, account.id),
            isNull(dailyStepRecordsTable.challengeId),
            eq(dailyStepRecordsTable.recordDate, recordDate),
          ));
          const records = await personalRecords();
          assert.equal(records.length, 1, "a missing personal daily row must only be created once");
          assert.equal(records[0]!.steps, 2_000 * account.multiplier);
          assert.equal(records[0]!.verified, true);

          const replay = await ingest(source, [sample(`race-${source}-shared`, { recordDate, steps: 9_999 })], account.session);
          assert.equal(replay.acceptedCount, 0);
          assert.deepEqual(replay.samples, []);
          assert.deepEqual(await personalRecords(), records, "retrying an overlapping sample must not change the daily row");
          const [shared] = await db.select().from(stepSourceSamplesTable).where(and(
            eq(stepSourceSamplesTable.userId, account.id),
            eq(stepSourceSamplesTable.source, source),
            eq(stepSourceSamplesTable.sourceSampleId, `race-${source}-shared`),
          ));
          assert.equal(shared!.steps, 800 * account.multiplier);
        }
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
        await Promise.allSettled(uploads);
      }
    }
  });
});