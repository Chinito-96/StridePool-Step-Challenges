import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "./index";
import { challengesTable, dailyStepRecordsTable, entriesTable, usersTable } from "./schema";

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

export class MoneyLogicError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "INSUFFICIENT_FUNDS" | "ALREADY_STARTED" | "ALREADY_SETTLED" | "INVALID_FREE_CHALLENGE") {
    super(code);
  }
}

const cents = (value: string | number | null | undefined) => Math.round(Number(value ?? 0) * 100);
const dollars = (value: number) => Number((value / 100).toFixed(2));
const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

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

    if (existing) {
      const [reactivated] = await tx.update(entriesTable).set({ status: "active", joinedAt: now, leftAt: null }).where(and(eq(entriesTable.id, existing.id), eq(entriesTable.status, "left"))).returning();
      if (!reactivated) return { wallet: walletFor(user), charged: false, refunded: false, freeCommunity: false };
    } else {
      const [inserted] = await tx.insert(entriesTable).values({ userId, challengeId, entryFee: (feeCents / 100).toFixed(2), status: "active", joinedAt: now }).onConflictDoNothing().returning();
      if (!inserted) return { wallet: walletFor(user), charged: false, refunded: false, freeCommunity: false };
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
    return { wallet: walletFor(updatedUser), charged: true, refunded: false, freeCommunity: false };
  });
}

export async function leaveChallenge(userId: string, challengeId: string, now = new Date()): Promise<EntryTransactionResult> {
  return db.transaction(async (tx) => {
    const [challenge] = await tx.select().from(challengesTable).where(eq(challengesTable.id, challengeId));
    const [entry] = await tx.select().from(entriesTable).where(and(eq(entriesTable.userId, userId), eq(entriesTable.challengeId, challengeId), eq(entriesTable.status, "active")));
    const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!challenge || !entry || !user) throw new MoneyLogicError("NOT_FOUND");
    if (now >= toDate(challenge.startDate)) throw new MoneyLogicError("ALREADY_STARTED");

    const [leftEntry] = await tx.update(entriesTable).set({ status: "left", leftAt: now }).where(and(eq(entriesTable.id, entry.id), eq(entriesTable.status, "active"))).returning();
    if (!leftEntry) return { wallet: walletFor(user), charged: false, refunded: false, freeCommunity: challenge.community || cents(entry.entryFee) === 0 };

    const feeCents = cents(entry.entryFee);
    const freeCommunity = challenge.community || feeCents === 0;
    if (freeCommunity) {
      await tx.update(challengesTable).set({
        participantCount: sql`greatest(${challengesTable.participantCount} - 1, 0)`,
      }).where(eq(challengesTable.id, challengeId));
      return { wallet: walletFor(user), charged: false, refunded: false, freeCommunity: true };
    }

    const [updatedUser] = await tx.update(usersTable).set({
      walletBalance: sql`${usersTable.walletBalance} + ${(feeCents / 100).toFixed(2)}`,
      walletPending: sql`greatest(${usersTable.walletPending} - ${(feeCents / 100).toFixed(2)}, 0)`,
    }).where(eq(usersTable.id, userId)).returning();
    await tx.update(challengesTable).set({
      participantCount: sql`greatest(${challengesTable.participantCount} - 1, 0)`,
      prizePool: sql`greatest(${challengesTable.prizePool} - ${(feeCents / 100).toFixed(2)}, 0)`,
    }).where(eq(challengesTable.id, challengeId));
    return { wallet: walletFor(updatedUser), charged: false, refunded: true, freeCommunity: false };
  });
}

export async function settleChallenge(challengeId: string, now = new Date()): Promise<SettlementResult> {
  return db.transaction(async (tx) => {
    const [challenge] = await tx.select().from(challengesTable).where(eq(challengesTable.id, challengeId));
    if (!challenge) throw new MoneyLogicError("NOT_FOUND");
    if (challenge.settlementStatus === "settled") {
      const poolTotal = cents(challenge.settledPool);
      return {
        challengeId,
        poolTotal: dollars(poolTotal),
        finisherCount: challenge.finishers,
        perFinisherBase: challenge.finishers ? dollars(Math.floor(poolTotal / challenge.finishers)) : 0,
        roundingRemainder: challenge.finishers ? poolTotal % challenge.finishers : 0,
        refundedTotal: 0,
        alreadySettled: true,
      };
    }
    if (challenge.community || cents(challenge.entryFee) === 0) {
      await tx.update(entriesTable).set({ settlementStatus: "free-complete", settlementAmount: "0.00", settledAt: now }).where(and(eq(entriesTable.challengeId, challengeId), eq(entriesTable.status, "active")));
      await tx.update(challengesTable).set({ settlementStatus: "settled", settledAt: now, settledPool: "0.00", finishers: 0 }).where(eq(challengesTable.id, challengeId));
      return { challengeId, poolTotal: 0, finisherCount: 0, perFinisherBase: 0, roundingRemainder: 0, refundedTotal: 0, alreadySettled: false };
    }

    const entries = await tx.select().from(entriesTable).where(and(eq(entriesTable.challengeId, challengeId), eq(entriesTable.status, "active")));
    const records = await tx.select().from(dailyStepRecordsTable).where(eq(dailyStepRecordsTable.challengeId, challengeId));
    const dates = challengeDates(challenge.startDate, challenge.days);
    const users = entries.length
      ? await tx.select().from(usersTable).where(inArray(usersTable.id, entries.map((entry) => entry.userId)))
      : [];
    const userMap = new Map(users.map((user) => [user.id, user]));
    const finisherEntries = entries.filter((entry) => {
      const user = userMap.get(entry.userId);
      const goal = challenge.goalType === "personalized" ? Number(user?.goalBaseline ?? challenge.dailyGoal) : challenge.dailyGoal;
      const missedDays = dates.filter((date) => {
        const record = records.find((candidate) => candidate.userId === entry.userId && candidate.recordDate === date);
        return !record || !record.verified || record.steps < goal;
      }).length;
      return missedDays <= challenge.graceDays;
    });

    const poolTotalCents = cents(challenge.prizePool);
    const finisherCount = finisherEntries.length;
    const baseCents = finisherCount ? Math.floor(poolTotalCents / finisherCount) : 0;
    const remainder = finisherCount ? poolTotalCents % finisherCount : 0;
    const finisherIds = new Set(finisherEntries.map((entry) => entry.id));
    let refundedTotalCents = 0;

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const feeCents = cents(entry.entryFee);
      const user = userMap.get(entry.userId);
      if (!user) throw new MoneyLogicError("NOT_FOUND");
      if (finisherCount === 0) {
        await tx.update(usersTable).set({
          walletBalance: sql`${usersTable.walletBalance} + ${(feeCents / 100).toFixed(2)}`,
          walletPending: sql`greatest(${usersTable.walletPending} - ${(feeCents / 100).toFixed(2)}, 0)`,
        }).where(eq(usersTable.id, user.id));
        await tx.update(entriesTable).set({ settlementStatus: "refunded", settlementAmount: (feeCents / 100).toFixed(2), settledAt: now }).where(eq(entriesTable.id, entry.id));
        refundedTotalCents += feeCents;
        continue;
      }

      const isFinisher = finisherIds.has(entry.id);
      const payoutCents = isFinisher
        ? baseCents + (finisherEntries.findIndex((candidate) => candidate.id === entry.id) < remainder ? 1 : 0)
        : 0;
      await tx.update(usersTable).set({
        walletBalance: sql`${usersTable.walletBalance} + ${(payoutCents / 100).toFixed(2)}`,
        walletPending: sql`greatest(${usersTable.walletPending} - ${(feeCents / 100).toFixed(2)}, 0)`,
        totalEarned: sql`${usersTable.totalEarned} + ${(payoutCents / 100).toFixed(2)}`,
      }).where(eq(usersTable.id, user.id));
      await tx.update(entriesTable).set({
        settlementStatus: isFinisher ? "paid" : "forfeited",
        settlementAmount: (payoutCents / 100).toFixed(2),
        settledAt: now,
      }).where(eq(entriesTable.id, entry.id));
    }

    await tx.update(challengesTable).set({
      settlementStatus: "settled",
      settledAt: now,
      settledPool: (poolTotalCents / 100).toFixed(2),
      finishers: finisherCount,
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