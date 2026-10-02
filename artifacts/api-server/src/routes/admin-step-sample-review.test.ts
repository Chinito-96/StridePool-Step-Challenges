import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import app from "../app";
import { createSession } from "../lib/auth";
import {
  challengesTable,
  db,
  entriesTable,
  dailyStepRecordsTable,
  pool,
  sessionsTable,
  stepSourceSamplesTable,
  usersTable,
} from "@workspace/db";
import { and, eq, inArray, isNull } from "drizzle-orm";

const runId = `step-review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const userId = `${runId}-user`;
const adminId = `${runId}-admin`;
const challengeId = `${runId}-challenge`;
const today = new Date().toISOString().slice(0, 10);

let server: Server | undefined;
let baseUrl = "";
let userSession = "";
let adminSession = "";

type ApiResult = { status: number; body: unknown };

function sample(
  sourceSampleId: string,
  recordDate: string,
  rawPayload: Record<string, unknown>,
) {
  return {
    sourceSampleId,
    recordDate,
    steps: 1_600,
    startTime: `${recordDate}T08:00:00.000Z`,
    endTime: `${recordDate}T08:04:00.000Z`,
    recordedAt: `${recordDate}T08:05:00.000Z`,
    rawPayload,
  };
}

async function request(path: string, options: RequestInit = {}, sessionId = userSession): Promise<ApiResult> {
  const { headers, ...init } = options;
  const requestHeaders = new Headers(headers);
  requestHeaders.set("cookie", `sid=${sessionId}`);
  if (init.body && !requestHeaders.has("content-type")) requestHeaders.set("content-type", "application/json");
  const response = await fetch(`${baseUrl}/api${path}`, { ...init, headers: requestHeaders });
  const text = await response.text();
  return {
    status: response.status,
    body: text && response.headers.get("content-type")?.includes("application/json") ? JSON.parse(text) : text || null,
  };
}

async function ingest(
  sourceSampleId: string,
  recordDate: string,
  rawPayload: Record<string, unknown>,
) {
  const result = await request("/stridepool/sources/apple_health/samples", {
    method: "POST",
    body: JSON.stringify({ samples: [sample(sourceSampleId, recordDate, rawPayload)] }),
  });
  assert.equal(result.status, 200);
  return result;
}

describe("admin source sample review", () => {
  before(async () => {
    await db.insert(usersTable).values([
      {
        id: userId,
        email: `${userId}@example.test`,
        displayName: "Review Subject",
      },
      {
        id: adminId,
        email: `${adminId}@example.test`,
        displayName: "Support Reviewer",
        role: "admin",
      },
    ]);
    await db.insert(challengesTable).values({
      id: challengeId,
      name: "Review challenge",
      theme: "Test",
      level: "Open",
      startDate: "2000-01-01",
      endDate: "2099-12-31",
      days: 36_500,
      dailyGoal: 2_000,
      entryFee: "0.00",
      prizePool: "0.00",
      participantCount: 1,
      finishers: 0,
      settlementStatus: "open",
      color: "#000000",
      challengeType: "goal",
      goalType: "fixed",
      community: true,
    });
    await db.insert(entriesTable).values({
      userId,
      challengeId,
      status: "active",
      entryFee: "0.00",
    });
    userSession = await createSession({
      user: {
        id: userId,
        email: `${userId}@example.test`,
        firstName: "Review",
        lastName: "Subject",
        profileImageUrl: null,
      },
      access_token: "step-review-user-token",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    });
    adminSession = await createSession({
      user: {
        id: adminId,
        email: `${adminId}@example.test`,
        firstName: "Support",
        lastName: "Reviewer",
        profileImageUrl: null,
      },
      access_token: "step-review-admin-token",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    });

    const listeningServer = app.listen(0);
    server = listeningServer;
    await new Promise<void>((resolve, reject) => {
      listeningServer.once("listening", resolve);
      listeningServer.once("error", reject);
    });
    const address = listeningServer.address();
    if (!address || typeof address === "string") throw new Error("The review test server did not expose a TCP address.");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await db.delete(entriesTable).where(eq(entriesTable.challengeId, challengeId));
    await db.delete(stepSourceSamplesTable).where(eq(stepSourceSamplesTable.userId, userId));
    await db.delete(dailyStepRecordsTable).where(eq(dailyStepRecordsTable.userId, userId));
    await db.delete(sessionsTable).where(inArray(sessionsTable.sid, [userSession, adminSession]));
    await db.delete(challengesTable).where(eq(challengesTable.id, challengeId));
    await db.delete(usersTable).where(inArray(usersTable.id, [userId, adminId]));
    await pool.end();
  });

  it("lets only support approve or reject a held sample and rebuilds challenge totals once", async () => {
    const approvePayload = { provider: "apple", sourceSampleId: "approve-me", checksum: "a1" };
    const rejectPayload = { provider: "apple", sourceSampleId: "reject-me", checksum: "r1" };
    await ingest("approved-held-sample", today, approvePayload);
    await ingest("rejected-held-sample", today, rejectPayload);

    const [approvedBefore] = await db.select().from(stepSourceSamplesTable).where(and(
      eq(stepSourceSamplesTable.userId, userId),
      eq(stepSourceSamplesTable.sourceSampleId, "approved-held-sample"),
    ));
    const [rejectedBefore] = await db.select().from(stepSourceSamplesTable).where(and(
      eq(stepSourceSamplesTable.userId, userId),
      eq(stepSourceSamplesTable.sourceSampleId, "rejected-held-sample"),
    ));
    assert.ok(approvedBefore);
    assert.ok(rejectedBefore);
    assert.deepEqual(approvedBefore.reviewFlags, ["burst_rate"]);
    assert.deepEqual(rejectedBefore.reviewFlags, ["burst_rate"]);

    const forbiddenList = await request("/admin/step-samples");
    assert.equal(forbiddenList.status, 403);

    const pendingList = await request("/admin/step-samples", {}, adminSession);
    assert.equal(pendingList.status, 200);
    assert.equal((pendingList.body as { samples: Array<{ sourceSampleId: string }> }).samples.length, 2);

    const forbiddenDecision = await request(`/admin/step-samples/${approvedBefore.id}/decision`, {
      method: "POST",
      body: JSON.stringify({ decision: "approve", explanation: "Support checked source." }),
    });
    assert.equal(forbiddenDecision.status, 403);

    const approved = await request(`/admin/step-samples/${approvedBefore.id}/decision`, {
      method: "POST",
      body: JSON.stringify({ decision: "approve", explanation: "Support checked source timestamps." }),
    }, adminSession);
    assert.equal(approved.status, 200);
    const approvedBody = approved.body as {
      sample: { verificationStatus: string; rawPayload: Record<string, unknown>; reviewFlags: string[] };
      dailyTotal: number;
    };
    assert.equal(approvedBody.sample.verificationStatus, "verified");
    assert.deepEqual(approvedBody.sample.rawPayload, approvePayload);
    assert.deepEqual(approvedBody.sample.reviewFlags, ["burst_rate"]);
    assert.equal(approvedBody.dailyTotal, 1_600);

    const [personalTotal] = await db.select().from(dailyStepRecordsTable).where(and(
      eq(dailyStepRecordsTable.userId, userId),
      isNull(dailyStepRecordsTable.challengeId),
      eq(dailyStepRecordsTable.recordDate, today),
    ));
    const [challengeTotal] = await db.select().from(dailyStepRecordsTable).where(and(
      eq(dailyStepRecordsTable.userId, userId),
      eq(dailyStepRecordsTable.challengeId, challengeId),
      eq(dailyStepRecordsTable.recordDate, today),
    ));
    assert.equal(personalTotal?.steps, 1_600);
    assert.equal(challengeTotal?.steps, 1_600);
    assert.equal(personalTotal?.verified, true);
    assert.equal(challengeTotal?.verified, true);

    const duplicateApproval = await request(`/admin/step-samples/${approvedBefore.id}/decision`, {
      method: "POST",
      body: JSON.stringify({ decision: "approve", explanation: "Support checked source timestamps." }),
    }, adminSession);
    assert.equal(duplicateApproval.status, 409);

    const rejected = await request(`/admin/step-samples/${rejectedBefore.id}/decision`, {
      method: "POST",
      body: JSON.stringify({ decision: "reject", explanation: "Source interval did not pass review." }),
    }, adminSession);
    assert.equal(rejected.status, 200);
    const rejectedBody = rejected.body as {
      sample: { verificationStatus: string; rawPayload: Record<string, unknown>; reviewFlags: string[] };
      dailyTotal: number;
    };
    assert.equal(rejectedBody.sample.verificationStatus, "rejected");
    assert.deepEqual(rejectedBody.sample.rawPayload, rejectPayload);
    assert.deepEqual(rejectedBody.sample.reviewFlags, ["burst_rate"]);
    assert.equal(rejectedBody.dailyTotal, 1_600);

    const [afterRejectPersonal] = await db.select().from(dailyStepRecordsTable).where(and(
      eq(dailyStepRecordsTable.userId, userId),
      isNull(dailyStepRecordsTable.challengeId),
      eq(dailyStepRecordsTable.recordDate, today),
    ));
    const [afterRejectChallenge] = await db.select().from(dailyStepRecordsTable).where(and(
      eq(dailyStepRecordsTable.userId, userId),
      eq(dailyStepRecordsTable.challengeId, challengeId),
      eq(dailyStepRecordsTable.recordDate, today),
    ));
    assert.equal(afterRejectPersonal?.steps, 1_600);
    assert.equal(afterRejectChallenge?.steps, 1_600);
    const remaining = (await request("/admin/step-samples", {}, adminSession)).body as {
      samples: Array<{ sourceSampleId: string }>;
    };
    assert.ok(!remaining.samples.some(({ sourceSampleId }) => (
      sourceSampleId === "approved-held-sample" || sourceSampleId === "rejected-held-sample"
    )));
  });
});