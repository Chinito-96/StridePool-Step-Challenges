import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { after, describe, it } from "node:test";
import app from "../app";
import { createSession } from "../lib/auth";
import {
  challengesTable,
  dailyStepRecordsTable,
  db,
  entriesTable,
  joinChallenge,
  pool,
  sessionsTable,
  usersTable,
  walletLedgerEntriesTable,
} from "@workspace/db";
import { and, eq, inArray, like } from "drizzle-orm";
import { closeFinishedPodiumChallenges } from "./podium-closeout";

const runId = `podium-closeout-${randomUUID()}`;
const userIds: string[] = [];
const challengeIds: string[] = [];
const sessionIds: string[] = [];
const isolatedSchema = process.env.PODIUM_CLOSEOUT_TEST_SCHEMA;
// After the 2020-01-02 final day's sync window and review period (Paid Play Terms 7.6).
const now = new Date("2020-01-05T12:00:00.000Z");
const beforeStart = new Date("2019-12-31T12:00:00.000Z");
let server: Server | undefined;
let baseUrl = "";

async function addUser(role: "user" | "admin" = "user") {
  const id = `${runId}-user-${randomUUID()}`;
  await db.insert(usersTable).values({
    id,
    email: `${id}@example.test`,
    firstName: "Test",
    lastName: "Walker",
    role,
    walletBalance: "100.00",
    walletPending: "0.00",
    totalEarned: "0.00",
  });
  userIds.push(id);
  return id;
}

async function requestCloseoutAlerts(sessionId?: string) {
  const response = await fetch(`${baseUrl}/api/admin/closeout-alerts`, {
    headers: sessionId ? { cookie: `sid=${sessionId}` } : undefined,
  });
  return {
    status: response.status,
    body: await response.json() as {
      alerts: Array<{
        challengeId: string;
        challengeName: string;
        endDate: string;
        failureCount: number;
        lastFailedAt: string;
      }>;
    },
  };
}

async function startAdminApi() {
  const listeningServer = app.listen(0);
  server = listeningServer;
  await new Promise<void>((resolve, reject) => {
    listeningServer.once("listening", resolve);
    listeningServer.once("error", reject);
  });
  const address = listeningServer.address();
  if (!address || typeof address === "string") {
    throw new Error("The closeout-alert test server did not expose a TCP address.");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
}

async function addChallenge(
  challengeType: "ranking" | "goal" | "elimination",
  endDate: string,
  settlementStatus = "open",
) {
  const id = `${runId}-challenge-${challengeIds.length + 1}`;
  await db.insert(challengesTable).values({
    id,
    name: "Closeout integration fixture",
    theme: "Test",
    level: "Gentle",
    startDate: "2020-01-01",
    endDate,
    days: 2,
    dailyGoal: 1000,
    entryFee: "10.00",
    prizePool: "0.00",
    participantCount: 0,
    finishers: 0,
    color: "#000000",
    challengeType,
    goalType: challengeType === "ranking" ? "total_steps" : "fixed",
    settlementStatus,
  });
  challengeIds.push(id);
  return id;
}

async function status(challengeId: string) {
  const [challenge] = await db.select({
    settlementStatus: challengesTable.settlementStatus,
    settledAt: challengesTable.settledAt,
    closeoutAlertSentAt: challengesTable.closeoutAlertSentAt,
  }).from(challengesTable).where(eq(challengesTable.id, challengeId));
  return challenge;
}

async function settlementEvents(challengeId: string) {
  return db.select({
    userId: walletLedgerEntriesTable.userId,
    eventType: walletLedgerEntriesTable.eventType,
    amountCents: walletLedgerEntriesTable.amountCents,
  }).from(walletLedgerEntriesTable).where(and(
    eq(walletLedgerEntriesTable.challengeId, challengeId),
    like(walletLedgerEntriesTable.eventType, "settlement_%"),
  ));
}

after(async () => {
  try {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()));
      });
    }
    if (sessionIds.length) await db.delete(sessionsTable).where(inArray(sessionsTable.sid, sessionIds));
    if (challengeIds.length) {
      await db.delete(walletLedgerEntriesTable).where(inArray(walletLedgerEntriesTable.challengeId, challengeIds));
      await db.delete(dailyStepRecordsTable).where(inArray(dailyStepRecordsTable.challengeId, challengeIds));
      await db.delete(entriesTable).where(inArray(entriesTable.challengeId, challengeIds));
      await db.delete(challengesTable).where(inArray(challengesTable.id, challengeIds));
    }
    if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  } finally {
    await pool.end();
  }
});

describe("automatic podium closeout with the database", () => {
  it("uses a disposable schema without the public schema on its search path", async () => {
    assert.ok(isolatedSchema, "Run this test through the isolated closeout test runner.");
    const { rows } = await pool.query(
      "SELECT current_schema() AS schema, 'public' = ANY(current_schemas(false)) AS public_on_search_path",
    );
    assert.equal(rows[0]?.schema, isolatedSchema);
    assert.equal(rows[0]?.public_on_search_path, false);
  });

  it("finds only ended open rankings and credits their podium once across concurrent and repeated passes", async () => {
    const endedRanking = await addChallenge("ranking", "2020-01-02");
    const excluded = [
      await addChallenge("ranking", "2020-01-05"), // A challenge ending today is still active.
      await addChallenge("goal", "2020-01-02"),
      await addChallenge("goal", "2020-01-04"),
      await addChallenge("elimination", "2020-01-02"),
      await addChallenge("elimination", "2020-01-04"),
      await addChallenge("ranking", "2020-01-02", "settled"),
    ];
    const participants = await Promise.all([addUser(), addUser(), addUser()]);
    for (const userId of participants) await joinChallenge(userId, endedRanking, beforeStart);
    await db.insert(dailyStepRecordsTable).values(
      participants.map((userId, index) => ({
        userId,
        challengeId: endedRanking,
        recordDate: "2020-01-01",
        steps: [9000, 7000, 5000][index],
        source: "test",
        verified: true,
      })),
    );

    const passes = await Promise.all([
      closeFinishedPodiumChallenges(now),
      closeFinishedPodiumChallenges(now),
    ]);
    assert.deepEqual(passes.map((pass) => pass.failed), [0, 0]);
    assert.ok(passes.every((pass) => pass.found <= 1 && pass.settled <= pass.found));
    assert.equal(passes.reduce((total, pass) => total + pass.settled, 0), 1);
    assert.ok(passes.some((pass) => pass.found === 1));
    assert.deepEqual(await closeFinishedPodiumChallenges(now), { found: 0, settled: 0, failed: 0 });

    assert.equal((await status(endedRanking)).settlementStatus, "settled");
    for (const challengeId of excluded) {
      assert.equal((await status(challengeId)).settlementStatus, challengeId === excluded.at(-1) ? "settled" : "open");
      assert.deepEqual(await settlementEvents(challengeId), []);
    }
    const events = await settlementEvents(endedRanking);
    assert.deepEqual(
      events.map((event) => ({ ...event, userId: participants.indexOf(event.userId) })).sort((a, b) => a.userId - b.userId),
      [1800, 750, 450].map((amountCents, userId) => ({ userId, eventType: "settlement_earned", amountCents })),
    );
    for (const [index, userId] of participants.entries()) {
      const [user] = await db.select({
        walletBalance: usersTable.walletBalance,
        walletPending: usersTable.walletPending,
        totalEarned: usersTable.totalEarned,
      }).from(usersTable).where(eq(usersTable.id, userId));
      assert.deepEqual(user, {
        walletBalance: ["108.00", "97.50", "94.50"][index],
        walletPending: "0.00",
        totalEarned: ["18.00", "7.50", "4.50"][index],
      });
    }
  });

  it("leaves a failed settlement open and credits the winner on the next pass", async () => {
    const challengeId = await addChallenge("ranking", "2020-01-02");
    const userId = await addUser();
    await joinChallenge(userId, challengeId, beforeStart);
    const [entry] = await db.select().from(entriesTable).where(eq(entriesTable.challengeId, challengeId));
    const blockerId = `ledger_settlement_${entry.id}`;
    const supportAlerts: Array<{ challengeId: string; challengeName: string; failureCount: number; lastFailedAt: Date }> = [];
    const dependencies = {
      sendAlert: async (alert: { challengeId: string; challengeName: string; failureCount: number; lastFailedAt: Date }) => {
        supportAlerts.push(alert);
      },
    };
    // Force the real settlement transaction to roll back at its ledger insert.
    await db.insert(walletLedgerEntriesTable).values({
      id: blockerId,
      userId,
      challengeId,
      eventType: "test_blocker",
      status: "recorded",
      amountCents: 0,
    });

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      assert.deepEqual(await closeFinishedPodiumChallenges(now, dependencies), { found: 1, settled: 0, failed: 1 });
      const [failedChallenge] = await db.select({
        count: challengesTable.closeoutFailureCount,
        lastFailedAt: challengesTable.closeoutLastFailedAt,
      }).from(challengesTable).where(eq(challengesTable.id, challengeId));
      assert.equal(failedChallenge.count, attempt);
      assert.deepEqual(failedChallenge.lastFailedAt, now);
    }
    assert.deepEqual(supportAlerts.map(({ challengeId: alertChallengeId, challengeName, failureCount: alertFailureCount, lastFailedAt }) => ({
      challengeId: alertChallengeId,
      challengeName,
      failureCount: alertFailureCount,
      lastFailedAt,
    })), [{
      challengeId,
      challengeName: "Closeout integration fixture",
      failureCount: 3,
      lastFailedAt: now,
    }]);
    assert.deepEqual(await status(challengeId), {
      settlementStatus: "open",
      settledAt: null,
      closeoutAlertSentAt: now,
    });
    const [afterFailure] = await db.select({
      walletBalance: usersTable.walletBalance,
      walletPending: usersTable.walletPending,
      totalEarned: usersTable.totalEarned,
    }).from(usersTable).where(eq(usersTable.id, userId));
    assert.deepEqual(afterFailure, { walletBalance: "90.00", walletPending: "10.00", totalEarned: "0.00" });
    assert.deepEqual(await settlementEvents(challengeId), []);

    const settledChallenge = await addChallenge("ranking", "2020-01-02", "settled");
    const otherChallenge = await addChallenge("goal", "2020-01-02");
    const activeChallenge = await addChallenge("ranking", new Date().toISOString().slice(0, 10));
    await db.update(challengesTable).set({
      closeoutFailureCount: 3,
      closeoutLastFailedAt: now,
    }).where(inArray(challengesTable.id, [settledChallenge, otherChallenge, activeChallenge]));

    const ordinaryUserId = await addUser();
    const adminUserId = await addUser("admin");
    const makeSession = (id: string) => createSession({
      user: {
        id,
        email: `${id}@example.test`,
        firstName: "Test",
        lastName: "Walker",
        profileImageUrl: null,
      },
      access_token: "podium-closeout-test-token",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    });
    const [ordinarySession, adminSession] = await Promise.all([
      makeSession(ordinaryUserId),
      makeSession(adminUserId),
    ]);
    sessionIds.push(ordinarySession, adminSession);
    await startAdminApi();

    const anonymousResponse = await requestCloseoutAlerts();
    assert.equal(anonymousResponse.status, 401);
    const ordinaryResponse = await requestCloseoutAlerts(ordinarySession);
    assert.equal(ordinaryResponse.status, 403);

    const adminResponse = await requestCloseoutAlerts(adminSession);
    assert.equal(adminResponse.status, 200);
    assert.deepEqual(adminResponse.body.alerts, [{
      challengeId,
      challengeName: "Closeout integration fixture",
      endDate: "2020-01-02T00:00:00.000Z",
      failureCount: 3,
      lastFailedAt: now.toISOString(),
    }]);

    // Further retries do not send a duplicate alert for the same blocked incident.
    await closeFinishedPodiumChallenges(now, dependencies);
    assert.equal(supportAlerts.length, 1);

    await db.delete(walletLedgerEntriesTable).where(eq(walletLedgerEntriesTable.id, blockerId));
    assert.deepEqual(await closeFinishedPodiumChallenges(now, dependencies), { found: 1, settled: 1, failed: 0 });
    assert.deepEqual(await closeFinishedPodiumChallenges(now), { found: 0, settled: 0, failed: 0 });
    const afterSuccessfulRetry = await requestCloseoutAlerts(adminSession);
    assert.equal(afterSuccessfulRetry.status, 200);
    assert.deepEqual(afterSuccessfulRetry.body.alerts, []);
    assert.equal((await status(challengeId)).settlementStatus, "settled");
    const [cleared] = await db.select({
      count: challengesTable.closeoutFailureCount,
      lastFailedAt: challengesTable.closeoutLastFailedAt,
      alertClaimId: challengesTable.closeoutAlertClaimId,
      alertClaimedAt: challengesTable.closeoutAlertClaimedAt,
      alertSentAt: challengesTable.closeoutAlertSentAt,
    }).from(challengesTable).where(eq(challengesTable.id, challengeId));
    assert.deepEqual(cleared, {
      count: 0,
      lastFailedAt: null,
      alertClaimId: null,
      alertClaimedAt: null,
      alertSentAt: null,
    });
    assert.deepEqual(await settlementEvents(challengeId), [
      { userId, eventType: "settlement_earned", amountCents: 1000 },
    ]);
    const [afterRetry] = await db.select({
      walletBalance: usersTable.walletBalance,
      walletPending: usersTable.walletPending,
      totalEarned: usersTable.totalEarned,
    }).from(usersTable).where(eq(usersTable.id, userId));
    assert.deepEqual(afterRetry, { walletBalance: "100.00", walletPending: "0.00", totalEarned: "10.00" });
  });
});
