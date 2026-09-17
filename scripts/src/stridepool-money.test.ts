import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  challengesTable,
  db,
  dailyStepRecordsTable,
  entriesTable,
  activateProviderChallengeEntry,
  getMembershipSummary,
  joinChallenge,
  leaveChallenge,
  MoneyLogicError,
  pool,
  settleChallenge,
  usersTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

const runId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const userIds = [`${runId}-user-1`, `${runId}-user-2`, `${runId}-user-3`, `${runId}-user-4`, `${runId}-user-5`];
const challengeIds: string[] = [];
const beforeStart = new Date("2026-06-01T12:00:00.000Z");
const afterStart = new Date("2026-06-03T12:00:00.000Z");

async function addUser(id: string, balance = "100.00") {
  await db.insert(usersTable).values({
    id,
    email: `${id}@example.test`,
    firstName: "Test",
    lastName: id,
    walletBalance: balance,
    walletPending: "0.00",
    totalEarned: "0.00",
    goalBaseline: "1000",
  });
}

async function addChallenge(options: Partial<typeof challengesTable.$inferInsert> = {}) {
  const id = `${runId}-challenge-${challengeIds.length + 1}`;
  challengeIds.push(id);
  await db.insert(challengesTable).values({
    id,
    name: "Integration challenge",
    theme: "Test",
    level: "Gentle",
    startDate: "2026-06-02",
    endDate: "2026-06-04",
    days: 3,
    dailyGoal: 1000,
    entryFee: "10.00",
    prizePool: "0.00",
    participantCount: 0,
    finishers: 0,
    color: "#000000",
    goalType: "fixed",
    community: false,
    graceDays: 0,
    ...options,
  });
  return id;
}

async function addVerifiedSteps(userId: string, challengeId: string, dates: string[], steps = 1000) {
  await db.insert(dailyStepRecordsTable).values(dates.map((recordDate) => ({
    userId,
    challengeId,
    recordDate,
    steps,
    source: "test",
    verified: true,
  })));
}

async function wallet(userId: string) {
  const [row] = await db.select({
    balance: usersTable.walletBalance,
    pending: usersTable.walletPending,
    totalEarned: usersTable.totalEarned,
  }).from(usersTable).where(eq(usersTable.id, userId));
  return row;
}

async function entriesFor(challengeId: string) {
  return db.select().from(entriesTable).where(eq(entriesTable.challengeId, challengeId));
}

before(async () => {
  for (const id of userIds) await addUser(id);
});

beforeEach(async () => {
  await db.delete(dailyStepRecordsTable).where(inArray(dailyStepRecordsTable.userId, userIds));
  await db.delete(entriesTable).where(inArray(entriesTable.userId, userIds));
  await db.delete(challengesTable).where(inArray(challengesTable.id, challengeIds));
  challengeIds.splice(0);
  await db.update(usersTable).set({ walletBalance: "100.00", walletPending: "0.00", totalEarned: "0.00", membershipPlan: "free", subscriptionStatus: "inactive" }).where(inArray(usersTable.id, userIds));
});

after(async () => {
  await db.delete(dailyStepRecordsTable).where(inArray(dailyStepRecordsTable.userId, userIds));
  await db.delete(entriesTable).where(inArray(entriesTable.userId, userIds));
  if (challengeIds.length) await db.delete(challengesTable).where(inArray(challengesTable.id, challengeIds));
  await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  await pool.end();
});

describe("wallet join and leave transactions", () => {
  it("debits available balance and increases pending balance on a paid join", async () => {
    const challengeId = await addChallenge();
    const result = await joinChallenge(userIds[0], challengeId, beforeStart);
    assert.equal(result.charged, true);
    assert.deepEqual(await wallet(userIds[0]), { balance: "90.00", pending: "10.00", totalEarned: "0.00" });
    const [challenge] = await db.select().from(challengesTable).where(eq(challengesTable.id, challengeId));
    assert.equal(challenge.prizePool, "10.00");
    assert.equal(challenge.participantCount, 1);
  });

  it("refunds a paid entry when leaving before the challenge starts", async () => {
    const challengeId = await addChallenge();
    await joinChallenge(userIds[0], challengeId, beforeStart);
    const result = await leaveChallenge(userIds[0], challengeId, beforeStart);
    assert.equal(result.refunded, true);
    assert.deepEqual(await wallet(userIds[0]), { balance: "100.00", pending: "0.00", totalEarned: "0.00" });
    const [entry] = await entriesFor(challengeId);
    assert.equal(entry.status, "left");
  });

  it("rejects a leave after the stated start-time policy", async () => {
    const challengeId = await addChallenge();
    await joinChallenge(userIds[0], challengeId, beforeStart);
    await assert.rejects(() => leaveChallenge(userIds[0], challengeId, afterStart), (error: unknown) => error instanceof MoneyLogicError && error.code === "ALREADY_STARTED");
    assert.deepEqual(await wallet(userIds[0]), { balance: "90.00", pending: "10.00", totalEarned: "0.00" });
    const [entry] = await entriesFor(challengeId);
    assert.equal(entry.status, "active");
  });

  it("keeps wallet state consistent when concurrent joins race", async () => {
    const challengeId = await addChallenge();
    const results = await Promise.all([
      joinChallenge(userIds[0], challengeId, beforeStart),
      joinChallenge(userIds[0], challengeId, beforeStart),
    ]);
    assert.equal(results.filter((result) => result.charged).length, 1);
    assert.deepEqual(await wallet(userIds[0]), { balance: "90.00", pending: "10.00", totalEarned: "0.00" });
    assert.equal((await entriesFor(challengeId)).length, 1);
  });

  it("keeps wallet state consistent when concurrent leaves race", async () => {
    const challengeId = await addChallenge();
    await joinChallenge(userIds[0], challengeId, beforeStart);
    const results = await Promise.all([
      leaveChallenge(userIds[0], challengeId, beforeStart),
      leaveChallenge(userIds[0], challengeId, beforeStart),
    ]);
    assert.equal(results.filter((result) => result.refunded).length, 1);
    assert.deepEqual(await wallet(userIds[0]), { balance: "100.00", pending: "0.00", totalEarned: "0.00" });
  });
});

describe("membership challenge limits and platform fees", () => {
  it("keeps a creator-set $150 entry separate from the Free platform fee", async () => {
    const challengeId = await addChallenge({ entryFee: "150.00" });
    const result = await activateProviderChallengeEntry(userIds[0], challengeId, 15_000, 200, 15_200, "pi_free_150", beforeStart);
    assert.deepEqual(result, { activated: true });
    const [challenge] = await db.select().from(challengesTable).where(eq(challengesTable.id, challengeId));
    const [entry] = await entriesFor(challengeId);
    assert.equal(entry.entryFee, "150.00");
    assert.equal(challenge.prizePool, "150.00");
    assert.equal(challenge.participantCount, 1);
  });

  it("limits Free accounts to one active challenge and validates its $2 platform fee", async () => {
    const first = await addChallenge();
    const second = await addChallenge();
    await activateProviderChallengeEntry(userIds[0], first, 1_000, 200, 1_200, "pi_free_1", beforeStart);
    await assert.rejects(
      () => activateProviderChallengeEntry(userIds[0], second, 1_000, 200, 1_200, "pi_free_2", beforeStart),
      (error: unknown) => error instanceof MoneyLogicError && error.code === "CHALLENGE_LIMIT",
    );
    const membership = await getMembershipSummary(userIds[0], beforeStart);
    assert.equal(membership.plan, "free");
    assert.equal(membership.challengeJoinPrice, 2);
    assert.equal(membership.activeChallengeCount, 1);
    assert.equal(membership.activeChallengeLimit, 1);
  });

  it("allows Pro accounts five active challenges with a $1 platform fee", async () => {
    await db.update(usersTable).set({ membershipPlan: "pro", subscriptionStatus: "active" }).where(eq(usersTable.id, userIds[0]));
    const challengeIds = await Promise.all(Array.from({ length: 6 }, () => addChallenge()));
    for (const [index, challengeId] of challengeIds.slice(0, 5).entries()) {
      await activateProviderChallengeEntry(userIds[0], challengeId, 1_000, 100, 1_100, `pi_pro_${index}`, beforeStart);
    }
    await assert.rejects(
      () => activateProviderChallengeEntry(userIds[0], challengeIds[5], 1_000, 100, 1_100, "pi_pro_6", beforeStart),
      (error: unknown) => error instanceof MoneyLogicError && error.code === "CHALLENGE_LIMIT",
    );
    const membership = await getMembershipSummary(userIds[0], beforeStart);
    assert.equal(membership.plan, "pro");
    assert.equal(membership.challengeJoinPrice, 1);
    assert.equal(membership.activeChallengeCount, 5);
    assert.equal(membership.activeChallengeLimit, 5);
  });
});

describe("settlement pool split and refunds", () => {
  it("splits an even pool among one finisher", async () => {
    const challengeId = await addChallenge({ days: 1, endDate: "2026-06-02", prizePool: "30.00" });
    await joinChallenge(userIds[0], challengeId, beforeStart);
    await addVerifiedSteps(userIds[0], challengeId, ["2026-06-02"]);
    const result = await settleChallenge(challengeId, new Date("2026-06-03T00:00:00Z"));
    assert.deepEqual(result, { challengeId, poolTotal: 40, finisherCount: 1, perFinisherBase: 40, roundingRemainder: 0, refundedTotal: 0, alreadySettled: false });
    assert.deepEqual(await wallet(userIds[0]), { balance: "130.00", pending: "0.00", totalEarned: "40.00" });
  });

  it("allocates a one-cent rounding remainder deterministically", async () => {
    const challengeId = await addChallenge({ days: 1, endDate: "2026-06-02", prizePool: "0.00" });
    await joinChallenge(userIds[0], challengeId, beforeStart);
    await joinChallenge(userIds[1], challengeId, beforeStart);
    await joinChallenge(userIds[2], challengeId, beforeStart);
    await db.update(challengesTable).set({ prizePool: "10.00" }).where(eq(challengesTable.id, challengeId));
    await addVerifiedSteps(userIds[0], challengeId, ["2026-06-02"]);
    await addVerifiedSteps(userIds[1], challengeId, ["2026-06-02"]);
    await addVerifiedSteps(userIds[2], challengeId, ["2026-06-02"]);
    const result = await settleChallenge(challengeId, new Date("2026-06-03T00:00:00Z"));
    assert.equal(result.finisherCount, 3);
    assert.equal(result.perFinisherBase, 3.33);
    assert.equal(result.roundingRemainder, 1);
    assert.deepEqual(await wallet(userIds[0]), { balance: "93.34", pending: "0.00", totalEarned: "3.34" });
    assert.deepEqual(await wallet(userIds[1]), { balance: "93.33", pending: "0.00", totalEarned: "3.33" });
    assert.deepEqual(await wallet(userIds[2]), { balance: "93.33", pending: "0.00", totalEarned: "3.33" });
  });

  it("handles zero finishers, all finishers, and a non-divisible pool", async () => {
    const noFinisherId = await addChallenge({ days: 1, endDate: "2026-06-02", prizePool: "0.00" });
    await joinChallenge(userIds[0], noFinisherId, beforeStart);
    const noFinisherResult = await settleChallenge(noFinisherId, new Date("2026-06-03T00:00:00Z"));
    assert.equal(noFinisherResult.finisherCount, 0);
    assert.equal(noFinisherResult.refundedTotal, 10);
    assert.deepEqual(await wallet(userIds[0]), { balance: "100.00", pending: "0.00", totalEarned: "0.00" });

    const allFinisherId = await addChallenge({ days: 1, endDate: "2026-06-02", prizePool: "0.00" });
    await joinChallenge(userIds[0], allFinisherId, beforeStart);
    await joinChallenge(userIds[1], allFinisherId, beforeStart);
    await db.update(challengesTable).set({ prizePool: "21.00" }).where(eq(challengesTable.id, allFinisherId));
    await addVerifiedSteps(userIds[0], allFinisherId, ["2026-06-02"]);
    await addVerifiedSteps(userIds[1], allFinisherId, ["2026-06-02"]);
    const allFinisherResult = await settleChallenge(allFinisherId, new Date("2026-06-03T00:00:00Z"));
    assert.deepEqual(allFinisherResult, { challengeId: allFinisherId, poolTotal: 21, finisherCount: 2, perFinisherBase: 10.5, roundingRemainder: 0, refundedTotal: 0, alreadySettled: false });
  });

  it("does not refund twice when no-finisher settlement is repeated", async () => {
    const challengeId = await addChallenge({ days: 1, endDate: "2026-06-02", prizePool: "0.00" });
    await joinChallenge(userIds[0], challengeId, beforeStart);
    const [first, second] = await Promise.all([
      settleChallenge(challengeId, new Date("2026-06-03T00:00:00Z")),
      settleChallenge(challengeId, new Date("2026-06-03T01:00:00Z")),
    ]);
    assert.equal([first, second].filter((result) => !result.alreadySettled).length, 1);
    assert.equal([first, second].filter((result) => result.alreadySettled).length, 1);
    assert.equal([first, second].find((result) => !result.alreadySettled)?.refundedTotal, 10);
    assert.deepEqual(await wallet(userIds[0]), { balance: "100.00", pending: "0.00", totalEarned: "0.00" });
  });
});

describe("free community and grace-day paths", () => {
  it("joins and leaves a free community challenge without changing wallet or pool", async () => {
    const challengeId = await addChallenge({ community: true, entryFee: "0.00", prizePool: "0.00", graceDays: 2 });
    const before = await wallet(userIds[0]);
    const joined = await joinChallenge(userIds[0], challengeId, beforeStart);
    assert.equal(joined.freeCommunity, true);
    assert.equal(joined.charged, false);
    const [afterJoin] = await db.select().from(challengesTable).where(eq(challengesTable.id, challengeId));
    assert.equal(afterJoin.prizePool, "0.00");
    assert.equal(afterJoin.participantCount, 1);
    assert.deepEqual(await wallet(userIds[0]), before);
    const left = await leaveChallenge(userIds[0], challengeId, beforeStart);
    assert.equal(left.refunded, false);
    const [afterLeave] = await db.select().from(challengesTable).where(eq(challengesTable.id, challengeId));
    assert.equal(afterLeave.prizePool, "0.00");
    assert.equal(afterLeave.participantCount, 0);
    assert.deepEqual(await wallet(userIds[0]), before);
  });

  it("counts one missed grace-eligible day as a finisher", async () => {
    const challengeId = await addChallenge({ graceDays: 1, prizePool: "0.00" });
    await joinChallenge(userIds[0], challengeId, beforeStart);
    await db.update(challengesTable).set({ prizePool: "10.00" }).where(eq(challengesTable.id, challengeId));
    await addVerifiedSteps(userIds[0], challengeId, ["2026-06-02", "2026-06-04"]);
    const result = await settleChallenge(challengeId, new Date("2026-06-05T00:00:00Z"));
    assert.equal(result.finisherCount, 1);
  });

  it("does not finish a participant who exceeds the grace allowance", async () => {
    const challengeId = await addChallenge({ graceDays: 1, prizePool: "0.00" });
    await joinChallenge(userIds[0], challengeId, beforeStart);
    await db.update(challengesTable).set({ prizePool: "10.00" }).where(eq(challengesTable.id, challengeId));
    await addVerifiedSteps(userIds[0], challengeId, ["2026-06-02"]);
    const result = await settleChallenge(challengeId, new Date("2026-06-05T00:00:00Z"));
    assert.equal(result.finisherCount, 0);
    assert.equal(result.refundedTotal, 10);
  });
});