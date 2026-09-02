import {
  GetAdminChallengesResponse,
  GetAdminFlaggedStepRecordsResponse,
  GetAdminSettlementHistoryResponse,
  GetAdminUserResponse,
  SearchAdminUsersResponse,
} from "@workspace/api-zod";
import {
  challengesTable,
  dailyStepRecordsTable,
  db,
  entriesTable,
  stepSourceSamplesTable,
  usersTable,
  walletLedgerEntriesTable,
} from "@workspace/db";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();

function numberValue(value: string | number | null | undefined): number {
  return Number(value ?? 0);
}

async function requireAdmin(req: Request, res: Response): Promise<string | null> {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Login required." });
    return null;
  }
  const [user] = await db
    .select({ id: usersTable.id, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, req.user.id));
  if (!user || user.role !== "admin") {
    res.status(403).json({ error: "Admin access required." });
    return null;
  }
  return user.id;
}

function displayName(user: typeof usersTable.$inferSelect): string {
  return user.displayName || [user.firstName, user.lastName].filter(Boolean).join(" ") || "StridePool walker";
}

function challengeStatus(challenge: typeof challengesTable.$inferSelect, today: string): "open" | "active" | "settling" | "settled" {
  if (challenge.settlementStatus === "settled") return "settled";
  if (challenge.settlementStatus === "settling" || challenge.settlementStatus === "pending_review" || challenge.endDate < today) return "settling";
  if (challenge.startDate <= today && challenge.endDate >= today) return "active";
  return "open";
}

router.get("/admin/flagged-step-records", async (req, res): Promise<void> => {
  if (!await requireAdmin(req, res)) return;
  const records = await db
    .select({
      record: dailyStepRecordsTable,
      user: usersTable,
      challengeName: challengesTable.name,
    })
    .from(dailyStepRecordsTable)
    .innerJoin(usersTable, eq(dailyStepRecordsTable.userId, usersTable.id))
    .leftJoin(challengesTable, eq(dailyStepRecordsTable.challengeId, challengesTable.id))
    .where(eq(dailyStepRecordsTable.verified, false))
    .orderBy(desc(dailyStepRecordsTable.recordDate), desc(dailyStepRecordsTable.createdAt))
    .limit(200);
  const pendingSamples = await db
    .select({
      userId: stepSourceSamplesTable.userId,
      recordDate: stepSourceSamplesTable.recordDate,
      reviewFlags: stepSourceSamplesTable.reviewFlags,
    })
    .from(stepSourceSamplesTable)
    .where(eq(stepSourceSamplesTable.verificationStatus, "pending_review"));
  const reasonsByDate = new Map<string, string[]>();
  for (const sample of pendingSamples) {
    const key = `${sample.userId}:${sample.recordDate}`;
    const current = reasonsByDate.get(key) ?? [];
    for (const flag of sample.reviewFlags) if (!current.includes(flag)) current.push(flag);
    reasonsByDate.set(key, current);
  }
  res.json(GetAdminFlaggedStepRecordsResponse.parse({
    records: records.map(({ record, user, challengeName }) => ({
      id: String(record.id),
      userId: user.id,
      userName: displayName(user),
      userEmail: user.email ?? "",
      challengeId: record.challengeId,
      challengeName: challengeName ?? "Personal step total",
      recordDate: record.recordDate,
      steps: record.steps,
      source: record.source,
      flagReasons: reasonsByDate.get(`${record.userId}:${record.recordDate}`) ?? ["unverified_daily_record"],
      createdAt: record.createdAt.toISOString(),
    })),
  }));
});

router.get("/admin/challenges", async (req, res): Promise<void> => {
  if (!await requireAdmin(req, res)) return;
  const today = new Date().toISOString().slice(0, 10);
  const challenges = await db.select().from(challengesTable).orderBy(desc(challengesTable.createdAt));
  res.json(GetAdminChallengesResponse.parse({
    challenges: challenges.map((challenge) => ({
      id: challenge.id,
      name: challenge.name,
      status: challengeStatus(challenge, today),
      participantCount: challenge.participantCount,
      poolTotal: numberValue(challenge.settlementStatus === "settled" ? challenge.settledPool : challenge.prizePool),
      entryFee: numberValue(challenge.entryFee),
      startDate: challenge.startDate,
      endDate: challenge.endDate,
      community: challenge.community,
      settlementStatus: challenge.settlementStatus,
    })),
  }));
});

router.get("/admin/settlements", async (req, res): Promise<void> => {
  if (!await requireAdmin(req, res)) return;
  const challenges = await db.select().from(challengesTable).where(eq(challengesTable.settlementStatus, "settled")).orderBy(desc(challengesTable.settledAt));
  const events = await db.select().from(walletLedgerEntriesTable).where(or(
    eq(walletLedgerEntriesTable.eventType, "settlement_earned"),
    eq(walletLedgerEntriesTable.eventType, "settlement_refunded"),
  )).orderBy(asc(walletLedgerEntriesTable.createdAt));
  const eventsByChallenge = new Map<string, typeof events>();
  for (const event of events) {
    if (!event.challengeId) continue;
    const current = eventsByChallenge.get(event.challengeId) ?? [];
    current.push(event);
    eventsByChallenge.set(event.challengeId, current);
  }
  res.json(GetAdminSettlementHistoryResponse.parse({
    settlements: challenges.map((challenge) => {
      const challengeEvents = eventsByChallenge.get(challenge.id) ?? [];
      const payoutAmounts = challengeEvents.filter((event) => event.eventType === "settlement_earned").map((event) => event.amountCents);
      const refundAmounts = challengeEvents.filter((event) => event.eventType === "settlement_refunded").map((event) => event.amountCents);
      const basePayout = payoutAmounts.length ? Math.min(...payoutAmounts) : 0;
      return {
        challengeId: challenge.id,
        challengeName: challenge.name,
        settledAt: challenge.settledAt?.toISOString() ?? null,
        finisherCount: challenge.finishers,
        perFinisherPayoutCents: basePayout,
        payoutAmountsCents: payoutAmounts,
        noFinisherRefundCount: refundAmounts.length,
        noFinisherRefundCents: refundAmounts.reduce((total, amount) => total + amount, 0),
      };
    }),
  }));
});

router.get("/admin/users/search", async (req, res): Promise<void> => {
  if (!await requireAdmin(req, res)) return;
  const query = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 120) : "";
  if (query.length < 2) {
    res.json(SearchAdminUsersResponse.parse({ users: [] }));
    return;
  }
  const users = await db.select().from(usersTable).where(or(
    ilike(usersTable.id, `%${query}%`),
    ilike(usersTable.email, `%${query}%`),
    ilike(usersTable.displayName, `%${query}%`),
    ilike(usersTable.firstName, `%${query}%`),
    ilike(usersTable.lastName, `%${query}%`),
  )).orderBy(asc(usersTable.displayName)).limit(20);
  res.json(SearchAdminUsersResponse.parse({
    users: users.map((user) => ({ id: user.id, email: user.email ?? "", displayName: displayName(user) })),
  }));
});

router.get("/admin/users/:id", async (req, res): Promise<void> => {
  if (!await requireAdmin(req, res)) return;
  const userId = typeof req.params.id === "string" ? req.params.id : "";
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  const history = await db.select({
    entry: entriesTable,
    challenge: challengesTable,
  }).from(entriesTable).innerJoin(challengesTable, eq(entriesTable.challengeId, challengesTable.id)).where(eq(entriesTable.userId, user.id)).orderBy(desc(entriesTable.joinedAt));
  res.json(GetAdminUserResponse.parse({
    user: {
      id: user.id,
      email: user.email ?? "",
      displayName: displayName(user),
      role: user.role,
      walletBalance: numberValue(user.walletBalance),
      walletPending: numberValue(user.walletPending),
      totalEarned: numberValue(user.totalEarned),
      createdAt: user.createdAt.toISOString(),
    },
    challenges: history.map(({ entry, challenge }) => ({
      challengeId: challenge.id,
      challengeName: challenge.name,
      entryStatus: entry.status,
      entryFee: numberValue(entry.entryFee),
      settlementStatus: entry.settlementStatus ?? "not_settled",
      settlementAmount: entry.settlementAmount == null ? null : numberValue(entry.settlementAmount),
      joinedAt: entry.joinedAt.toISOString(),
      settledAt: entry.settledAt?.toISOString() ?? null,
    })),
  }));
});

export default router;