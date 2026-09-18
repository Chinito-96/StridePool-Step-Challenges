import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  claimReferralCode,
  db,
  ensureReferralCode,
  getMembershipSummary,
  getReferralPreview,
  joinChallenge,
  pool,
  qualifyReferralForUser,
  referralsTable,
  referralCodesTable,
  usersTable,
  challengesTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const runId = `referral-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const referrerId = `${runId}-referrer`;
const referredId = `${runId}-referred`;
const challengeId = `${runId}-challenge`;
const qualifiedAt = new Date("2026-09-17T12:00:00.000Z");

async function addUsers() {
  await db.insert(usersTable).values([
    { id: referrerId, email: `${referrerId}@example.test`, firstName: "Referrer", membershipPlan: "free", subscriptionStatus: "inactive" },
    { id: referredId, email: `${referredId}@example.test`, firstName: "Referred", membershipPlan: "free", subscriptionStatus: "inactive" },
  ]);
}

before(async () => {
  await addUsers();
});

beforeEach(async () => {
  await db.delete(referralsTable).where(inArray(referralsTable.referredUserId, [referrerId, referredId]));
  await db.delete(referralCodesTable).where(eq(referralCodesTable.ownerUserId, referrerId));
  await db.delete(challengesTable).where(eq(challengesTable.id, challengeId));
  await db.update(usersTable).set({ membershipPlan: "free", subscriptionStatus: "inactive", proTrialEndsAt: null }).where(inArray(usersTable.id, [referrerId, referredId]));
});

after(async () => {
  await db.delete(referralsTable).where(inArray(referralsTable.referredUserId, [referrerId, referredId]));
  await db.delete(referralCodesTable).where(eq(referralCodesTable.ownerUserId, referrerId));
  await db.delete(challengesTable).where(eq(challengesTable.id, challengeId));
  await db.delete(usersTable).where(inArray(usersTable.id, [referrerId, referredId]));
  await pool.end();
});

describe("StridePool referrals", () => {
  it("qualifies both walkers for a 30-day Pro grant after the referred walker joins", async () => {
    await db.insert(challengesTable).values({
      id: challengeId,
      name: "Referral walk",
      theme: "Together",
      level: "Gentle",
      startDate: "2026-09-18",
      endDate: "2026-09-20",
      days: 3,
      dailyGoal: 1000,
      entryFee: "0",
      prizePool: "0",
      participantCount: 0,
      finishers: 0,
      color: "#000000",
      community: true,
    });
    const code = await ensureReferralCode(referrerId);
    assert.deepEqual(await getReferralPreview(code), { code, referrerDisplayName: "Referrer" });
    assert.deepEqual(await claimReferralCode(referredId, code), { status: "pending" });

    await joinChallenge(referredId, challengeId, qualifiedAt);
    const reward = await qualifyReferralForUser(referredId, qualifiedAt);
    assert.equal(reward?.referrerUserId, referrerId);
    assert.equal(reward?.referredUserId, referredId);

    const [referrer, referred] = await Promise.all([
      db.select().from(usersTable).where(eq(usersTable.id, referrerId)).then(([user]) => user),
      db.select().from(usersTable).where(eq(usersTable.id, referredId)).then(([user]) => user),
    ]);
    const expectedEnd = new Date("2026-10-17T12:00:00.000Z");
    assert.equal(referrer.membershipPlan, "pro");
    assert.equal(referred.membershipPlan, "pro");
    assert.equal(referrer.proTrialEndsAt?.toISOString(), expectedEnd.toISOString());
    assert.equal(referred.proTrialEndsAt?.toISOString(), expectedEnd.toISOString());
    assert.equal((await getMembershipSummary(referredId, qualifiedAt)).plan, "pro");
    assert.equal((await getMembershipSummary(referredId, expectedEnd)).plan, "free");
    assert.equal(await qualifyReferralForUser(referredId, new Date("2026-09-18T12:00:00.000Z")), null);
  });

  it("rejects self-referrals and keeps the referral claim idempotent", async () => {
    const code = await ensureReferralCode(referrerId);
    await assert.rejects(() => claimReferralCode(referrerId, code), /own referral link/);
    assert.deepEqual(await claimReferralCode(referredId, code), { status: "pending" });
    assert.deepEqual(await claimReferralCode(referredId, code), { status: "pending" });
  });
});