import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import {
  challengesTable,
  dailyStepRecordsTable,
  db,
  entriesTable,
  joinChallenge,
  pool,
  usersTable,
  walletLedgerEntriesTable,
} from "@workspace/db";
import { and, eq, inArray, like } from "drizzle-orm";
import { closeFinishedPodiumChallenges } from "./podium-closeout";

const runId = `podium-closeout-${randomUUID()}`;
const userIds: string[] = [];
const challengeIds: string[] = [];
const now = new Date("2020-01-03T12:00:00.000Z");
const beforeStart = new Date("2019-12-31T12:00:00.000Z");

async function addUser() {
  const id = `${runId}-user-${randomUUID()}`;
  await db.insert(usersTable).values({
    id,
    email: `${id}@example.test`,
    firstName: "Test",
    lastName: "Walker",
    walletBalance: "100.00",
    walletPending: "0.00",
    totalEarned: "0.00",
  });
  userIds.push(id);
  return id;
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
  it("finds only ended open rankings and credits their podium once across concurrent and repeated passes", async () => {
    const endedRanking = await addChallenge("ranking", "2020-01-02");
    const excluded = [
      await addChallenge("ranking", "2020-01-03"), // A challenge ending today is still active.
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
    assert.ok(passes.every((pass) => pass.found <= 1 && pass.settled === pass.found));
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
      assert.deepEqual(await closeFinishedPodiumChallenges(now), { found: 1, settled: 0, failed: 1 });
      const [failedChallenge] = await db.select({
        count: challengesTable.closeoutFailureCount,
        lastFailedAt: challengesTable.closeoutLastFailedAt,
      }).from(challengesTable).where(eq(challengesTable.id, challengeId));
      assert.equal(failedChallenge.count, attempt);
      assert.deepEqual(failedChallenge.lastFailedAt, now);
    }
    assert.deepEqual(await status(challengeId), { settlementStatus: "open", settledAt: null });
    const [afterFailure] = await db.select({
      walletBalance: usersTable.walletBalance,
      walletPending: usersTable.walletPending,
      totalEarned: usersTable.totalEarned,
    }).from(usersTable).where(eq(usersTable.id, userId));
    assert.deepEqual(afterFailure, { walletBalance: "90.00", walletPending: "10.00", totalEarned: "0.00" });
    assert.deepEqual(await settlementEvents(challengeId), []);

    await db.delete(walletLedgerEntriesTable).where(eq(walletLedgerEntriesTable.id, blockerId));
    assert.deepEqual(await closeFinishedPodiumChallenges(now), { found: 1, settled: 1, failed: 0 });
    assert.deepEqual(await closeFinishedPodiumChallenges(now), { found: 0, settled: 0, failed: 0 });
    assert.equal((await status(challengeId)).settlementStatus, "settled");
    const [cleared] = await db.select({
      count: challengesTable.closeoutFailureCount,
      lastFailedAt: challengesTable.closeoutLastFailedAt,
    }).from(challengesTable).where(eq(challengesTable.id, challengeId));
    assert.deepEqual(cleared, { count: 0, lastFailedAt: null });
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
