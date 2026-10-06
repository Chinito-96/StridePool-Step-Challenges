import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import {
  activateProviderChallengeEntry,
  cancelChallengeWithRefunds,
  challengesTable,
  db,
  entriesTable,
  findUnderFilledPaidChallenges,
  leaveChallenge,
  pool,
  settleChallenge,
  usersTable,
  walletLedgerEntriesTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { processPendingEntryRefunds, type ProviderRefundOutcome } from "../../artifacts/api-server/src/services/entry-refunds";
import { unwithdrawnRefundCreditCents, withdrawAvailableBalance } from "../../artifacts/api-server/src/services/ledger";

// Paid Play Terms 4.4, 4.5, 5.3, 5.4, 6.3 and 6.4 against a real database.
const runId = `refund-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const userIds: string[] = [];
const challengeIds: string[] = [];
const beforeStart = new Date("2026-06-01T12:00:00.000Z");

async function addUser(balance = "0.00") {
  const id = `${runId}-user-${userIds.length + 1}`;
  userIds.push(id);
  await db.insert(usersTable).values({
    id, email: `${id}@example.test`, firstName: "Test", lastName: "Walker",
    walletBalance: balance, walletPending: "0.00", totalEarned: "0.00", goalBaseline: "1000",
    stripeConnectAccountId: "acct_refund_test", eligibilityState: "IL",
  });
  return id;
}

async function addChallenge(options: Partial<typeof challengesTable.$inferInsert> = {}) {
  const id = `${runId}-challenge-${challengeIds.length + 1}`;
  challengeIds.push(id);
  await db.insert(challengesTable).values({
    id, name: "Refund fixture", theme: "Test", level: "Gentle",
    startDate: "2026-06-02", endDate: "2026-06-02", days: 1, dailyGoal: 1000,
    entryFee: "10.00", prizePool: "0.00", participantCount: 0, finishers: 0,
    color: "#000000", goalType: "fixed", community: false, ...options,
  });
  return id;
}

/** A card-paid entry: $10 entry fee + $2 platform fee through Stripe. */
async function cardEntry(userId: string, challengeId: string, paymentIntent: string) {
  await activateProviderChallengeEntry(userId, challengeId, 1000, 200, 1200, paymentIntent, beforeStart);
}

async function refundRequests(userId: string) {
  return db.select().from(walletLedgerEntriesTable).where(and(
    eq(walletLedgerEntriesTable.userId, userId),
    eq(walletLedgerEntriesTable.eventType, "entry_refund_requested"),
  ));
}

async function balance(userId: string) {
  const [user] = await db.select({ walletBalance: usersTable.walletBalance }).from(usersTable).where(eq(usersTable.id, userId));
  return user?.walletBalance;
}

after(async () => {
  if (userIds.length) {
    await db.delete(walletLedgerEntriesTable).where(inArray(walletLedgerEntriesTable.userId, userIds));
    await db.delete(entriesTable).where(inArray(entriesTable.userId, userIds));
  }
  if (challengeIds.length) await db.delete(challengesTable).where(inArray(challengesTable.id, challengeIds));
  if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  await pool.end();
});

describe("card-paid entries refund to the original payment method", () => {
  it("leaving before the deadline refunds the entry fee and the platform fee to the card", async () => {
    const userId = await addUser();
    const challengeId = await addChallenge({ startDate: "2026-06-03", endDate: "2026-06-03" });
    await cardEntry(userId, challengeId, "pi_leave_test");
    const [entry] = await db.select().from(entriesTable).where(eq(entriesTable.userId, userId));
    assert.equal(entry.platformFeeCents, 200, "the platform fee is recorded on the entry");

    const result = await leaveChallenge(userId, challengeId, beforeStart);
    assert.equal(result.refunded, true);
    const [request] = await refundRequests(userId);
    assert.equal(request.amountCents, 1200);
    assert.equal(request.status, "pending_provider");
    assert.equal(request.metadata.refundTo, "original_payment_method");
    assert.equal(request.metadata.paymentReference, "pi_leave_test");
    assert.equal(await balance(userId), "0.00", "no wallet credit for a card-paid refund");
    const [challenge] = await db.select().from(challengesTable).where(eq(challengesTable.id, challengeId));
    assert.equal(challenge.prizePool, "0.00");
  });

  it("a no-finisher settlement refunds the entry fee to the card and keeps the platform fee", async () => {
    const userId = await addUser();
    const challengeId = await addChallenge();
    await cardEntry(userId, challengeId, "pi_no_finisher_test");
    const result = await settleChallenge(challengeId, new Date("2026-06-06T00:00:00Z"));
    assert.equal(result.finisherCount, 0);
    assert.equal(result.refundedTotal, 10);
    const [request] = await refundRequests(userId);
    assert.equal(request.amountCents, 1000);
    assert.equal(request.metadata.reason, "no_finishers");
    const [entry] = await db.select().from(entriesTable).where(eq(entriesTable.userId, userId));
    assert.equal(entry.settlementStatus, "refund_pending");
    assert.equal(entry.exitReason, "no_finishers");
  });

  it("a cancelled challenge refunds both fees, and an under-filled one is found at its start time", async () => {
    const userId = await addUser();
    const challengeId = await addChallenge({ startDate: "2026-06-10", endDate: "2026-06-12", days: 3, minParticipants: 2 });
    await activateProviderChallengeEntry(userId, challengeId, 1000, 200, 1200, "pi_cancel_test", new Date("2026-06-05T00:00:00Z"));
    assert.ok(!(await findUnderFilledPaidChallenges(new Date("2026-06-10T04:59:59Z"))).includes(challengeId), "not before start");
    assert.ok((await findUnderFilledPaidChallenges(new Date("2026-06-10T05:00:00Z"))).includes(challengeId), "at start in America/Chicago");

    const cancelled = await cancelChallengeWithRefunds(challengeId, "challenge_under_filled", new Date("2026-06-10T05:00:00Z"));
    assert.equal(cancelled.cancelled, true);
    assert.equal(cancelled.refundedCents, 1200);
    const [request] = await refundRequests(userId);
    assert.equal(request.amountCents, 1200);
    const again = await cancelChallengeWithRefunds(challengeId, "challenge_under_filled");
    assert.equal(again.cancelled, false, "cancellation is idempotent");
    assert.equal((await refundRequests(userId)).length, 1);
  });
});

describe("refund processor", () => {
  it("submits card refunds, credits the wallet when the card cannot be refunded, and retries transient errors", async () => {
    const submittedUser = await addUser();
    const fallbackUser = await addUser();
    const retryUser = await addUser();
    for (const [userId, reference] of [[submittedUser, "pi_ok"], [fallbackUser, "pi_expired"], [retryUser, "pi_flaky"]] as const) {
      const challengeId = await addChallenge({ startDate: "2026-06-03", endDate: "2026-06-03" });
      await cardEntry(userId, challengeId, reference);
      await leaveChallenge(userId, challengeId, beforeStart);
    }
    const calls: string[] = [];
    const outcomes: Record<string, ProviderRefundOutcome> = {
      pi_ok: { kind: "submitted", refundId: "re_123" },
      pi_expired: { kind: "cannot_refund_to_card", reason: "charge_expired_for_refund" },
      pi_flaky: { kind: "retry_later", reason: "rate_limit" },
    };
    await processPendingEntryRefunds({
      refundToCard: async ({ paymentIntentId }) => {
        calls.push(paymentIntentId);
        return outcomes[paymentIntentId] ?? { kind: "retry_later", reason: "unexpected" };
      },
    });
    assert.ok(["pi_ok", "pi_expired", "pi_flaky"].every((id) => calls.includes(id)));

    const [submitted] = await refundRequests(submittedUser);
    assert.equal(submitted.status, "submitted_to_provider");
    assert.equal(submitted.metadata.stripeRefundId, "re_123");

    const [fallback] = await refundRequests(fallbackUser);
    assert.equal(fallback.status, "wallet_fallback");
    assert.equal(await balance(fallbackUser), "12.00");
    assert.equal(await unwithdrawnRefundCreditCents(fallbackUser), 1200);

    const [retrying] = await refundRequests(retryUser);
    assert.equal(retrying.status, "pending_provider");
    assert.equal(retrying.metadata.refundAttempts, 1);
  });
});

describe("withdrawal minimum exemptions", () => {
  const provider = {
    getPayoutAccount: async () => ({ linked: true, payoutsEnabled: true }),
    createWithdrawal: async () => ({ transferId: "tr_test", payoutId: "po_test" }),
  };

  it("lets a wallet refund credit be withdrawn below $20, but nothing more", async () => {
    const userId = await addUser("15.00");
    await db.insert(walletLedgerEntriesTable).values({
      id: `${runId}-credit`, userId, eventType: "refund_wallet_credit", status: "recorded",
      amountCents: 1200, currency: "usd", idempotencyKey: `${runId}-credit`, metadata: {},
    });
    await assert.rejects(
      withdrawAvailableBalance(userId, { amountCents: 1500, idempotencyKey: `${runId}-std` }, provider as never),
      /at least \$20/,
    );
    await assert.rejects(
      withdrawAvailableBalance(userId, { amountCents: 1300, idempotencyKey: `${runId}-over`, purpose: "refund_credit" }, provider as never),
      /refund credits/,
    );
    const ok = await withdrawAvailableBalance(userId, { amountCents: 1200, idempotencyKey: `${runId}-refund`, purpose: "refund_credit" }, provider as never);
    assert.equal(ok.amountCents, 1200);
    assert.equal(await unwithdrawnRefundCreditCents(userId), 0);
  });

  it("pays the full balance on account closure regardless of the minimum", async () => {
    const userId = await addUser("7.25");
    await assert.rejects(
      withdrawAvailableBalance(userId, { amountCents: 500, idempotencyKey: `${runId}-partial-close`, purpose: "account_closure" }, provider as never),
      /full available balance/,
    );
    const ok = await withdrawAvailableBalance(userId, { amountCents: 725, idempotencyKey: `${runId}-close`, purpose: "account_closure" }, provider as never);
    assert.equal(ok.amountCents, 725);
    assert.equal(await balance(userId), "0.00");
  });

  it("blocks standard withdrawals from a restricted state but not closure payouts", async () => {
    const userId = await addUser("40.00");
    await db.update(usersTable).set({ eligibilityState: "AZ" }).where(eq(usersTable.id, userId));
    await assert.rejects(
      withdrawAvailableBalance(userId, { amountCents: 2000, idempotencyKey: `${runId}-az` }, provider as never),
      /permitted/,
    );
    const ok = await withdrawAvailableBalance(userId, { amountCents: 4000, idempotencyKey: `${runId}-az-close`, purpose: "account_closure" }, provider as never);
    assert.equal(ok.amountCents, 4000);
  });
});
