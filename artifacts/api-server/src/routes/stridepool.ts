import {
  GetStridePoolBootstrapResponse,
  GetStridePoolHealthSourcesResponse,
  GetStridePoolRecoveryCasesResponse,
  IngestStridePoolSourceSamplesBody,
  IngestStridePoolSourceSamplesParams,
  IngestStridePoolSourceSamplesResponse,
  JoinStridePoolChallengeParams,
  JoinStridePoolChallengeResponse,
  LeaveStridePoolChallengeParams,
  LeaveStridePoolChallengeResponse,
  RequestStridePoolRecoveryBody,
  RequestStridePoolRecoveryResponse,
  SyncStridePoolStepsBody,
  SyncStridePoolStepsResponse,
  UpdateStridePoolProfileBody,
  UpdateStridePoolProfileResponse,
} from "@workspace/api-zod";
import {
  challengeRecoveryCasesTable,
  challengesTable,
  dailyStepRecordsTable,
  db,
  entriesTable,
  healthSourceConnectionsTable,
  joinChallenge as joinMoneyChallenge,
  leaveChallenge as leaveMoneyChallenge,
  MoneyLogicError,
  stepSourceSamplesTable,
  reviewStepSample,
  type StepSourceId,
  usersTable,
  walletLedgerEntriesTable,
  type Challenge,
} from "@workspace/db";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();
const DEFAULT_PROFILE = { displayName: "Alex Morgan", reminders: true, weeklyDigest: true, publicProgress: false, healthConnected: true, goalBaseline: 7500, eligibilityAge: 0, eligibilityState: "", identityStatus: "not_started" as const, acceptedTerms: false };
const DEFAULT_WALLET = { balance: 0, pending: 0, totalEarned: 0 };
const HEALTH_SOURCES = [
  { source: "apple_health" as const, label: "Apple Health" },
  { source: "health_connect" as const, label: "Android Health Connect" },
];

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
    eligibilityAge: user.eligibilityAge,
    eligibilityState: user.eligibilityState,
    identityStatus: user.eligibilityIdentityStatus,
    acceptedTerms: user.eligibilityAcceptedTerms,
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
    settlementStatus: challenge.settlementStatus,
    joined: joinedIds.has(challenge.id),
  };
}
async function getUser(userId: string) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return user;
}
async function getHealthSources(userId: string) {
  const connections = await db.select().from(healthSourceConnectionsTable).where(eq(healthSourceConnectionsTable.userId, userId));
  return Promise.all(HEALTH_SOURCES.map(async ({ source, label }) => {
    const connection = connections.find((item) => item.source === source);
    const [verified] = await db.select({ count: sql<number>`count(*)` }).from(stepSourceSamplesTable).where(and(eq(stepSourceSamplesTable.userId, userId), eq(stepSourceSamplesTable.source, source), eq(stepSourceSamplesTable.verificationStatus, "verified")));
    const [pending] = await db.select({ count: sql<number>`count(*)` }).from(stepSourceSamplesTable).where(and(eq(stepSourceSamplesTable.userId, userId), eq(stepSourceSamplesTable.source, source), eq(stepSourceSamplesTable.verificationStatus, "pending_review")));
    return {
      source,
      label,
      status: connection ? "connected" as const : "available" as const,
      lastSyncedAt: connection?.lastSyncedAt?.toISOString() ?? null,
      verifiedSamples: Number(verified?.count ?? 0),
      pendingReview: Number(pending?.count ?? 0),
    };
  }));
}
async function getRecoveryCases(userId: string) {
  const rows = await db.select({
    recovery: challengeRecoveryCasesTable,
    challengeName: challengesTable.name,
  }).from(challengeRecoveryCasesTable).innerJoin(challengesTable, eq(challengeRecoveryCasesTable.challengeId, challengesTable.id)).where(eq(challengeRecoveryCasesTable.userId, userId)).orderBy(desc(challengeRecoveryCasesTable.updatedAt));
  return rows.map(({ recovery, challengeName }) => ({
    id: String(recovery.id),
    challengeId: recovery.challengeId,
    challengeName,
    type: recovery.type,
    status: recovery.status,
    reason: recovery.reason,
    reviewMessage: recovery.reviewMessage,
    requestedAt: recovery.requestedAt.toISOString(),
  }));
}

async function getStepReviews(userId: string) {
  const rows = await db.select({
    id: stepSourceSamplesTable.id,
    source: stepSourceSamplesTable.source,
    sourceSampleId: stepSourceSamplesTable.sourceSampleId,
    recordDate: stepSourceSamplesTable.recordDate,
    steps: stepSourceSamplesTable.steps,
    verificationStatus: stepSourceSamplesTable.verificationStatus,
    reviewFlags: stepSourceSamplesTable.reviewFlags,
    createdAt: stepSourceSamplesTable.createdAt,
  }).from(stepSourceSamplesTable).where(and(
    eq(stepSourceSamplesTable.userId, userId),
    eq(stepSourceSamplesTable.verificationStatus, "pending_review"),
  )).orderBy(desc(stepSourceSamplesTable.createdAt)).limit(20);
  return rows.map((row) => ({
    id: String(row.id),
    source: row.source,
    sourceSampleId: row.sourceSampleId,
    recordDate: row.recordDate,
    steps: row.steps,
    verificationStatus: "pending_review" as const,
    reviewFlags: row.reviewFlags,
    createdAt: row.createdAt.toISOString(),
  }));
}

async function upsertDailySteps(
  userId: string,
  challengeId: string | null,
  recordDate: string,
  steps: number,
  source: string,
  verified: boolean,
) {
  await db.insert(dailyStepRecordsTable).values({
    userId,
    challengeId,
    recordDate,
    steps,
    source,
    verified,
  }).onConflictDoUpdate({
    target: [dailyStepRecordsTable.userId, dailyStepRecordsTable.challengeId, dailyStepRecordsTable.recordDate],
    set: { steps, source, verified },
  });
}

async function mirrorFreeCommunitySteps(
  userId: string,
  recordDate: string,
  steps: number,
  source: string,
  verified: boolean,
) {
  const freeEntries = await db.select({
    challengeId: entriesTable.challengeId,
  }).from(entriesTable).innerJoin(challengesTable, eq(entriesTable.challengeId, challengesTable.id)).where(and(
    eq(entriesTable.userId, userId),
    eq(entriesTable.status, "active"),
    eq(challengesTable.community, true),
  ));
  await Promise.all(freeEntries.map(({ challengeId }) => upsertDailySteps(userId, challengeId, recordDate, steps, source, verified)));
}

function sampleReviewResult(source: StepSourceId, sample: {
  sourceSampleId: string;
  recordDate: Date;
  steps: number;
  startTime: Date;
  endTime: Date;
  recordedAt?: Date | null;
  rawPayload: Record<string, unknown>;
}) {
  const reviewFlags = reviewStepSample(sample);
  return {
    source,
    sourceSampleId: sample.sourceSampleId,
    recordDate: sample.recordDate.toISOString().slice(0, 10),
    steps: sample.steps,
    startTime: sample.startTime,
    endTime: sample.endTime,
    recordedAt: sample.recordedAt ?? null,
    rawPayload: sample.rawPayload,
    reviewFlags,
    verificationStatus: reviewFlags.length ? "pending_review" : "verified",
  } as const;
}
async function getBootstrap(req: Request) {
  const challenges = await db.select().from(challengesTable).orderBy(challengesTable.createdAt);
  if (!req.isAuthenticated()) {
    return { user: null, challenges: challenges.map((challenge) => challengeFor(challenge, new Set())), joinedIds: [], steps: 7284, activities: [], wallet: DEFAULT_WALLET, profile: DEFAULT_PROFILE, healthSources: HEALTH_SOURCES.map(({ source, label }) => ({ source, label, status: "available" as const, lastSyncedAt: null, verifiedSamples: 0, pendingReview: 0 })), recoveryCases: [], stepReviews: [] };
  }
  const user = await getUser(req.user.id);
  if (!user) return { user: null, challenges: challenges.map((challenge) => challengeFor(challenge, new Set())), joinedIds: [], steps: 0, activities: [], wallet: DEFAULT_WALLET, profile: DEFAULT_PROFILE, healthSources: HEALTH_SOURCES.map(({ source, label }) => ({ source, label, status: "available" as const, lastSyncedAt: null, verifiedSamples: 0, pendingReview: 0 })), recoveryCases: [], stepReviews: [] };
  const entries = await db.select().from(entriesTable).where(and(eq(entriesTable.userId, user.id), eq(entriesTable.status, "active")));
  const joinedIds = new Set(entries.map((entry) => entry.challengeId));
  const today = new Date().toISOString().slice(0, 10);
  const [stepTotal] = await db.select({ total: sql<number>`coalesce(sum(${dailyStepRecordsTable.steps}), 0)` }).from(dailyStepRecordsTable).where(and(eq(dailyStepRecordsTable.userId, user.id), isNull(dailyStepRecordsTable.challengeId), eq(dailyStepRecordsTable.recordDate, today)));
  const [todaySteps] = await db.select().from(dailyStepRecordsTable).where(and(eq(dailyStepRecordsTable.userId, user.id), isNull(dailyStepRecordsTable.challengeId), eq(dailyStepRecordsTable.recordDate, today)));
  const ledgerEntries = await db.select().from(walletLedgerEntriesTable).where(eq(walletLedgerEntriesTable.userId, user.id)).orderBy(desc(walletLedgerEntriesTable.createdAt)).limit(20);
  const healthSources = await getHealthSources(user.id);
  const recoveryCases = await getRecoveryCases(user.id);
  const stepReviews = await getStepReviews(user.id);
  const entryActivities = entries.slice().sort((a, b) => b.joinedAt.getTime() - a.joinedAt.getTime()).map((entry) => {
    const challenge = challenges.find((item) => item.id === entry.challengeId);
    return { id: `entry-${entry.id}`, type: "challenge", title: `You joined ${challenge?.name ?? "a challenge"}`, meta: `${numberValue(entry.entryFee) ? `$${numberValue(entry.entryFee)} committed` : "Free entry"} · persisted to your account`, timestamp: entry.joinedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" }) };
  });
  const ledgerActivities = ledgerEntries.map((entry) => {
    const earned = entry.eventType.includes("earned");
    const refunded = entry.eventType.includes("refund");
    return {
      id: `ledger-${entry.id}`,
      type: earned ? "milestone" : "challenge",
      title: earned ? "Earnings credited" : refunded ? "Entry refunded" : entry.eventType.replaceAll("_", " "),
      meta: `${entry.amountCents > 0 ? `$${(entry.amountCents / 100).toFixed(2)}` : "No balance change"} · recorded in your wallet`,
      timestamp: entry.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    };
  });
  const activities = [
    ...(todaySteps ? [{ id: `sync-${todaySteps.id}`, type: "sync", title: "Verified steps synced", meta: `${todaySteps.steps.toLocaleString()} steps today · persisted to your account`, timestamp: todaySteps.recordDate }] : []),
    ...recoveryCases.map((recovery) => ({ id: `recovery-${recovery.id}`, type: "recovery", title: `${recovery.type.replaceAll("_", " ")} requested`, meta: `${recovery.challengeName} · ${recovery.status.replaceAll("_", " ")}`, timestamp: recovery.requestedAt })),
    ...entryActivities,
    ...ledgerActivities,
  ].slice(0, 20);
  return {
    user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, profileImageUrl: user.profileImageUrl },
    challenges: challenges.map((challenge) => challengeFor(challenge, joinedIds)),
    joinedIds: [...joinedIds],
    steps: Number(stepTotal?.total ?? 0),
    activities,
    wallet: walletFor(user),
    profile: profileFor(user),
    healthSources,
    recoveryCases,
    stepReviews,
  };
}

router.get("/stridepool/bootstrap", async (req, res): Promise<void> => {
  res.json(GetStridePoolBootstrapResponse.parse(await getBootstrap(req)));
});

router.get("/stridepool/sources", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  res.json(GetStridePoolHealthSourcesResponse.parse({ sources: await getHealthSources(userId) }));
});

router.post("/stridepool/sources/:source/samples", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const params = IngestStridePoolSourceSamplesParams.safeParse(req.params);
  const body = IngestStridePoolSourceSamplesBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Send valid Apple Health or Health Connect samples." });
    return;
  }

  const source = params.data.source;
  const now = new Date();
  const existing = await db.select({
    sourceSampleId: stepSourceSamplesTable.sourceSampleId,
  }).from(stepSourceSamplesTable).where(and(
    eq(stepSourceSamplesTable.userId, userId),
    eq(stepSourceSamplesTable.source, source),
    inArray(stepSourceSamplesTable.sourceSampleId, body.data.samples.map((sample) => sample.sourceSampleId)),
  ));
  const existingIds = new Set(existing.map((sample) => sample.sourceSampleId));
  const seenIds = new Set<string>();
  const candidates = body.data.samples.filter((sample) => {
    if (existingIds.has(sample.sourceSampleId) || seenIds.has(sample.sourceSampleId)) return false;
    seenIds.add(sample.sourceSampleId);
    return true;
  });
  const dayTotals = new Map<string, number>();
  const results = candidates.map((sample) => {
    const flags = reviewStepSample(sample);
    const recordDate = sample.recordDate.toISOString().slice(0, 10);
    dayTotals.set(recordDate, (dayTotals.get(recordDate) ?? 0) + sample.steps);
    return { sample, flags };
  });
  for (const [recordDate, incomingTotal] of dayTotals) {
    const [historicalTotal] = await db.select({
      total: sql<number>`coalesce(sum(${stepSourceSamplesTable.steps}), 0)`,
    }).from(stepSourceSamplesTable).where(and(
      eq(stepSourceSamplesTable.userId, userId),
      eq(stepSourceSamplesTable.recordDate, recordDate),
      eq(stepSourceSamplesTable.verificationStatus, "verified"),
    ));
    if (Number(historicalTotal?.total ?? 0) + incomingTotal > 60000) {
      results.filter(({ sample }) => sample.recordDate.toISOString().slice(0, 10) === recordDate).forEach(({ flags }) => {
        if (!flags.includes("implausible_daily_total")) flags.push("implausible_daily_total");
      });
    }
  }

  const sampleRows = results.map(({ sample, flags }) => ({
    userId,
    source,
    sourceSampleId: sample.sourceSampleId,
    recordDate: sample.recordDate.toISOString().slice(0, 10),
    steps: sample.steps,
    startTime: sample.startTime,
    endTime: sample.endTime,
    recordedAt: sample.recordedAt ?? null,
    rawPayload: sample.rawPayload,
    verificationStatus: flags.length ? "pending_review" : "verified",
    reviewFlags: flags,
  }));
  if (sampleRows.length) {
    await db.insert(stepSourceSamplesTable).values(sampleRows).onConflictDoNothing();
  }
  await db.insert(healthSourceConnectionsTable).values({
    userId,
    source,
    status: "connected",
    lastSyncedAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [healthSourceConnectionsTable.userId, healthSourceConnectionsTable.source],
    set: { status: "connected", lastSyncedAt: now, updatedAt: now },
  });

  for (const [recordDate] of dayTotals) {
    const [verifiedTotal] = await db.select({
      total: sql<number>`coalesce(sum(${stepSourceSamplesTable.steps}), 0)`,
    }).from(stepSourceSamplesTable).where(and(
      eq(stepSourceSamplesTable.userId, userId),
      eq(stepSourceSamplesTable.recordDate, recordDate),
      eq(stepSourceSamplesTable.verificationStatus, "verified"),
    ));
    const verifiedSteps = Number(verifiedTotal?.total ?? 0);
    await upsertDailySteps(userId, null, recordDate, verifiedSteps, source, verifiedSteps > 0);
    await mirrorFreeCommunitySteps(userId, recordDate, verifiedSteps, source, verifiedSteps > 0);
  }

  const today = now.toISOString().slice(0, 10);
  const [todayTotal] = await db.select({
    total: sql<number>`coalesce(sum(${stepSourceSamplesTable.steps}), 0)`,
  }).from(stepSourceSamplesTable).where(and(
    eq(stepSourceSamplesTable.userId, userId),
    eq(stepSourceSamplesTable.recordDate, today),
    eq(stepSourceSamplesTable.verificationStatus, "verified"),
  ));
  const pendingReviewCount = results.filter(({ flags }) => flags.length > 0).length;
  res.json(IngestStridePoolSourceSamplesResponse.parse({
    source,
    acceptedCount: candidates.length,
    pendingReviewCount,
    steps: Number(todayTotal?.total ?? 0),
    samples: results.map(({ sample, flags }) => ({
      sourceSampleId: sample.sourceSampleId,
      verificationStatus: flags.length ? "pending_review" : "verified",
      reviewFlags: flags,
    })),
  }));
});

router.get("/stridepool/recovery", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  res.json(GetStridePoolRecoveryCasesResponse.parse({ cases: await getRecoveryCases(userId) }));
});

router.post("/stridepool/recovery", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const parsed = RequestStridePoolRecoveryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a recovery type and explain what happened." });
    return;
  }
  const challenge = (await db.select().from(challengesTable).where(eq(challengesTable.id, parsed.data.challengeId)))[0];
  if (!challenge) {
    res.status(404).json({ error: "Challenge not found." });
    return;
  }
  const [entry] = await db.select().from(entriesTable).where(and(
    eq(entriesTable.userId, userId),
    eq(entriesTable.challengeId, challenge.id),
    eq(entriesTable.status, "active"),
  ));
  if (!entry) {
    res.status(404).json({ error: "Join the challenge before requesting recovery." });
    return;
  }
  if (parsed.data.type === "grace_day") {
    const priorGraceDays = await db.select({ count: sql<number>`count(*)` }).from(challengeRecoveryCasesTable).where(and(
      eq(challengeRecoveryCasesTable.userId, userId),
      eq(challengeRecoveryCasesTable.challengeId, challenge.id),
      eq(challengeRecoveryCasesTable.type, "grace_day"),
      inArray(challengeRecoveryCasesTable.status, ["requested", "approved"]),
    ));
    if (Number(priorGraceDays[0]?.count ?? 0) >= challenge.graceDays) {
      res.status(400).json({ error: "This challenge has no grace days left." });
      return;
    }
  }
  const [recovery] = await db.insert(challengeRecoveryCasesTable).values({
    userId,
    challengeId: challenge.id,
    type: parsed.data.type,
    status: "requested",
    reason: parsed.data.reason,
    reviewMessage: parsed.data.type === "grace_day"
      ? "Your grace-day request is recorded and will be applied before settlement."
      : parsed.data.type === "injury_pause"
        ? "Your injury pause is pending. Support will protect the affected days while reviewing your source history."
        : "Support review is open. We will compare source samples, timestamps, and challenge rules before settlement.",
  }).returning();
  await db.update(challengesTable).set({ settlementStatus: "pending_review" }).where(eq(challengesTable.id, challenge.id));
  const result = {
    id: String(recovery.id),
    challengeId: challenge.id,
    challengeName: challenge.name,
    type: recovery.type,
    status: recovery.status,
    reason: recovery.reason,
    reviewMessage: recovery.reviewMessage,
    requestedAt: recovery.requestedAt.toISOString(),
  };
  res.status(201).json(RequestStridePoolRecoveryResponse.parse(result));
});

router.post("/stridepool/challenges/:id/join", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const params = JoinStridePoolChallengeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  try {
    const result = await joinMoneyChallenge(userId, params.data.id);
    res.json(JoinStridePoolChallengeResponse.parse({ joined: true, wallet: result.wallet }));
  } catch (error) {
    if (error instanceof MoneyLogicError) {
      const status = error.code === "NOT_FOUND" ? 404 : error.code === "INSUFFICIENT_FUNDS" || error.code === "INVALID_FREE_CHALLENGE" ? 400 : 409;
      res.status(status).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/stridepool/challenges/:id/leave", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const params = LeaveStridePoolChallengeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  try {
    const result = await leaveMoneyChallenge(userId, params.data.id);
    res.json(LeaveStridePoolChallengeResponse.parse({ joined: false, wallet: result.wallet }));
  } catch (error) {
    if (error instanceof MoneyLogicError) {
      const status = error.code === "NOT_FOUND" ? 404 : 409;
      res.status(status).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/stridepool/sync", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const parsed = SyncStridePoolStepsBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Send a valid daily step total." });
    return;
  }
  const now = new Date();
  const source = parsed.data.source ?? "demo";
  const recordDate = parsed.data.recordDate?.toISOString().slice(0, 10) ?? now.toISOString().slice(0, 10);
  const steps = parsed.data.steps ?? 628;
  const startTime = source === "manual" ? new Date(`${recordDate}T00:00:00.000Z`) : new Date(now.getTime() - 30 * 60 * 1000);
  const endTime = source === "manual" ? new Date(`${recordDate}T23:59:59.999Z`) : now;
  const sourceSampleId = parsed.data.sourceSampleId ?? `${source}-${userId}-${recordDate}-${now.getTime()}`;
  const [existingSample] = await db.select().from(stepSourceSamplesTable).where(and(
    eq(stepSourceSamplesTable.userId, userId),
    eq(stepSourceSamplesTable.source, source),
    eq(stepSourceSamplesTable.sourceSampleId, sourceSampleId),
  ));
  const [historicalTotal] = await db.select({
    total: sql<number>`coalesce(sum(${stepSourceSamplesTable.steps}), 0)`,
  }).from(stepSourceSamplesTable).where(and(
    eq(stepSourceSamplesTable.userId, userId),
    eq(stepSourceSamplesTable.recordDate, recordDate),
    eq(stepSourceSamplesTable.verificationStatus, "verified"),
    ...(existingSample ? [sql`${stepSourceSamplesTable.id} <> ${existingSample.id}`] : []),
  ));
  const flags = reviewStepSample({ steps, startTime, endTime, recordedAt: now });
  if (Number(historicalTotal?.total ?? 0) + steps > 60_000) flags.push("implausible_daily_total");
  const verificationStatus = flags.length ? "pending_review" : "verified";
  if (existingSample) {
    await db.update(stepSourceSamplesTable).set({
      recordDate,
      steps,
      startTime,
      endTime,
      recordedAt: now,
      rawPayload: { source, sync: "web" },
      verificationStatus,
      reviewFlags: flags,
    }).where(eq(stepSourceSamplesTable.id, existingSample.id));
  } else {
    await db.insert(stepSourceSamplesTable).values({
      userId,
      source,
      sourceSampleId,
      recordDate,
      steps,
      startTime,
      endTime,
      recordedAt: now,
      rawPayload: { source, sync: "web" },
      verificationStatus,
      reviewFlags: flags,
    });
  }
  const [todayTotal] = await db.select({
    total: sql<number>`coalesce(sum(${stepSourceSamplesTable.steps}), 0)`,
  }).from(stepSourceSamplesTable).where(and(
    eq(stepSourceSamplesTable.userId, userId),
    eq(stepSourceSamplesTable.recordDate, recordDate),
    eq(stepSourceSamplesTable.verificationStatus, "verified"),
  ));
  const verifiedSteps = Number(todayTotal?.total ?? 0);
  await upsertDailySteps(userId, null, recordDate, verifiedSteps, source, verifiedSteps > 0);
  await mirrorFreeCommunitySteps(userId, recordDate, verifiedSteps, source, verifiedSteps > 0);
  const activityMeta = flags.length
    ? `${steps.toLocaleString()} steps held for review · daily record unchanged`
    : `${steps.toLocaleString()} steps · persisted to your account`;
  res.json(SyncStridePoolStepsResponse.parse({
    steps: verifiedSteps,
    source,
    verificationStatus,
    reviewFlags: flags,
    activity: {
      id: `sync-${existingSample?.id ?? Date.now()}`,
      type: flags.length ? "review" : "sync",
      title: flags.length ? "Steps held for review" : "Verified steps synced",
      meta: activityMeta,
      timestamp: "Just now",
    },
  }));
});

router.post("/stridepool/wallet/demo-funds", async (req, res): Promise<void> => {
  res.status(409).json({ error: "Demo wallet funding is disabled. Use a configured payment provider and signed ledger events." });
});

router.patch("/stridepool/profile", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const parsed = UpdateStridePoolProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [user] = await db.update(usersTable).set({
    displayName: parsed.data.displayName,
    reminders: parsed.data.reminders,
    weeklyDigest: parsed.data.weeklyDigest,
    publicProgress: parsed.data.publicProgress,
    healthConnected: parsed.data.healthConnected,
    eligibilityAge: parsed.data.eligibilityAge,
    eligibilityState: parsed.data.eligibilityState,
    eligibilityIdentityStatus: parsed.data.identityStatus,
    eligibilityAcceptedTerms: parsed.data.acceptedTerms,
    updatedAt: new Date(),
  }).where(eq(usersTable.id, userId)).returning();
  if (!user) {
    res.status(404).json({ error: "Account not found." });
    return;
  }
  res.json(UpdateStridePoolProfileResponse.parse(profileFor(user)));
});

export default router;