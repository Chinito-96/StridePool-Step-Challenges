import {
  AddStridePoolDemoFundsResponse,
  GetStridePoolBootstrapResponse,
  JoinStridePoolChallengeParams,
  JoinStridePoolChallengeResponse,
  LeaveStridePoolChallengeParams,
  LeaveStridePoolChallengeResponse,
  UpdateStridePoolProfileBody,
  UpdateStridePoolProfileResponse,
} from "@workspace/api-zod";
import {
  challengesTable,
  dailyStepRecordsTable,
  db,
  entriesTable,
  usersTable,
  type Challenge,
} from "@workspace/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();
const DEFAULT_PROFILE = { displayName: "Alex Morgan", reminders: true, weeklyDigest: true, publicProgress: false, healthConnected: true, goalBaseline: 7500 };
const DEFAULT_WALLET = { balance: 42.5, pending: 18, totalEarned: 156.75 };

function dateLabel(value: string): string {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
function numberValue(value: string | number | null | undefined): number {
  return Number(value ?? 0);
}
function requireUser(req: Request, res: Response): string | null {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Login required for this challenge." });
    return null;
  }
  return req.user.id;
}
function walletFor(user: typeof usersTable.$inferSelect) {
  return { balance: numberValue(user.walletBalance), pending: numberValue(user.walletPending), totalEarned: numberValue(user.totalEarned) };
}
function profileFor(user: typeof usersTable.$inferSelect) {
  return {
    displayName: user.displayName || [user.firstName, user.lastName].filter(Boolean).join(" ") || DEFAULT_PROFILE.displayName,
    reminders: user.reminders,
    weeklyDigest: user.weeklyDigest,
    publicProgress: user.publicProgress,
    healthConnected: user.healthConnected,
    goalBaseline: numberValue(user.goalBaseline),
  };
}
function challengeFor(challenge: Challenge, joinedIds: Set<string>) {
  return {
    id: challenge.id,
    name: challenge.name,
    theme: challenge.theme,
    level: challenge.level,
    startDate: dateLabel(challenge.startDate),
    endDate: dateLabel(challenge.endDate),
    days: challenge.days,
    dailyGoal: challenge.dailyGoal,
    entryFee: numberValue(challenge.entryFee),
    prizePool: numberValue(challenge.prizePool),
    participantCount: challenge.participantCount,
    finishers: challenge.finishers,
    color: challenge.color,
    goalType: challenge.goalType,
    community: challenge.community,
    graceDays: challenge.graceDays,
    joined: joinedIds.has(challenge.id),
  };
}
async function getUser(userId: string) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return user;
}
async function getBootstrap(req: Request) {
  const challenges = await db.select().from(challengesTable).orderBy(challengesTable.createdAt);
  if (!req.isAuthenticated()) {
    return { user: null, challenges: challenges.map((challenge) => challengeFor(challenge, new Set())), joinedIds: [], steps: 7284, activities: [], wallet: DEFAULT_WALLET, profile: DEFAULT_PROFILE };
  }
  const user = await getUser(req.user.id);
  if (!user) return { user: null, challenges: challenges.map((challenge) => challengeFor(challenge, new Set())), joinedIds: [], steps: 0, activities: [], wallet: DEFAULT_WALLET, profile: DEFAULT_PROFILE };
  const entries = await db.select().from(entriesTable).where(and(eq(entriesTable.userId, user.id), eq(entriesTable.status, "active")));
  const joinedIds = new Set(entries.map((entry) => entry.challengeId));
  const today = new Date().toISOString().slice(0, 10);
  const [stepTotal] = await db.select({ total: sql<number>`coalesce(sum(${dailyStepRecordsTable.steps}), 0)` }).from(dailyStepRecordsTable).where(and(eq(dailyStepRecordsTable.userId, user.id), eq(dailyStepRecordsTable.recordDate, today)));
  const activities = entries.slice().sort((a, b) => b.joinedAt.getTime() - a.joinedAt.getTime()).map((entry) => {
    const challenge = challenges.find((item) => item.id === entry.challengeId);
    return { id: `entry-${entry.id}`, type: "challenge", title: `You joined ${challenge?.name ?? "a challenge"}`, meta: `${numberValue(entry.entryFee) ? `$${numberValue(entry.entryFee)} committed` : "Free entry"} · persisted to your account`, timestamp: entry.joinedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" }) };
  });
  return {
    user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, profileImageUrl: user.profileImageUrl },
    challenges: challenges.map((challenge) => challengeFor(challenge, joinedIds)),
    joinedIds: [...joinedIds],
    steps: Number(stepTotal?.total ?? 0),
    activities,
    wallet: walletFor(user),
    profile: profileFor(user),
  };
}

router.get("/stridepool/bootstrap", async (req, res): Promise<void> => {
  res.json(GetStridePoolBootstrapResponse.parse(await getBootstrap(req)));
});

router.post("/stridepool/challenges/:id/join", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const params = JoinStridePoolChallengeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [challenge] = await db.select().from(challengesTable).where(eq(challengesTable.id, params.data.id));
  if (!challenge) {
    res.status(404).json({ error: "Challenge not found." });
    return;
  }
  const user = await getUser(userId);
  if (!user) {
    res.status(401).json({ error: "Login required." });
    return;
  }
  const [existing] = await db.select().from(entriesTable).where(and(eq(entriesTable.userId, userId), eq(entriesTable.challengeId, challenge.id)));
  if (existing?.status === "active") {
    res.json(JoinStridePoolChallengeResponse.parse({ joined: true, wallet: walletFor(user) }));
    return;
  }
  const fee = numberValue(challenge.entryFee);
  if (fee > numberValue(user.walletBalance)) {
    res.status(400).json({ error: "Your available balance is too low for this entry." });
    return;
  }
  const updatedWallet = await db.transaction(async (tx) => {
    if (existing) {
      await tx.update(entriesTable).set({ status: "active", joinedAt: new Date(), leftAt: null }).where(eq(entriesTable.id, existing.id));
    } else {
      await tx.insert(entriesTable).values({ userId, challengeId: challenge.id, entryFee: fee.toFixed(2), status: "active" });
    }
    const [updatedUser] = await tx.update(usersTable).set({
      walletBalance: sql`${usersTable.walletBalance} - ${fee.toFixed(2)}`,
      walletPending: sql`${usersTable.walletPending} + ${fee.toFixed(2)}`,
    }).where(eq(usersTable.id, userId)).returning();
    await tx.update(challengesTable).set({
      participantCount: sql`${challengesTable.participantCount} + 1`,
      prizePool: sql`${challengesTable.prizePool} + ${fee.toFixed(2)}`,
    }).where(eq(challengesTable.id, challenge.id));
    return walletFor(updatedUser);
  });
  res.json(JoinStridePoolChallengeResponse.parse({ joined: true, wallet: updatedWallet }));
});

router.post("/stridepool/challenges/:id/leave", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const params = LeaveStridePoolChallengeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [entry] = await db.select().from(entriesTable).where(and(eq(entriesTable.userId, userId), eq(entriesTable.challengeId, params.data.id), eq(entriesTable.status, "active")));
  if (!entry) {
    res.status(404).json({ error: "Active entry not found." });
    return;
  }
  const fee = numberValue(entry.entryFee);
  const updatedWallet = await db.transaction(async (tx) => {
    await tx.update(entriesTable).set({ status: "left", leftAt: new Date() }).where(eq(entriesTable.id, entry.id));
    const [updatedUser] = await tx.update(usersTable).set({
      walletBalance: sql`${usersTable.walletBalance} + ${fee.toFixed(2)}`,
      walletPending: sql`greatest(${usersTable.walletPending} - ${fee.toFixed(2)}, 0)`,
    }).where(eq(usersTable.id, userId)).returning();
    await tx.update(challengesTable).set({
      participantCount: sql`greatest(${challengesTable.participantCount} - 1, 0)`,
      prizePool: sql`greatest(${challengesTable.prizePool} - ${fee.toFixed(2)}, 0)`,
    }).where(eq(challengesTable.id, params.data.id));
    return walletFor(updatedUser);
  });
  res.json(LeaveStridePoolChallengeResponse.parse({ joined: false, wallet: updatedWallet }));
});

router.post("/stridepool/sync", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const today = new Date().toISOString().slice(0, 10);
  const [existing] = await db.select().from(dailyStepRecordsTable).where(and(eq(dailyStepRecordsTable.userId, userId), isNull(dailyStepRecordsTable.challengeId), eq(dailyStepRecordsTable.recordDate, today)));
  const steps = (existing?.steps ?? 0) + 628;
  if (existing) {
    await db.update(dailyStepRecordsTable).set({ steps, verified: true, source: "demo-verified" }).where(eq(dailyStepRecordsTable.id, existing.id));
  } else {
    await db.insert(dailyStepRecordsTable).values({ userId, challengeId: null, recordDate: today, steps, verified: true, source: "demo-verified" });
  }
  res.json({ steps, activity: { id: `sync-${Date.now()}`, type: "sync", title: "Verified steps synced", meta: "+628 steps · rhythm is building", timestamp: "Just now" } });
});

router.post("/stridepool/wallet/demo-funds", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const [user] = await db.update(usersTable).set({ walletBalance: sql`${usersTable.walletBalance} + 25` }).where(eq(usersTable.id, userId)).returning();
  res.json(AddStridePoolDemoFundsResponse.parse(walletFor(user)));
});

router.patch("/stridepool/profile", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const parsed = UpdateStridePoolProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [user] = await db.update(usersTable).set(parsed.data).where(eq(usersTable.id, userId)).returning();
  res.json(UpdateStridePoolProfileResponse.parse(profileFor(user)));
});

export default router;