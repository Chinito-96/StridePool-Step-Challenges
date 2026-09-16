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
): Promise<ApiResult> {
  const { headers, ...init } = options;
  const requestHeaders = new Headers(headers);
  requestHeaders.set("cookie", `sid=${session}`);
  if (init.body && !requestHeaders.has("content-type")) {
    requestHeaders.set("content-type", "application/json");
  }

  const response = await fetch(`${baseUrl}/api${path}`, {
    ...init,
    headers: requestHeaders,
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
}

async function ingest(
  source: "apple_health" | "health_connect",
  samples: ReturnType<typeof sample>[],
): Promise<IngestResponse> {
  const result = await request(`/stridepool/sources/${source}/samples`, {
    method: "POST",
    body: JSON.stringify({ samples }),
  });
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
    await db.delete(dailyStepRecordsTable).where(eq(dailyStepRecordsTable.userId, userId));
    await db.delete(healthSourceConnectionsTable).where(eq(healthSourceConnectionsTable.userId, userId));
    await db.delete(sessionsTable).where(eq(sessionsTable.sid, session));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
    await pool.end();
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
});