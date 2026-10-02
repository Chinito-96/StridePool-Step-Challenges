import {
  AcceptStridePoolInviteResponse,
  CreateStridePoolChallengeInviteBody,
  GetStridePoolChallengeLeaderboardResponse,
  GetStridePoolCommunityChallengesResponse,
  GetStridePoolLifetimeLeaderboardResponse,
  CreateStridePoolGroupChallengeBody,
  CreateStridePoolGroupChallengeResponse,
  CreateStridePoolChallengeBody,
  CreateStridePoolChallengeResponse,
  CreateStridePoolChallengeInviteResponse,
  GetStridePoolBootstrapResponse,
  GetStridePoolHealthSourcesResponse,
  ReportStridePoolSourceDeliveryBody,
  UpdateStridePoolHealthSourceConnectionBody,
  GetStridePoolInviteResponse,
  GetStridePoolPendingInvitesResponse,
  GetStridePoolNotificationsResponse,
  MarkStridePoolNotificationReadResponse,
  MarkAllStridePoolNotificationsReadResponse,
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
  SearchStridePoolUsersResponse,
  UpdateStridePoolProfileBody,
  UpdateStridePoolProfileResponse,
  GetStridePoolReferralSummaryResponse,
  GetStridePoolReferralPreviewResponse,
  GetStridePoolReferralPreviewParams,
  ClaimStridePoolReferralBody,
  ClaimStridePoolReferralResponse,
} from "@workspace/api-zod";
import {
  challengeRecoveryCasesTable,
  challengeInvitesTable,
  challengesTable,
  calculatePodiumPayouts,
  dailyStepRecordsTable,
  db,
  entriesTable,
  healthSourceConnectionsTable,
  joinChallenge as joinMoneyChallenge,
  leaveChallenge as leaveMoneyChallenge,
  getMembershipSummary,
  MoneyLogicError,
  stepSourceSamplesTable,
  reviewStepSample,
  type StepSourceId,
  usersTable,
  walletLedgerEntriesTable,
  type Challenge,
  groupMembersTable,
  groupsTable,
  notificationsTable,
  getReferralPreview,
  getReferralSummary,
  claimReferralCode,
  qualifyReferralForUser,
} from "@workspace/db";
import { challengeParticipantOverridesTable } from "@workspace/db";
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { buildLifetimeLeaderboard, calculateProjectedPayouts, getParticipantStatus, type LifetimeLeaderboardRow, type ParticipantStatus } from "../services/stridepool-status";
import { buildGroupMemberJoinedCandidate, buildParticipantNotificationCandidates } from "../services/stridepool-notifications";
import { checkEligibility, getComplianceStatus } from "../services/ledger";

const router: IRouter = Router();
const ANONYMOUS_WALKER_COOKIE = "stridepool_anon";
const ANONYMOUS_WALKER_TTL = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_PROFILE = { displayName: "Alex Morgan", reminders: true, weeklyDigest: true, publicProgress: false, healthConnected: true, goalBaseline: 7500, eligibilityAge: 0, eligibilityState: "", identityStatus: "not_started" as const, acceptedTerms: false };
const DEFAULT_WALLET = { balance: 0, pending: 0, totalEarned: 0 };
const DEFAULT_MEMBERSHIP = { plan: "free" as const, status: "inactive" as const, monthlyPrice: 0, challengeJoinPrice: 2, activeChallengeLimit: 1, activeChallengeCount: 0, challengeCreationLimit: 0, activeCreatedChallengeCount: 0 };
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
function anonymousWalkerId(req: Request): string | null {
  const value = req.cookies?.[ANONYMOUS_WALKER_COOKIE];
  return typeof value === "string" && /^anon_[a-f0-9]{32}$/.test(value) ? value : null;
}
async function ensureAnonymousWalker(req: Request, res: Response): Promise<string> {
  const existingId = anonymousWalkerId(req);
  if (existingId) {
    const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, existingId));
    if (existing) return existing.id;
  }
  const id = `anon_${randomBytes(16).toString("hex")}`;
  await db.insert(usersTable).values({
    id,
    displayName: "Anonymous walker",
    walletBalance: "0.00",
    walletPending: "0.00",
    totalEarned: "0.00",
  });
  res.cookie(ANONYMOUS_WALKER_COOKIE, id, { httpOnly: true, sameSite: "lax", maxAge: ANONYMOUS_WALKER_TTL, path: "/" });
  return id;
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
function challengeFor(challenge: Challenge, joinedIds: Set<string>, joinPrice = 2, currentUserId: string | null = null) {
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
    challengeType: challenge.challengeType === "ranking" ? "ranking" as const : challenge.challengeType === "elimination" ? "elimination" as const : "goal" as const,
    goalType: challenge.goalType,
    community: challenge.community,
    visibility: challenge.groupId ? "private_group" as const : "public" as const,
    settlementStatus: challenge.settlementStatus,
    joined: joinedIds.has(challenge.id),
    createdByCurrentUser: challenge.creatorUserId === currentUserId,
  };
}
async function getUser(userId: string) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return user;
}

async function getVisibleChallenges(userId: string | null) {
  const challenges = await db.select().from(challengesTable).orderBy(challengesTable.createdAt);
  if (!userId) return challenges.filter((challenge) => !challenge.groupId);
  const memberships = await db.select({ groupId: groupMembersTable.groupId }).from(groupMembersTable).where(eq(groupMembersTable.userId, userId));
  const groupIds = new Set(memberships.map((membership) => membership.groupId));
  return challenges.filter((challenge) => !challenge.groupId || groupIds.has(challenge.groupId));
}

async function isGroupMember(groupId: string, userId: string) {
  const [membership] = await db.select({ id: groupMembersTable.id }).from(groupMembersTable).where(and(
    eq(groupMembersTable.groupId, groupId),
    eq(groupMembersTable.userId, userId),
  ));
  return Boolean(membership);
}

async function saveNotification(values: {
  userId: string;
  type: "daily_reminder" | "eliminated" | "group_member_joined" | "challenge_finished";
  title: string;
  body: string;
  challengeId?: string | null;
  actorUserId?: string | null;
  dedupeKey: string;
}) {
  await db.insert(notificationsTable).values(values).onConflictDoNothing({ target: notificationsTable.dedupeKey });
}

async function getLatestParticipantOverride(challengeId: string, userId: string) {
  const [override] = await db.select().from(challengeParticipantOverridesTable).where(and(
    eq(challengeParticipantOverridesTable.challengeId, challengeId),
    eq(challengeParticipantOverridesTable.userId, userId),
  )).orderBy(desc(challengeParticipantOverridesTable.createdAt)).limit(1);
  return override?.status === "on_track" || override?.status === "finished" ? override.status : undefined;
}

async function refreshNotifications(userId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const visibleChallenges = await getVisibleChallenges(userId);
  const entries = await db.select({ challengeId: entriesTable.challengeId }).from(entriesTable).where(and(
    eq(entriesTable.userId, userId),
    eq(entriesTable.status, "active"),
  ));
  const joinedIds = new Set(entries.map((entry) => entry.challengeId));
  const user = await getUser(userId);
  if (!user) return;

  for (const challenge of visibleChallenges.filter((item) => joinedIds.has(item.id) && item.community && numberValue(item.entryFee) === 0)) {
    const records = await db.select().from(dailyStepRecordsTable).where(and(
      eq(dailyStepRecordsTable.userId, userId),
      eq(dailyStepRecordsTable.challengeId, challenge.id),
      eq(dailyStepRecordsTable.verified, true),
    ));
    const dailyGoal = challenge.goalType === "personalized" ? numberValue(user.goalBaseline) || challenge.dailyGoal : challenge.dailyGoal;
    const status = getParticipantStatus(challenge, records, dailyGoal, await getLatestParticipantOverride(challenge.id, userId));
    const [todayRecord] = await db.select({ id: dailyStepRecordsTable.id }).from(dailyStepRecordsTable).where(and(
      eq(dailyStepRecordsTable.userId, userId),
      eq(dailyStepRecordsTable.challengeId, challenge.id),
      eq(dailyStepRecordsTable.recordDate, today),
      eq(dailyStepRecordsTable.verified, true),
    ));
    const candidates = buildParticipantNotificationCandidates({
      userId,
      challengeId: challenge.id,
      challengeName: challenge.name,
      challengeType: challenge.challengeType === "elimination" ? "elimination" : "goal",
      startDate: challenge.startDate,
      endDate: challenge.endDate,
      today,
      status: status.status,
      todayHasVerifiedRecord: Boolean(todayRecord),
    });
    await Promise.all(candidates.map((candidate) => saveNotification({
      userId,
      type: candidate.type,
      title: candidate.title,
      body: candidate.body,
      challengeId: challenge.id,
      dedupeKey: candidate.dedupeKey,
    })));
  }
}

async function notifyGroupParticipants(challenge: Challenge, actorUserId: string) {
  if (!challenge.groupId) return;
  const [actor] = await db.select().from(usersTable).where(eq(usersTable.id, actorUserId));
  if (!actor) return;
  const participants = await db.select({ userId: entriesTable.userId }).from(entriesTable).where(and(
    eq(entriesTable.challengeId, challenge.id),
    eq(entriesTable.status, "active"),
    sql`${entriesTable.userId} <> ${actorUserId}`,
  ));
  const actorName = publicUser(actor).displayName;
  await Promise.all(participants.map(({ userId }) => {
    const candidate = buildGroupMemberJoinedCandidate({
      challengeId: challenge.id,
      challengeName: challenge.name,
      actorUserId,
      recipientUserId: userId,
      actorName,
    });
    return saveNotification({
      userId,
      type: candidate.type,
      title: candidate.title,
      body: candidate.body,
      challengeId: challenge.id,
      actorUserId,
      dedupeKey: candidate.dedupeKey,
    });
  }));
}
async function getHealthSources(userId: string) {
  const connections = await db.select().from(healthSourceConnectionsTable).where(eq(healthSourceConnectionsTable.userId, userId));
  return Promise.all(HEALTH_SOURCES.map(async ({ source, label }) => {
    const connection = connections.find((item) => item.source === source);
    const [verified] = await db.select({ count: sql<number>`count(*)` }).from(stepSourceSamplesTable).where(and(eq(stepSourceSamplesTable.userId, userId), eq(stepSourceSamplesTable.source, source), eq(stepSourceSamplesTable.verificationStatus, "verified")));
    const [pending] = await db.select({ count: sql<number>`count(*)` }).from(stepSourceSamplesTable).where(and(eq(stepSourceSamplesTable.userId, userId), eq(stepSourceSamplesTable.source, source), eq(stepSourceSamplesTable.verificationStatus, "pending_review")));
    const status = connection?.status === "denied" || connection?.status === "revoked"
      ? connection.status
      : connection?.lastSyncedAt && Date.now() - connection.lastSyncedAt.getTime() > 36 * 60 * 60 * 1000
        ? "stale"
        : connection ? "connected" : "available";
    return {
      source,
      label,
      status,
      lastSyncedAt: connection?.lastSyncedAt?.toISOString() ?? null,
      lastAttemptedAt: connection?.lastAttemptedAt?.toISOString() ?? null,
      deliveryFailure: connection?.deliveryFailure ?? null,
      nextRetryAt: connection?.nextRetryAt?.toISOString() ?? null,
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
    sourceFlags: recovery.sourceFlags,
    reviewMessage: recovery.reviewMessage,
    requestedAt: recovery.requestedAt.toISOString(),
    updatedAt: recovery.updatedAt.toISOString(),
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

function isOpenFreeCommunityChallenge(challenge: Challenge, today = new Date().toISOString().slice(0, 10)) {
  return challenge.community && numberValue(challenge.entryFee) === 0 && challenge.settlementStatus === "open" && challenge.endDate >= today;
}

function publicUser(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    displayName: user.displayName || [user.firstName, user.lastName].filter(Boolean).join(" ") || "StridePool walker",
    email: user.email ?? "",
  };
}

async function getFreeStreak(userId: string) {
  const rows = await db.select({
    recordDate: dailyStepRecordsTable.recordDate,
    steps: dailyStepRecordsTable.steps,
    dailyGoal: challengesTable.dailyGoal,
  }).from(dailyStepRecordsTable).innerJoin(challengesTable, eq(dailyStepRecordsTable.challengeId, challengesTable.id)).where(and(
    eq(dailyStepRecordsTable.userId, userId),
    eq(dailyStepRecordsTable.verified, true),
    eq(challengesTable.community, true),
    eq(challengesTable.entryFee, "0"),
  ));
  const qualifyingDates = new Set(rows.filter((row) => row.steps >= row.dailyGoal).map((row) => row.recordDate));
  const shiftDate = (value: string, amount: number) => {
    const date = new Date(`${value}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + amount);
    return date.toISOString().slice(0, 10);
  };
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = shiftDate(today, -1);
  const currentStart = qualifyingDates.has(today) ? today : yesterday;
  let current = qualifyingDates.has(currentStart) ? 1 : 0;
  let cursor = currentStart;
  while (current > 0 && qualifyingDates.has(shiftDate(cursor, -1))) {
    cursor = shiftDate(cursor, -1);
    current += 1;
  }
  const sorted = [...qualifyingDates].sort();
  let best = 0;
  let run = 0;
  let previous: string | undefined;
  for (const date of sorted) {
    run = previous && shiftDate(previous, 1) === date ? run + 1 : 1;
    best = Math.max(best, run);
    previous = date;
  }
  return { current, best, lastGoalDate: sorted.at(-1) ?? null };
}

async function getPendingInvites(userId: string) {
  const rows = await db.select({
    invite: challengeInvitesTable,
    challenge: challengesTable,
    inviter: usersTable,
  }).from(challengeInvitesTable)
    .innerJoin(challengesTable, eq(challengeInvitesTable.challengeId, challengesTable.id))
    .innerJoin(usersTable, eq(challengeInvitesTable.inviterUserId, usersTable.id))
    .where(and(
      eq(challengeInvitesTable.inviteeUserId, userId),
      eq(challengeInvitesTable.status, "pending"),
    ))
    .orderBy(desc(challengeInvitesTable.createdAt));
  return rows.filter(({ challenge }) => isOpenFreeCommunityChallenge(challenge)).map(({ invite, challenge, inviter }) => ({
    id: String(invite.id),
    token: invite.token,
    challenge: challengeFor(challenge, new Set()),
    inviter: publicUser(inviter),
    createdAt: invite.createdAt.toISOString(),
  }));
}

async function upsertDailySteps(
  userId: string,
  challengeId: string | null,
  recordDate: string,
  steps: number,
  source: string,
  verified: boolean,
  database: Pick<typeof db, "select" | "insert" | "update"> = db,
) {
  const [existing] = await database.select({ id: dailyStepRecordsTable.id })
    .from(dailyStepRecordsTable)
    .where(and(
      eq(dailyStepRecordsTable.userId, userId),
      challengeId === null
        ? isNull(dailyStepRecordsTable.challengeId)
        : eq(dailyStepRecordsTable.challengeId, challengeId),
      eq(dailyStepRecordsTable.recordDate, recordDate),
    ));
  if (existing) {
    await database.update(dailyStepRecordsTable).set({ steps, source, verified }).where(eq(dailyStepRecordsTable.id, existing.id));
    return;
  }
  await database.insert(dailyStepRecordsTable).values({
    userId,
    challengeId,
    recordDate,
    steps,
    source,
    verified,
  });
}

async function mirrorActiveChallengeSteps(
  userId: string,
  recordDate: string,
  steps: number,
  source: string,
  verified: boolean,
  database: Pick<typeof db, "select" | "insert" | "update"> = db,
) {
  const freeEntries = await database.select({
    challengeId: entriesTable.challengeId,
  }).from(entriesTable).innerJoin(challengesTable, eq(entriesTable.challengeId, challengesTable.id)).where(and(
    eq(entriesTable.userId, userId),
    eq(entriesTable.status, "active"),
    lte(challengesTable.startDate, recordDate),
    gte(challengesTable.endDate, recordDate),
  ));
  await Promise.all(freeEntries.map(({ challengeId }) => upsertDailySteps(userId, challengeId, recordDate, steps, source, verified, database)));
}

export async function rebuildVerifiedDailyTotal(
  userId: string,
  recordDate: string,
  source: string,
  database: Pick<typeof db, "select" | "insert" | "update"> = db,
) {
  const [verifiedTotal] = await database.select({
    total: sql<number>`coalesce(sum(${stepSourceSamplesTable.steps}), 0)`,
  }).from(stepSourceSamplesTable).where(and(
    eq(stepSourceSamplesTable.userId, userId),
    eq(stepSourceSamplesTable.recordDate, recordDate),
    eq(stepSourceSamplesTable.verificationStatus, "verified"),
  ));
  const verifiedSteps = Number(verifiedTotal?.total ?? 0);
  await upsertDailySteps(userId, null, recordDate, verifiedSteps, source, verifiedSteps > 0, database);
  await mirrorActiveChallengeSteps(userId, recordDate, verifiedSteps, source, verifiedSteps > 0, database);
  return verifiedSteps;
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
  const challenges = await getVisibleChallenges(req.isAuthenticated() ? req.user.id : null);
  if (!req.isAuthenticated()) {
    const anonymousId = anonymousWalkerId(req);
    const joinedIds = anonymousId
      ? new Set((await db.select({ challengeId: entriesTable.challengeId }).from(entriesTable).where(and(eq(entriesTable.userId, anonymousId), eq(entriesTable.status, "active")))).map((entry) => entry.challengeId))
      : new Set<string>();
    return { user: null, challenges: challenges.map((challenge) => challengeFor(challenge, joinedIds)), joinedIds: [...joinedIds], steps: 7284, activities: [], wallet: DEFAULT_WALLET, profile: DEFAULT_PROFILE, membership: DEFAULT_MEMBERSHIP, healthSources: HEALTH_SOURCES.map(({ source, label }) => ({ source, label, status: "available" as const, lastSyncedAt: null, lastAttemptedAt: null, deliveryFailure: null, nextRetryAt: null, verifiedSamples: 0, pendingReview: 0 })), recoveryCases: [], stepReviews: [], freeStreak: { current: 0, best: 0, lastGoalDate: null }, pendingInvites: [] };
  }
  const user = await getUser(req.user.id);
  if (!user) return { user: null, challenges: challenges.map((challenge) => challengeFor(challenge, new Set())), joinedIds: [], steps: 0, activities: [], wallet: DEFAULT_WALLET, profile: DEFAULT_PROFILE, membership: DEFAULT_MEMBERSHIP, healthSources: HEALTH_SOURCES.map(({ source, label }) => ({ source, label, status: "available" as const, lastSyncedAt: null, lastAttemptedAt: null, deliveryFailure: null, nextRetryAt: null, verifiedSamples: 0, pendingReview: 0 })), recoveryCases: [], stepReviews: [], freeStreak: { current: 0, best: 0, lastGoalDate: null }, pendingInvites: [] };
  const entries = await db.select().from(entriesTable).where(and(eq(entriesTable.userId, user.id), eq(entriesTable.status, "active")));
  const joinedIds = new Set(entries.map((entry) => entry.challengeId));
  const today = new Date().toISOString().slice(0, 10);
  const [stepTotal] = await db.select({ total: sql<number>`coalesce(sum(${dailyStepRecordsTable.steps}), 0)` }).from(dailyStepRecordsTable).where(and(eq(dailyStepRecordsTable.userId, user.id), isNull(dailyStepRecordsTable.challengeId), eq(dailyStepRecordsTable.recordDate, today)));
  const [todaySteps] = await db.select().from(dailyStepRecordsTable).where(and(eq(dailyStepRecordsTable.userId, user.id), isNull(dailyStepRecordsTable.challengeId), eq(dailyStepRecordsTable.recordDate, today)));
  const ledgerEntries = await db.select().from(walletLedgerEntriesTable).where(eq(walletLedgerEntriesTable.userId, user.id)).orderBy(desc(walletLedgerEntriesTable.createdAt)).limit(20);
  const healthSources = await getHealthSources(user.id);
  const recoveryCases = await getRecoveryCases(user.id);
  const stepReviews = await getStepReviews(user.id);
  const freeStreak = await getFreeStreak(user.id);
  const pendingInvites = await getPendingInvites(user.id);
  const membership = await getMembershipSummary(user.id);
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
    challenges: challenges.map((challenge) => challengeFor(challenge, joinedIds, membership.challengeJoinPrice, user.id)),
    joinedIds: [...joinedIds],
    steps: Number(stepTotal?.total ?? 0),
    activities,
    wallet: walletFor(user),
    profile: profileFor(user),
    membership,
    healthSources,
    recoveryCases,
    stepReviews,
    freeStreak,
    pendingInvites,
  };
}

router.get("/stridepool/bootstrap", async (req, res): Promise<void> => {
  res.json(GetStridePoolBootstrapResponse.parse(await getBootstrap(req)));
});

router.get("/stridepool/community-challenges", async (req, res): Promise<void> => {
  const query = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 120).toLowerCase() : "";
  const challenges = await getVisibleChallenges(req.isAuthenticated() ? req.user.id : null);
  const openChallenges = challenges.filter((challenge) =>
    isOpenFreeCommunityChallenge(challenge) &&
    (!query || `${challenge.name} ${challenge.theme} ${challenge.level}`.toLowerCase().includes(query)),
  );
  const joinedIds = req.isAuthenticated()
    ? new Set((await db.select({ challengeId: entriesTable.challengeId }).from(entriesTable).where(and(eq(entriesTable.userId, req.user.id), eq(entriesTable.status, "active")))).map((entry) => entry.challengeId))
    : new Set<string>();
  const membership = req.isAuthenticated() ? await getMembershipSummary(req.user.id) : DEFAULT_MEMBERSHIP;
  res.json(GetStridePoolCommunityChallengesResponse.parse({ challenges: openChallenges.map((challenge) => challengeFor(challenge, joinedIds, membership.challengeJoinPrice, req.isAuthenticated() ? req.user.id : null)) }));
});

router.post("/stridepool/challenges", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const body = CreateStridePoolChallengeBody.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const start = body.data.startDate;
  const end = body.data.endDate;
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    res.status(400).json({ error: "Choose valid start and end dates." });
    return;
  }
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);
  const calculatedDays = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
  if (calculatedDays !== body.data.days || calculatedDays < 1 || calculatedDays > 90) {
    res.status(400).json({ error: "Choose a challenge window between one and 90 days." });
    return;
  }
  if (body.data.challengeType === "goal" && body.data.dailyGoal < 1) {
    res.status(400).json({ error: "Daily-goal challenges need at least one step per day." });
    return;
  }
  const user = await getUser(userId);
  const membership = await getMembershipSummary(userId);
  if (membership.plan !== "pro") {
    res.status(409).json({ error: "Creating a challenge requires StridePool Pro." });
    return;
  }
  if (membership.activeCreatedChallengeCount >= membership.challengeCreationLimit) {
    res.status(409).json({ error: "Pro includes one active challenge you create at a time." });
    return;
  }
  if (membership.activeChallengeCount >= membership.activeChallengeLimit) {
    res.status(409).json({ error: "You already have five active challenges. Finish or leave one before creating another." });
    return;
  }
  const compliance = getComplianceStatus();
  const eligibility = user ? checkEligibility({
    age: user.eligibilityAge,
    state: user.eligibilityState,
    identityStatus: user.eligibilityIdentityStatus === "verified" || user.eligibilityIdentityStatus === "pending" ? user.eligibilityIdentityStatus : "not_started",
    acceptedTerms: user.eligibilityAcceptedTerms,
  }) : null;
  if (!compliance.paidPlayEnabled || !eligibility?.eligible) {
    res.status(409).json({ error: "Challenge creation is locked until launch controls and your eligibility checks pass." });
    return;
  }
  const challengeId = `${body.data.challengeType}_challenge_${randomBytes(12).toString("hex")}`;
  const [challenge] = await db.transaction(async (tx) => {
    const [created] = await tx.insert(challengesTable).values({
      id: challengeId,
      name: body.data.name,
      theme: body.data.theme,
      level: body.data.challengeType === "goal" ? "Steady" : "Open",
      startDate,
      endDate,
      days: body.data.days,
      dailyGoal: body.data.dailyGoal,
      entryFee: body.data.entryFee.toFixed(2),
      prizePool: "0.00",
      participantCount: 0,
      finishers: 0,
      settlementStatus: "open",
      color: body.data.color,
      challengeType: body.data.challengeType,
      goalType: body.data.challengeType === "goal" ? "fixed" : "total_steps",
      community: false,
      creatorUserId: userId,
    }).returning();
    return [created] as const;
  });
  res.status(201).json(CreateStridePoolChallengeResponse.parse(challengeFor(challenge, new Set(), membership.challengeJoinPrice, userId)));
});

router.post("/stridepool/groups/challenges", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const body = CreateStridePoolGroupChallengeBody.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const membership = await getMembershipSummary(userId);
  if (membership.plan !== "pro") {
    res.status(409).json({ error: "Creating a private challenge requires StridePool Pro." });
    return;
  }
  if (membership.activeCreatedChallengeCount >= membership.challengeCreationLimit) {
    res.status(409).json({ error: "Pro includes one active challenge you create at a time." });
    return;
  }
  if (membership.activeChallengeCount >= membership.activeChallengeLimit) {
    res.status(409).json({ error: "You already have five active challenges. Finish or leave one before creating another." });
    return;
  }
  const start = body.data.startDate;
  const end = body.data.endDate;
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);
  const days = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || days < 1 || days > 90) {
    res.status(400).json({ error: "Choose a challenge window between one and 90 days." });
    return;
  }
  const memberIds = [...new Set([userId, ...body.data.memberUserIds])];
  const members = await db.select().from(usersTable).where(inArray(usersTable.id, memberIds));
  if (members.length !== memberIds.length) {
    res.status(404).json({ error: "One or more invited walkers could not be found." });
    return;
  }
  const groupId = `group_${randomBytes(12).toString("hex")}`;
  const challengeId = `group_challenge_${randomBytes(12).toString("hex")}`;
  const [group, challenge] = await db.transaction(async (tx) => {
    const [createdGroup] = await tx.insert(groupsTable).values({
      id: groupId,
      name: body.data.groupName,
      ownerUserId: userId,
    }).returning();
    await tx.insert(groupMembersTable).values(memberIds.map((memberId) => ({ groupId, userId: memberId })));
    const challengeValues: typeof challengesTable.$inferInsert = {
      id: challengeId,
      name: body.data.name,
      theme: body.data.theme,
      level: "community",
      startDate,
      endDate,
      days,
      dailyGoal: body.data.dailyGoal,
      entryFee: "0",
      prizePool: "0",
      participantCount: 0,
      finishers: 0,
      settlementStatus: "open",
      color: body.data.color,
      challengeType: body.data.challengeType,
      goalType: body.data.goalType,
      community: true,
      groupId,
      creatorUserId: userId,
    };
    const [createdChallenge] = await tx.insert(challengesTable).values(challengeValues).returning();
    return [createdGroup, createdChallenge] as const;
  });
  res.status(201).json(CreateStridePoolGroupChallengeResponse.parse({
    group: { id: group.id, name: group.name, ownerUserId: group.ownerUserId, memberCount: memberIds.length },
    challenge: challengeFor(challenge, new Set(), membership.challengeJoinPrice, userId),
    members: members.map(publicUser),
  }));
});

router.get("/stridepool/users/search", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const query = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 120) : "";
  if (query.length < 2) {
    res.json(SearchStridePoolUsersResponse.parse({ users: [] }));
    return;
  }
  const users = await db.select().from(usersTable).where(and(
    sql`${usersTable.id} <> ${userId}`,
    or(ilike(usersTable.displayName, `%${query}%`), ilike(usersTable.email, `%${query}%`), ilike(usersTable.firstName, `%${query}%`), ilike(usersTable.lastName, `%${query}%`)),
  )).orderBy(asc(usersTable.displayName)).limit(10);
  res.json(SearchStridePoolUsersResponse.parse({ users: users.map(publicUser) }));
});

router.get("/stridepool/notifications", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  await refreshNotifications(userId);
  const notifications = await db.select().from(notificationsTable)
    .where(eq(notificationsTable.userId, userId))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(40);
  const [unread] = await db.select({ count: sql<number>`count(*)` }).from(notificationsTable).where(and(
    eq(notificationsTable.userId, userId),
    isNull(notificationsTable.readAt),
  ));
  res.json(GetStridePoolNotificationsResponse.parse({
    notifications: notifications.map((notification) => ({
      id: String(notification.id),
      type: notification.type,
      title: notification.title,
      body: notification.body,
      challengeId: notification.challengeId,
      actorUserId: notification.actorUserId,
      createdAt: notification.createdAt.toISOString(),
      readAt: notification.readAt?.toISOString() ?? null,
    })),
    unreadCount: Number(unread?.count ?? 0),
  }));
});

router.post("/stridepool/notifications/:id/read", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(404).json({ error: "Notification not found." });
    return;
  }
  const updated = await db.update(notificationsTable).set({ readAt: new Date() }).where(and(
    eq(notificationsTable.id, id),
    eq(notificationsTable.userId, userId),
  )).returning({ id: notificationsTable.id });
  if (!updated.length) {
    res.status(404).json({ error: "Notification not found." });
    return;
  }
  res.json(MarkStridePoolNotificationReadResponse.parse({ success: true }));
});

router.post("/stridepool/notifications/read-all", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  await db.update(notificationsTable).set({ readAt: new Date() }).where(and(
    eq(notificationsTable.userId, userId),
    isNull(notificationsTable.readAt),
  ));
  res.json(MarkAllStridePoolNotificationsReadResponse.parse({ success: true }));
});

router.get("/stridepool/challenges/:id/leaderboard", async (req, res): Promise<void> => {
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
  if (challenge.groupId && (!req.isAuthenticated() || !(await isGroupMember(challenge.groupId, req.user.id)))) {
    res.status(404).json({ error: "Private group challenge not found." });
    return;
  }
  const entries = await db.select({ entry: entriesTable, user: usersTable }).from(entriesTable).innerJoin(usersTable, eq(entriesTable.userId, usersTable.id)).where(and(
    eq(entriesTable.challengeId, challenge.id),
    eq(entriesTable.status, "active"),
  ));
  const records = await db.select().from(dailyStepRecordsTable).where(and(
    eq(dailyStepRecordsTable.challengeId, challenge.id),
    eq(dailyStepRecordsTable.verified, true),
  ));
  const overrides = await db.select().from(challengeParticipantOverridesTable)
    .where(eq(challengeParticipantOverridesTable.challengeId, challenge.id))
    .orderBy(desc(challengeParticipantOverridesTable.createdAt));
  const latestOverrides = new Map<string, ParticipantStatus>();
  for (const override of overrides) {
    if (!latestOverrides.has(override.userId) && (override.status === "on_track" || override.status === "finished")) {
      latestOverrides.set(override.userId, override.status);
    }
  }
  const currentUserId = req.isAuthenticated() ? req.user.id : null;
  const leaderboard = await Promise.all(entries.map(async ({ entry, user }) => {
    const userRecords = records.filter((record) => record.userId === entry.userId);
    const dailyGoal = challenge.goalType === "personalized" ? numberValue(user.goalBaseline) || challenge.dailyGoal : challenge.dailyGoal;
    const steps = userRecords.filter((record) => record.recordDate >= challenge.startDate && record.recordDate <= challenge.endDate).reduce((total, record) => total + record.steps, 0);
    const completedDays = userRecords.filter((record) => record.recordDate >= challenge.startDate && record.recordDate <= challenge.endDate && (challenge.challengeType === "ranking" ? record.steps > 0 : record.steps >= dailyGoal)).length;
    const participant = getParticipantStatus(challenge, userRecords, dailyGoal, latestOverrides.get(entry.userId));
    return { entryId: entry.id, userId: user.id, displayName: publicUser(user).displayName, steps, completedDays, completionPercent: Math.min(100, Math.round((completedDays / challenge.days) * 100)), status: participant.status, isCurrentUser: user.id === currentUserId };
  }));
  leaderboard.sort((a, b) => b.steps - a.steps || b.completedDays - a.completedDays || a.displayName.localeCompare(b.displayName));
  const projection = challenge.challengeType === "ranking"
    ? (() => {
        const payouts = calculatePodiumPayouts(
          leaderboard.map((entry) => ({ entryId: entry.entryId, steps: entry.steps })),
          Math.round(numberValue(challenge.prizePool) * 100),
        );
        const payoutByEntryId = new Map(payouts.map((payout) => [payout.entryId, payout.payoutCents / 100]));
        return {
          eligibleParticipantCount: leaderboard.length,
          disqualifiedCount: 0,
          payoutByUserId: new Map(leaderboard.map((entry) => [entry.userId, payoutByEntryId.get(entry.entryId) ?? 0])),
        };
      })()
    : calculateProjectedPayouts(leaderboard, numberValue(challenge.prizePool));
  res.json(GetStridePoolChallengeLeaderboardResponse.parse({
    challengeId: challenge.id,
    dailyGoal: challenge.dailyGoal,
    days: challenge.days,
    prizePool: numberValue(challenge.prizePool),
    eligibleParticipantCount: projection.eligibleParticipantCount,
    disqualifiedCount: projection.disqualifiedCount,
    leaderboard: leaderboard.map(({ entryId: _entryId, ...entry }, index) => ({
      rank: index + 1,
      ...entry,
      projectedPayout: projection.payoutByUserId.get(entry.userId) ?? 0,
    })),
  }));
});

router.get("/stridepool/lifetime-leaderboard", async (req, res): Promise<void> => {
  const rows = await db.select({
    userId: usersTable.id,
    displayName: usersTable.displayName,
    firstName: usersTable.firstName,
    lastName: usersTable.lastName,
    recordDate: dailyStepRecordsTable.recordDate,
    steps: dailyStepRecordsTable.steps,
  }).from(dailyStepRecordsTable)
    .innerJoin(usersTable, eq(dailyStepRecordsTable.userId, usersTable.id))
    .innerJoin(challengesTable, eq(dailyStepRecordsTable.challengeId, challengesTable.id))
    .where(and(
      eq(dailyStepRecordsTable.verified, true),
      eq(challengesTable.community, true),
      eq(challengesTable.entryFee, "0"),
      sql`${usersTable.id} NOT LIKE 'anon_%'`,
    ));
  const currentUserId = req.isAuthenticated() ? req.user.id : null;
  const leaderboard = buildLifetimeLeaderboard(rows as LifetimeLeaderboardRow[], currentUserId);
  res.json(GetStridePoolLifetimeLeaderboardResponse.parse({ leaderboard }));
});

router.post("/stridepool/challenges/:id/invites", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const params = JoinStridePoolChallengeParams.safeParse(req.params);
  const body = CreateStridePoolChallengeInviteBody.safeParse(req.body ?? {});
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Choose a free community challenge and an optional person to invite." });
    return;
  }
  const [challenge] = await db.select().from(challengesTable).where(eq(challengesTable.id, params.data.id));
  if (!challenge || !isOpenFreeCommunityChallenge(challenge)) {
    res.status(400).json({ error: "Invites are available only for open free community challenges." });
    return;
  }
  if (challenge.groupId) {
    res.status(400).json({ error: "Private group challenges use their group membership instead of public invites." });
    return;
  }
  const [entry] = await db.select().from(entriesTable).where(and(
    eq(entriesTable.userId, userId),
    eq(entriesTable.challengeId, challenge.id),
    eq(entriesTable.status, "active"),
  ));
  if (!entry) {
    res.status(400).json({ error: "Join the free community challenge before inviting someone." });
    return;
  }
  if (body.data.inviteeUserId === userId) {
    res.status(400).json({ error: "You cannot invite yourself." });
    return;
  }
  if (body.data.inviteeUserId) {
    const [invitee] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, body.data.inviteeUserId));
    if (!invitee) {
      res.status(404).json({ error: "That walker could not be found." });
      return;
    }
  }
  const token = randomBytes(24).toString("base64url");
  const [invite] = await db.insert(challengeInvitesTable).values({
    challengeId: challenge.id,
    inviterUserId: userId,
    inviteeUserId: body.data.inviteeUserId,
    token,
  }).returning();
  res.status(201).json(CreateStridePoolChallengeInviteResponse.parse({
    id: String(invite.id),
    token: invite.token,
    inviteUrl: `/invite/${invite.token}`,
    challengeId: invite.challengeId,
    status: "pending",
  }));
});

router.get("/stridepool/invites", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  res.json(GetStridePoolPendingInvitesResponse.parse({ invites: await getPendingInvites(userId) }));
});

router.get("/stridepool/invites/:token", async (req, res): Promise<void> => {
  const token = typeof req.params.token === "string" ? req.params.token : "";
  const [row] = await db.select({
    invite: challengeInvitesTable,
    challenge: challengesTable,
    inviter: usersTable,
  }).from(challengeInvitesTable)
    .innerJoin(challengesTable, eq(challengeInvitesTable.challengeId, challengesTable.id))
    .innerJoin(usersTable, eq(challengeInvitesTable.inviterUserId, usersTable.id))
    .where(eq(challengeInvitesTable.token, token));
  if (!row || row.invite.status !== "pending" || !isOpenFreeCommunityChallenge(row.challenge)) {
    res.status(404).json({ error: "This invite is no longer available." });
    return;
  }
  if (row.challenge.groupId) {
    res.status(404).json({ error: "This invite is no longer available." });
    return;
  }
  res.json(GetStridePoolInviteResponse.parse({
    token,
    challenge: challengeFor(row.challenge, new Set()),
    inviter: publicUser(row.inviter),
  }));
});

router.post("/stridepool/invites/:token/accept", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const token = typeof req.params.token === "string" ? req.params.token : "";
  const [row] = await db.select({
    invite: challengeInvitesTable,
    challenge: challengesTable,
  }).from(challengeInvitesTable).innerJoin(challengesTable, eq(challengeInvitesTable.challengeId, challengesTable.id)).where(eq(challengeInvitesTable.token, token));
  if (!row || row.invite.status !== "pending" || !isOpenFreeCommunityChallenge(row.challenge)) {
    res.status(404).json({ error: "This invite is no longer available." });
    return;
  }
  if (row.challenge.groupId && (!await isGroupMember(row.challenge.groupId, userId))) {
    res.status(403).json({ error: "This private challenge is limited to its group members." });
    return;
  }
  if (row.invite.inviteeUserId && row.invite.inviteeUserId !== userId) {
    res.status(403).json({ error: "This invite was sent to another StridePool walker." });
    return;
  }
  await db.update(challengeInvitesTable).set({ status: "accepted", acceptedAt: new Date() }).where(eq(challengeInvitesTable.id, row.invite.id));
  const membership = await getMembershipSummary(userId);
  res.json(AcceptStridePoolInviteResponse.parse({ joined: false, challenge: challengeFor(row.challenge, new Set(), membership.challengeJoinPrice, userId) }));
});

router.get("/stridepool/referrals/me", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  res.json(GetStridePoolReferralSummaryResponse.parse(await getReferralSummary(userId)));
});

router.get("/stridepool/referrals/:code", async (req, res): Promise<void> => {
  const params = GetStridePoolReferralPreviewParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "That referral code is invalid." });
    return;
  }
  const preview = await getReferralPreview(params.data.code);
  if (!preview) {
    res.status(404).json({ error: "That referral link is not available." });
    return;
  }
  res.json(GetStridePoolReferralPreviewResponse.parse(preview));
});

router.post("/stridepool/referrals/claim", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const body = ClaimStridePoolReferralBody.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: "Enter a valid referral code." });
    return;
  }
  try {
    const result = await claimReferralCode(userId, body.data.code);
    res.json(ClaimStridePoolReferralResponse.parse({ claimed: true, status: result.status }));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "That referral code could not be claimed." });
  }
});

router.get("/stridepool/sources", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  res.json(GetStridePoolHealthSourcesResponse.parse({ sources: await getHealthSources(userId) }));
});

router.post("/stridepool/sources/:source/connection", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const params = IngestStridePoolSourceSamplesParams.pick({ source: true }).safeParse(req.params);
  const body = UpdateStridePoolHealthSourceConnectionBody.safeParse(req.body);
  if (!params.success || !body.success || !HEALTH_SOURCES.some(({ source }) => source === params.data.source)) {
    res.status(400).json({ error: "Send a valid native health-source permission state." });
    return;
  }
  const source = params.data.source;
  const [connection] = await db.insert(healthSourceConnectionsTable).values({
    userId,
    source,
    status: body.data.status,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: [healthSourceConnectionsTable.userId, healthSourceConnectionsTable.source],
    set: { status: body.data.status, updatedAt: new Date() },
  }).returning();
  await db.update(usersTable).set({
    healthConnected: body.data.status === "connected",
    updatedAt: new Date(),
  }).where(eq(usersTable.id, userId));
  const [verified] = await db.select({ count: sql<number>`count(*)` }).from(stepSourceSamplesTable).where(and(eq(stepSourceSamplesTable.userId, userId), eq(stepSourceSamplesTable.source, source), eq(stepSourceSamplesTable.verificationStatus, "verified")));
  const [pending] = await db.select({ count: sql<number>`count(*)` }).from(stepSourceSamplesTable).where(and(eq(stepSourceSamplesTable.userId, userId), eq(stepSourceSamplesTable.source, source), eq(stepSourceSamplesTable.verificationStatus, "pending_review")));
  res.json({
    source,
    label: HEALTH_SOURCES.find((item) => item.source === source)?.label ?? source,
    status: body.data.status,
    lastSyncedAt: connection?.lastSyncedAt?.toISOString() ?? null,
    lastAttemptedAt: connection?.lastAttemptedAt?.toISOString() ?? null,
    deliveryFailure: connection?.deliveryFailure ?? null,
    nextRetryAt: connection?.nextRetryAt?.toISOString() ?? null,
    verifiedSamples: Number(verified?.count ?? 0),
    pendingReview: Number(pending?.count ?? 0),
  });
});

router.post("/stridepool/sources/:source/delivery", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const params = IngestStridePoolSourceSamplesParams.pick({ source: true }).safeParse(req.params);
  const body = ReportStridePoolSourceDeliveryBody.safeParse(req.body);
  if (!params.success || !body.success || (body.data.outcome === "failure") !== Boolean(body.data.reason)) {
    res.status(400).json({ error: "Send a valid delivery outcome and failure reason." });
    return;
  }
  const now = new Date();
  const supplied = body.data.attemptedAt;
  const attemptedAt = supplied && supplied.getTime() <= now.getTime() && supplied.getTime() >= now.getTime() - 30 * 86400000 ? supplied : now;
  const failure = body.data.outcome === "failure" ? body.data.reason! : null;
  const retry = failure ? new Date(attemptedAt.getTime() + 5 * 60000) : null;
  const table = healthSourceConnectionsTable;
  await db.insert(table).values({
    userId, source: params.data.source, status: "connected",
    lastAttemptedAt: attemptedAt, lastSyncedAt: failure ? null : attemptedAt,
    deliveryFailure: failure, nextRetryAt: retry, updatedAt: now,
  }).onConflictDoUpdate({
    target: [table.userId, table.source],
    // A delayed offline report cannot overwrite a newer successful upload.
    set: {
      lastAttemptedAt: sql`greatest(${table.lastAttemptedAt}, ${attemptedAt})`,
      lastSyncedAt: failure ? table.lastSyncedAt : sql`greatest(${table.lastSyncedAt}, ${attemptedAt})`,
      deliveryFailure: sql`case when ${table.lastAttemptedAt} is null or ${table.lastAttemptedAt} <= ${attemptedAt} then ${failure} else ${table.deliveryFailure} end`,
      nextRetryAt: sql`case when ${table.lastAttemptedAt} is null or ${table.lastAttemptedAt} <= ${attemptedAt} then ${retry} else ${table.nextRetryAt} end`,
      updatedAt: now,
    },
  });
  const sources = await getHealthSources(userId);
  res.json(sources.find((item) => item.source === params.data.source));
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
  const response = await db.transaction(async (tx) => {
    // Serialize both native sources for this account before checking duplicates or
    // rebuilding totals. A transaction alone cannot protect a missing daily row.
    await tx.execute(sql`/* stridepool source ingestion */ select ${usersTable.id} from ${usersTable} where ${usersTable.id} = ${userId} for update`);
    const existing = await tx.select({
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
      const [historicalTotal] = await tx.select({
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
    const inserted = sampleRows.length
      ? await tx.insert(stepSourceSamplesTable).values(sampleRows).onConflictDoNothing().returning()
      : [];
    await tx.insert(healthSourceConnectionsTable).values({
      userId,
      source,
      status: "connected",
      lastAttemptedAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [healthSourceConnectionsTable.userId, healthSourceConnectionsTable.source],
      // A batch is not a completed delivery. The companion confirms success after
      // every batch has been accepted, so a partial upload retains its old cursor.
      set: { status: "connected", updatedAt: now },
    });

    for (const [recordDate] of dayTotals) await rebuildVerifiedDailyTotal(userId, recordDate, source, tx);

    const today = now.toISOString().slice(0, 10);
    const [todayTotal] = await tx.select({
      total: sql<number>`coalesce(sum(${stepSourceSamplesTable.steps}), 0)`,
    }).from(stepSourceSamplesTable).where(and(
      eq(stepSourceSamplesTable.userId, userId),
      eq(stepSourceSamplesTable.recordDate, today),
      eq(stepSourceSamplesTable.verificationStatus, "verified"),
    ));
    const pendingReviewCount = inserted.filter((sample) => sample.reviewFlags.length > 0).length;
    return IngestStridePoolSourceSamplesResponse.parse({
      source,
      acceptedCount: inserted.length,
      pendingReviewCount,
      steps: Number(todayTotal?.total ?? 0),
      samples: inserted.map((sample) => ({
        sourceSampleId: sample.sourceSampleId,
        verificationStatus: sample.verificationStatus,
        reviewFlags: sample.reviewFlags,
      })),
    });
  });
  res.json(response);
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
  if (challenge.settlementStatus === "settling" || challenge.settlementStatus === "settled") {
    res.status(400).json({ error: "Recovery requests close when challenge settlement has started." });
    return;
  }
  if (challenge.groupId && (!req.isAuthenticated() || !(await isGroupMember(challenge.groupId, req.user.id)))) {
    res.status(req.isAuthenticated() ? 403 : 401).json({ error: "This private challenge is limited to its group members." });
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
  const pendingSamples = await db.select({ reviewFlags: stepSourceSamplesTable.reviewFlags })
    .from(stepSourceSamplesTable)
    .where(and(
      eq(stepSourceSamplesTable.userId, userId),
      eq(stepSourceSamplesTable.verificationStatus, "pending_review"),
    ));
  const sourceFlags = [...new Set(pendingSamples.flatMap((sample) => sample.reviewFlags))];
  const reviewMessage = parsed.data.type === "injury_pause"
    ? "Your injury pause is pending. Support will protect the affected days while reviewing your source history."
    : "Support review is open. We will compare source samples, timestamps, and challenge rules before settlement.";
  const recovery = await db.transaction(async (tx) => {
    const [created] = await tx.insert(challengeRecoveryCasesTable).values({
      userId,
      challengeId: challenge.id,
      type: parsed.data.type,
      status: "requested",
      reason: parsed.data.reason,
      sourceFlags,
      reviewMessage,
    }).returning();
    await tx.update(challengesTable).set({ settlementStatus: "pending_review" }).where(eq(challengesTable.id, challenge.id));
    return created;
  });
  const result = {
    id: String(recovery.id),
    challengeId: challenge.id,
    challengeName: challenge.name,
    type: recovery.type,
    status: recovery.status,
    reason: recovery.reason,
    sourceFlags: recovery.sourceFlags,
    reviewMessage: recovery.reviewMessage,
    requestedAt: recovery.requestedAt.toISOString(),
    updatedAt: recovery.updatedAt.toISOString(),
  };
  res.status(201).json(RequestStridePoolRecoveryResponse.parse(result));
});

router.post("/stridepool/challenges/:id/join", async (req, res): Promise<void> => {
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
  if (challenge.groupId && (!req.isAuthenticated() || !(await isGroupMember(challenge.groupId, req.user.id)))) {
    res.status(req.isAuthenticated() ? 403 : 401).json({ error: "This private challenge is limited to its group members." });
    return;
  }
  const userId = req.isAuthenticated()
    ? req.user.id
    : challenge.community && numberValue(challenge.entryFee) === 0
      ? await ensureAnonymousWalker(req, res)
      : null;
  if (!userId) {
    res.status(401).json({ error: "Login required to join a paid challenge." });
    return;
  }
  if (!challenge.community || numberValue(challenge.entryFee) !== 0) {
    res.status(409).json({ error: "Paid challenges require secure checkout before your place is activated." });
    return;
  }
  try {
    const result = await joinMoneyChallenge(userId, params.data.id);
    if (req.isAuthenticated()) await qualifyReferralForUser(userId);
    res.json(JoinStridePoolChallengeResponse.parse({ joined: true, wallet: result.wallet }));
  } catch (error) {
    if (error instanceof MoneyLogicError) {
      const status = error.code === "NOT_FOUND" ? 404 : 409;
      res.status(status).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: error instanceof Error ? error.message : "Could not join this challenge." });
  }
});

router.post("/stridepool/challenges/:id/leave", async (req, res): Promise<void> => {
  const params = LeaveStridePoolChallengeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [challenge] = await db.select().from(challengesTable).where(eq(challengesTable.id, params.data.id));
  if (!challenge) {
    res.status(404).json({ error: "Challenge not found." });
    return;
  }
  if (challenge.groupId && (!req.isAuthenticated() || !(await isGroupMember(challenge.groupId, req.user.id)))) {
    res.status(req.isAuthenticated() ? 403 : 401).json({ error: "This private challenge is limited to its group members." });
    return;
  }
  const userId = req.isAuthenticated()
    ? req.user.id
    : challenge.community && numberValue(challenge.entryFee) === 0
      ? anonymousWalkerId(req)
      : null;
  if (!userId) {
    res.status(401).json({ error: "Login required to leave this challenge." });
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