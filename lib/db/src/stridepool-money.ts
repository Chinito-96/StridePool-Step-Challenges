import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { db } from "./index";
import { challengesTable, dailyStepRecordsTable, entriesTable, usersTable, walletLedgerEntriesTable } from "./schema";
import { membershipPolicyFor } from "./stridepool-membership";
import { allocateEqualSplit, isSettlementHoldActive, refundCentsFor, zonedMidnightUtc, type EntryExitReason } from "./stridepool-paid-play-policy";

export type WalletSnapshot = {
  balance: number;
  pending: number;
  totalEarned: number;
};

export type EntryTransactionResult = {
  wallet: WalletSnapshot;
  charged: boolean;
  refunded: boolean;
  freeCommunity: boolean;
};

export type SettlementResult = {
  challengeId: string;
  poolTotal: number;
  finisherCount: number;
  perFinisherBase: number;
  roundingRemainder: number;
  refundedTotal: number;
  alreadySettled: boolean;
};

export type PodiumPayout = { entryId: number; rank: number; payoutCents: number };

export function calculatePodiumPayouts(
  ranked: Array<{ entryId: number; steps: number }>,
  poolTotalCents: number,
): PodiumPayout[] {
  const shares = [60, 25, 15];
  const groups: Array<{ rank: number; entries: Array<{ entryId: number; steps: number }> }> = [];
  for (const entry of ranked.slice().sort((a, b) => b.steps - a.steps || a.entryId - b.entryId)) {
    const previous = groups.at(-1);
    if (previous?.entries[0]?.steps === entry.steps) previous.entries.push(entry);
    else groups.push({ rank: previous ? previous.rank + previous.entries.length : 1, entries: [entry] });
  }
  const payouts: PodiumPayout[] = [];
  for (const group of groups) {
    if (group.rank > 3) break;
    const combinedPercent = shares.slice(group.rank - 1, Math.min(3, group.rank - 1 + group.entries.length)).reduce((sum, value) => sum + value, 0);
    const groupCents = Math.floor(poolTotalCents * combinedPercent / 100);
    const base = Math.floor(groupCents / group.entries.length);
    const remainder = groupCents % group.entries.length;
    group.entries.forEach((entry, index) => payouts.push({ entryId: entry.entryId, rank: group.rank, payoutCents: base + (index < remainder ? 1 : 0) }));
  }
  const assigned = payouts.reduce((sum, payout) => sum + payout.payoutCents, 0);
  if (payouts.length && assigned < poolTotalCents) payouts[0].payoutCents += poolTotalCents - assigned;
  return payouts;
}

export class MoneyLogicError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "INSUFFICIENT_FUNDS" | "ALREADY_STARTED" | "ALREADY_SETTLED" | "INVALID_FREE_CHALLENGE" | "CHALLENGE_LIMIT" | "PRICE_MISMATCH" | "SETTLEMENT_HOLD") {
    super(code);
  }
}

const cents = (value: string | number | null | undefined) => Math.round(Number(value ?? 0) * 100);
const dollars = (value: number) => Number((value / 100).toFixed(2));
const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

type MoneyTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Paid Play Terms §5.4: refunds of card-paid entries go back to the original
 * payment method. The provider refund is issued outside this transaction by
 * the refund processor, which reads these pending ledger rows.
 */
async function requestOriginalMethodRefund(
  tx: MoneyTx,
  entry: typeof entriesTable.$inferSelect,
  reason: EntryExitReason,
  now: Date,
): Promise<number> {
  const refundCents = refundCentsFor(reason, cents(entry.entryFee), entry.platformFeeCents);
  if (refundCents > 0) {
    await tx.insert(walletLedgerEntriesTable).values({
      id: `ledger_refund_request_${randomUUID()}`,
      userId: entry.userId,
      eventType: "entry_refund_requested",
      status: "pending_provider",
      amountCents: refundCents,
      currency: "usd",
      idempotencyKey: `entry_refund:${entry.id}:${reason}`,
      challengeId: entry.challengeId,
      metadata: {
        source: "paid_play_terms_5_3",
        entryId: entry.id,
        reason,
        refundTo: "original_payment_method",
        paymentReference: entry.paymentReference,
        entryFeeCents: cents(entry.entryFee),
        platformFeeCents: entry.platformFeeCents,
      },
      createdAt: now,
    }).onConflictDoNothing();
  }
  return refundCents;
}

function walletFor(user: typeof usersTable.$inferSelect): WalletSnapshot {
  return {
    balance: Number(user.walletBalance ?? 0),
    pending: Number(user.walletPending ?? 0),
    totalEarned: Number(user.totalEarned ?? 0),
  };
}

function challengeDates(startDate: string, days: number): string[] {
  return Array.from({ length: days }, (_, index) => {
    const date = toDate(startDate);
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

export async function joinChallenge(userId: string, challengeId: string, now = new Date()): Promise<EntryTransactionResult> {
  return db.transaction(async (tx) => {
    const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, userId));
    const [challenge] = await tx.select().from(challengesTable).where(eq(challengesTable.id, challengeId));
    if (!user || !challenge) throw new MoneyLogicError("NOT_FOUND");
    if (challenge.settlementStatus === "settled") throw new MoneyLogicError("ALREADY_SETTLED");

    const feeCents = cents(challenge.entryFee);
    const freeCommunity = challenge.community || feeCents === 0;
    if (challenge.community && feeCents !== 0) throw new MoneyLogicError("INVALID_FREE_CHALLENGE");
    if (now >= toDate(challenge.startDate)) throw new MoneyLogicError("ALREADY_STARTED");

    const [existing] = await tx.select().from(entriesTable).where(and(eq(entriesTable.userId, userId), eq(entriesTable.challengeId, challengeId)));
    if (existing?.status === "active") return { wallet: walletFor(user), charged: false, refunded: false, freeCommunity };
    const today = now.toISOString().slice(0, 10);
    const [active] = await tx.select({ count: sql<number>`count(*)` })
      .from(entriesTable)
      .innerJoin(challengesTable, eq(entriesTable.challengeId, challengesTable.id))
      .where(and(eq(entriesTable.userId, userId), eq(entriesTable.status, "active"), gte(challengesTable.endDate, today), ne(challengesTable.settlementStatus, "settled")));
    if (Number(active?.count ?? 0) >= membershipPolicyFor(user).activeChallengeLimit) {
      throw new MoneyLogicError("CHALLENGE_LIMIT");
    }

    if (freeCommunity) {
      if (existing) {
        const [reactivated] = await tx.update(entriesTable).set({ status: "active", joinedAt: now, leftAt: null }).where(and(eq(entriesTable.id, existing.id), eq(entriesTable.status, "left"))).returning();
        if (!reactivated) return { wallet: walletFor(user), charged: false, refunded: false, freeCommunity: true };
      } else {
        const [inserted] = await tx.insert(entriesTable).values({ userId, challengeId, entryFee: "0.00", status: "active", joinedAt: now }).onConflictDoNothing().returning();
        if (!inserted) return { wallet: walletFor(user), charged: false, refunded: false, freeCommunity: true };
      }
      await tx.update(challengesTable).set({
        participantCount: sql`${challengesTable.participantCount} + 1`,
      }).where(eq(challengesTable.id, challengeId));
      return { wallet: walletFor(user), charged: false, refunded: false, freeCommunity: true };
    }

    let entryId = existing?.id;
    if (existing) {
      const [reactivated] = await tx.update(entriesTable).set({ status: "active", joinedAt: now, leftAt: null }).where(and(eq(entriesTable.id, existing.id), eq(entriesTable.status, "left"))).returning();
      if (!reactivated) return { wallet: walletFor(user), charged: false, refunded: false, freeCommunity: false };
      entryId = reactivated.id;
    } else {
      const [inserted] = await tx.insert(entriesTable).values({ userId, challengeId, entryFee: (feeCents / 100).toFixed(2), status: "active", joinedAt: now }).onConflictDoNothing().returning();
      if (!inserted) return { wallet: walletFor(user), charged: false, refunded: false, freeCommunity: false };
      entryId = inserted.id;
    }
    const [updatedUser] = await tx.update(usersTable).set({
      walletBalance: sql`${usersTable.walletBalance} - ${(feeCents / 100).toFixed(2)}`,
      walletPending: sql`${usersTable.walletPending} + ${(feeCents / 100).toFixed(2)}`,
    }).where(and(eq(usersTable.id, userId), gte(usersTable.walletBalance, (feeCents / 100).toFixed(2)))).returning();
    if (!updatedUser) throw new MoneyLogicError("INSUFFICIENT_FUNDS");
    await tx.update(challengesTable).set({
      participantCount: sql`${challengesTable.participantCount} + 1`,
      prizePool: sql`${challengesTable.prizePool} + ${(feeCents / 100).toFixed(2)}`,
    }).where(eq(challengesTable.id, challengeId));
    await tx.insert(walletLedgerEntriesTable).values({
      id: `ledger_entry_${randomUUID()}`,
      userId,
      eventType: "entry_committed",
      status: "recorded",
      amountCents: feeCents,
      currency: "usd",
      idempotencyKey: `challenge_join:${entryId}:${now.toISOString()}`,
      challengeId,
      metadata: { source: "challenge_join", entryId },
      createdAt: now,
    });
    return { wallet: walletFor(updatedUser), charged: true, refunded: false, freeCommunity: false };
  });
}

export async function activateProviderChallengeEntry(
  userId: string,
  challengeId: string,
  challengeEntryCents: number,
  platformFeeCents: number,
  totalAmountCents: number,
  paymentReference: string,
  now = new Date(),
): Promise<{ activated: boolean }> {
  return db.transaction(async (tx) => {
    const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).for("update");
    const [challenge] = await tx.select().from(challengesTable).where(eq(challengesTable.id, challengeId));
    if (!user || !challenge) throw new MoneyLogicError("NOT_FOUND");
    if (challenge.settlementStatus === "settled") throw new MoneyLogicError("ALREADY_SETTLED");
    if (now >= toDate(challenge.startDate)) throw new MoneyLogicError("ALREADY_STARTED");
    const expectedEntryCents = cents(challenge.entryFee);
    const expectedPlatformFeeCents = membershipPolicyFor(user).challengeJoinPriceCents;
    if (challengeEntryCents !== expectedEntryCents
      || platformFeeCents !== expectedPlatformFeeCents
      || totalAmountCents !== challengeEntryCents + platformFeeCents) {
      throw new MoneyLogicError("PRICE_MISMATCH");
    }
    const [existing] = await tx.select().from(entriesTable)
      .where(and(eq(entriesTable.userId, userId), eq(entriesTable.challengeId, challengeId)));
    if (existing?.status === "active") return { activated: false };
    const today = now.toISOString().slice(0, 10);
    const [active] = await tx.select({ count: sql<number>`count(*)` })
      .from(entriesTable)
      .innerJoin(challengesTable, eq(entriesTable.challengeId, challengesTable.id))
      .where(and(eq(entriesTable.userId, userId), eq(entriesTable.status, "active"), gte(challengesTable.endDate, today), ne(challengesTable.settlementStatus, "settled")));
    if (Number(active?.count ?? 0) >= membershipPolicyFor(user).activeChallengeLimit) {
      throw new MoneyLogicError("CHALLENGE_LIMIT");
    }
    const amount = (challengeEntryCents / 100).toFixed(2);
    if (existing) {
      await tx.update(entriesTable).set({
        status: "active",
        entryFee: amount,
        joinedAt: now,
        leftAt: null,
        paymentProvider: "Stripe",
        paymentReference,
        platformFeeCents,
        exitReason: null,
      }).where(eq(entriesTable.id, existing.id));
    } else {
      await tx.insert(entriesTable).values({
        userId,
        challengeId,
        status: "active",
        entryFee: amount,
        joinedAt: now,
        paymentProvider: "Stripe",
        paymentReference,
        platformFeeCents,
      });
    }
    await tx.update(challengesTable).set({
      participantCount: sql`${challengesTable.participantCount} + 1`,
      prizePool: sql`${challengesTable.prizePool} + ${amount}`,
    }).where(eq(challengesTable.id, challengeId));
    return { activated: true };
  });
}

export async function leaveChallenge(userId: string, challengeId: string, now = new Date()): Promise<EntryTransactionResult> {
  return db.transaction(async (tx) => {
    const [challenge] = await tx.select().from(challengesTable).where(eq(challengesTable.id, challengeId));
    const [entry] = await tx.select().from(entriesTable).where(and(eq(entriesTable.userId, userId), eq(entriesTable.challengeId, challengeId), eq(entriesTable.status, "active")));
    const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!challenge || !entry || !user) throw new MoneyLogicError("NOT_FOUND");
    if (now >= toDate(challenge.startDate)) throw new MoneyLogicError("ALREADY_STARTED");

    const [leftEntry] = await tx.update(entriesTable).set({ status: "left", leftAt: now, exitReason: "left_before_deadline" }).where(and(eq(entriesTable.id, entry.id), eq(entriesTable.status, "active"))).returning();
    if (!leftEntry) return { wallet: walletFor(user), charged: false, refunded: false, freeCommunity: cents(entry.entryFee) === 0 };

    const feeCents = cents(entry.entryFee);
    const freeCommunity = feeCents === 0;
    if (freeCommunity) {
      await tx.update(challengesTable).set({
        participantCount: sql`greatest(${challengesTable.participantCount} - 1, 0)`,
      }).where(eq(challengesTable.id, challengeId));
      return { wallet: walletFor(user), charged: false, refunded: false, freeCommunity: true };
    }

    if (entry.paymentReference) {
      // Card-paid entry: entry fee and platform fee both go back to the card (§5.3, §5.4).
      await tx.update(challengesTable).set({
        participantCount: sql`greatest(${challengesTable.participantCount} - 1, 0)`,
        prizePool: sql`greatest(${challengesTable.prizePool} - ${(feeCents / 100).toFixed(2)}, 0)`,
      }).where(eq(challengesTable.id, challengeId));
      await requestOriginalMethodRefund(tx, entry, "left_before_deadline", now);
      return { wallet: walletFor(user), charged: false, refunded: true, freeCommunity: false };
    }

    const [updatedUser] = await tx.update(usersTable).set({
      walletBalance: sql`${usersTable.walletBalance} + ${(feeCents / 100).toFixed(2)}`,
      walletPending: sql`greatest(${usersTable.walletPending} - ${(feeCents / 100).toFixed(2)}, 0)`,
    }).where(eq(usersTable.id, userId)).returning();
    await tx.update(challengesTable).set({
      participantCount: sql`greatest(${challengesTable.participantCount} - 1, 0)`,
      prizePool: sql`greatest(${challengesTable.prizePool} - ${(feeCents / 100).toFixed(2)}, 0)`,
    }).where(eq(challengesTable.id, challengeId));
    await tx.insert(walletLedgerEntriesTable).values({
      id: `ledger_refund_${randomUUID()}`,
      userId,
      eventType: "entry_refunded",
      status: "recorded",
      amountCents: feeCents,
      currency: "usd",
      idempotencyKey: `challenge_leave:${entry.id}`,
      challengeId,
      metadata: { source: "challenge_leave", entryId: entry.id },
      createdAt: now,
    });
    return { wallet: walletFor(updatedUser), charged: false, refunded: true, freeCommunity: false };
  });
}

export async function settleChallenge(challengeId: string, now = new Date()): Promise<SettlementResult> {
  return db.transaction(async (tx) => {
    const [existingChallenge] = await tx.select().from(challengesTable).where(eq(challengesTable.id, challengeId));
    if (!existingChallenge) throw new MoneyLogicError("NOT_FOUND");
    if (existingChallenge.settlementStatus === "settled") {
      const poolTotal = cents(existingChallenge.settledPool);
      return {
        challengeId,
        poolTotal: dollars(poolTotal),
        finisherCount: existingChallenge.finishers,
        perFinisherBase: existingChallenge.finishers ? dollars(Math.floor(poolTotal / existingChallenge.finishers)) : 0,
        roundingRemainder: existingChallenge.finishers ? poolTotal % existingChallenge.finishers : 0,
        refundedTotal: 0,
        alreadySettled: true,
      };
    }
    // Paid Play Terms §7.6: no settlement until the final sync window and review period close.
    if (cents(existingChallenge.prizePool) > 0 && isSettlementHoldActive(existingChallenge.endDate, existingChallenge.timeZone, now)) {
      throw new MoneyLogicError("SETTLEMENT_HOLD");
    }
    const [challenge] = await tx.update(challengesTable).set({ settlementStatus: "settling" }).where(and(eq(challengesTable.id, challengeId), eq(challengesTable.settlementStatus, "open"))).returning();
    if (!challenge) {
      const [settled] = await tx.select().from(challengesTable).where(eq(challengesTable.id, challengeId));
      if (settled?.settlementStatus === "settled") {
        const poolTotal = cents(settled.settledPool);
        return {
          challengeId,
          poolTotal: dollars(poolTotal),
          finisherCount: settled.finishers,
          perFinisherBase: settled.finishers ? dollars(Math.floor(poolTotal / settled.finishers)) : 0,
          roundingRemainder: settled.finishers ? poolTotal % settled.finishers : 0,
          refundedTotal: 0,
          alreadySettled: true,
        };
      }
      throw new MoneyLogicError("ALREADY_SETTLED");
    }
    if (cents(challenge.prizePool) === 0) {
      await tx.update(entriesTable).set({ settlementStatus: "free-complete", settlementAmount: "0.00", settledAt: now }).where(and(eq(entriesTable.challengeId, challengeId), eq(entriesTable.status, "active")));
      await tx.update(challengesTable).set({
        settlementStatus: "settled",
        settledAt: now,
        settledPool: "0.00",
        finishers: 0,
        closeoutFailureCount: 0,
        closeoutLastFailedAt: null,
        closeoutAlertClaimId: null,
        closeoutAlertClaimedAt: null,
        closeoutAlertSentAt: null,
      }).where(eq(challengesTable.id, challengeId));
      return { challengeId, poolTotal: 0, finisherCount: 0, perFinisherBase: 0, roundingRemainder: 0, refundedTotal: 0, alreadySettled: false };
    }

    const entries = await tx.select().from(entriesTable).where(and(eq(entriesTable.challengeId, challengeId), eq(entriesTable.status, "active")));
    const records = await tx.select().from(dailyStepRecordsTable).where(eq(dailyStepRecordsTable.challengeId, challengeId));
    const dates = challengeDates(challenge.startDate, challenge.days);
    const users = entries.length
      ? await tx.select().from(usersTable).where(inArray(usersTable.id, entries.map((entry) => entry.userId)))
      : [];
    const userMap = new Map(users.map((user) => [user.id, user]));
    const finisherEntries = challenge.challengeType === "ranking" ? entries : entries.filter((entry) => {
      const user = userMap.get(entry.userId);
      const goal = challenge.goalType === "personalized" ? Number(user?.goalBaseline ?? challenge.dailyGoal) : challenge.dailyGoal;
      const missedDays = dates.filter((date) => {
        const record = records.find((candidate) => candidate.userId === entry.userId && candidate.recordDate === date);
        return !record || !record.verified || record.steps < goal;
      }).length;
      return missedDays === 0;
    });

    const poolTotalCents = cents(challenge.prizePool);
    const finisherCount = finisherEntries.length;
    const podiumPayouts = challenge.challengeType === "ranking" ? calculatePodiumPayouts(entries.map((entry) => ({
      entryId: entry.id,
      steps: records.filter((record) => record.userId === entry.userId && record.verified && record.recordDate >= challenge.startDate && record.recordDate <= challenge.endDate).reduce((sum, record) => sum + record.steps, 0),
    })), poolTotalCents) : [];
    const podiumMap = new Map(podiumPayouts.map((payout) => [payout.entryId, payout]));
    const baseCents = challenge.challengeType === "ranking" ? 0 : finisherCount ? Math.floor(poolTotalCents / finisherCount) : 0;
    const remainder = challenge.challengeType === "ranking" ? 0 : finisherCount ? poolTotalCents % finisherCount : 0;
    // §4.3: leftover cents go to finishers in join (entry id) order.
    const equalSplit = new Map(challenge.challengeType === "ranking"
      ? []
      : allocateEqualSplit(poolTotalCents, finisherEntries).map(({ entry, payoutCents }) => [entry.id, payoutCents]));
    const finisherIds = new Set(finisherEntries.map((entry) => entry.id));
    let refundedTotalCents = 0;

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const feeCents = cents(entry.entryFee);
      const user = userMap.get(entry.userId);
      if (!user) throw new MoneyLogicError("NOT_FOUND");
      if (finisherCount === 0 && entry.paymentReference) {
        // §4.4 + §5.3: entry fee back to the card; the platform fee is retained.
        const refunded = await requestOriginalMethodRefund(tx, entry, "no_finishers", now);
        await tx.update(entriesTable).set({ settlementStatus: "refund_pending", settlementAmount: (refunded / 100).toFixed(2), settledAt: now, exitReason: "no_finishers" }).where(eq(entriesTable.id, entry.id));
        refundedTotalCents += refunded;
        continue;
      }
      if (finisherCount === 0) {
        await tx.update(usersTable).set({
          walletBalance: sql`${usersTable.walletBalance} + ${(feeCents / 100).toFixed(2)}`,
          walletPending: sql`greatest(${usersTable.walletPending} - ${(feeCents / 100).toFixed(2)}, 0)`,
        }).where(eq(usersTable.id, user.id));
        await tx.update(entriesTable).set({ settlementStatus: "refunded", settlementAmount: (feeCents / 100).toFixed(2), settledAt: now }).where(eq(entriesTable.id, entry.id));
        await tx.insert(walletLedgerEntriesTable).values({
          id: `ledger_settlement_refund_${entry.id}`,
          userId: user.id,
          eventType: "settlement_refunded",
          status: "recorded",
          amountCents: feeCents,
          currency: "usd",
           idempotencyKey: `challenge_settlement:${challengeId}:${entry.id}`,
          challengeId,
          metadata: { source: "challenge_settlement", entryId: entry.id },
          createdAt: now,
        });
        refundedTotalCents += feeCents;
        continue;
      }

      const podiumPayout = podiumMap.get(entry.id);
      const isFinisher = challenge.challengeType === "ranking" ? Boolean(podiumPayout) : finisherIds.has(entry.id);
      const payoutCents = challenge.challengeType === "ranking" ? podiumPayout?.payoutCents ?? 0 : isFinisher
        ? equalSplit.get(entry.id) ?? 0
        : 0;
      await tx.update(usersTable).set({
        walletBalance: sql`${usersTable.walletBalance} + ${(payoutCents / 100).toFixed(2)}`,
        walletPending: sql`greatest(${usersTable.walletPending} - ${(feeCents / 100).toFixed(2)}, 0)`,
        totalEarned: sql`${usersTable.totalEarned} + ${(payoutCents / 100).toFixed(2)}`,
      }).where(eq(usersTable.id, user.id));
      await tx.update(entriesTable).set({
        settlementStatus: isFinisher ? "paid" : "forfeited",
        exitReason: isFinisher ? null : "did_not_finish",
        settlementAmount: (payoutCents / 100).toFixed(2),
        settledAt: now,
      }).where(eq(entriesTable.id, entry.id));
      await tx.insert(walletLedgerEntriesTable).values({
        id: `ledger_settlement_${entry.id}`,
        userId: user.id,
        eventType: isFinisher ? "settlement_earned" : "settlement_forfeited",
        status: "recorded",
        amountCents: payoutCents,
        currency: "usd",
         idempotencyKey: `challenge_settlement:${challengeId}:${entry.id}`,
        challengeId,
         metadata: { source: "challenge_settlement", entryId: entry.id, committedCents: feeCents, ...(podiumPayout ? { podiumRank: podiumPayout.rank } : {}) },
        createdAt: now,
      });
    }
    if (finisherCount === 0) refundedTotalCents = poolTotalCents;

    await tx.update(challengesTable).set({
      settlementStatus: "settled",
      settledAt: now,
      settledPool: (poolTotalCents / 100).toFixed(2),
      finishers: finisherCount,
      closeoutFailureCount: 0,
      closeoutLastFailedAt: null,
      closeoutAlertClaimId: null,
      closeoutAlertClaimedAt: null,
      closeoutAlertSentAt: null,
    }).where(eq(challengesTable.id, challengeId));
    return {
      challengeId,
      poolTotal: dollars(poolTotalCents),
      finisherCount,
      perFinisherBase: dollars(baseCents),
      roundingRemainder: remainder,
      refundedTotal: dollars(refundedTotalCents),
      alreadySettled: false,
    };
  });
}

export type CancellationResult = { challengeId: string; cancelled: boolean; refundedEntries: number; refundedCents: number };

/**
 * Paid Play Terms §4.5 and §5.3: when StridePool cancels a challenge, or it
 * is under-filled at its start time, every entry fee and platform fee is
 * refunded. Card-paid entries refund to the card; legacy wallet entries are
 * credited back to the wallet.
 */
export async function cancelChallengeWithRefunds(
  challengeId: string,
  reason: Extract<EntryExitReason, "challenge_cancelled" | "challenge_under_filled" | "challenge_voided">,
  now = new Date(),
): Promise<CancellationResult> {
  return db.transaction(async (tx) => {
    const [challenge] = await tx.update(challengesTable).set({ settlementStatus: "settling" })
      .where(and(eq(challengesTable.id, challengeId), eq(challengesTable.settlementStatus, "open")))
      .returning();
    if (!challenge) return { challengeId, cancelled: false, refundedEntries: 0, refundedCents: 0 };
    const entries = await tx.select().from(entriesTable)
      .where(and(eq(entriesTable.challengeId, challengeId), eq(entriesTable.status, "active")));
    let refundedCents = 0;
    for (const entry of entries) {
      const feeCents = cents(entry.entryFee);
      if (entry.paymentReference) {
        refundedCents += await requestOriginalMethodRefund(tx, entry, reason, now);
      } else if (feeCents > 0) {
        await tx.update(usersTable).set({
          walletBalance: sql`${usersTable.walletBalance} + ${(feeCents / 100).toFixed(2)}`,
          walletPending: sql`greatest(${usersTable.walletPending} - ${(feeCents / 100).toFixed(2)}, 0)`,
        }).where(eq(usersTable.id, entry.userId));
        await tx.insert(walletLedgerEntriesTable).values({
          id: `ledger_cancel_refund_${entry.id}`,
          userId: entry.userId,
          eventType: "entry_refunded",
          status: "recorded",
          amountCents: feeCents,
          currency: "usd",
          idempotencyKey: `challenge_cancel:${challengeId}:${entry.id}`,
          challengeId,
          metadata: { source: "challenge_cancellation", entryId: entry.id, reason },
          createdAt: now,
        }).onConflictDoNothing();
        refundedCents += feeCents;
      }
      await tx.update(entriesTable).set({
        settlementStatus: "refunded",
        settlementAmount: (feeCents / 100).toFixed(2),
        settledAt: now,
        exitReason: reason,
      }).where(eq(entriesTable.id, entry.id));
    }
    await tx.update(challengesTable).set({
      settlementStatus: "settled",
      settledAt: now,
      settledPool: "0.00",
      prizePool: "0.00",
      finishers: 0,
    }).where(eq(challengesTable.id, challengeId));
    return { challengeId, cancelled: true, refundedEntries: entries.length, refundedCents };
  });
}

/** Paid challenges that reached their start time below their minimum participant count (§4.5). */
export async function findUnderFilledPaidChallenges(now = new Date()): Promise<string[]> {
  const candidates = await db.select().from(challengesTable).where(and(
    eq(challengesTable.settlementStatus, "open"),
    eq(challengesTable.community, false),
  ));
  return candidates
    .filter((challenge) => cents(challenge.entryFee) > 0)
    .filter((challenge) => now >= zonedMidnightUtc(challenge.startDate, challenge.timeZone))
    .filter((challenge) => challenge.participantCount < challenge.minParticipants)
    .map((challenge) => challenge.id);
}
