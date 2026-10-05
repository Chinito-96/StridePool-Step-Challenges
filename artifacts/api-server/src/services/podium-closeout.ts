import { ReplitConnectors } from "@replit/connectors-sdk";
import { challengesTable, db, settleChallenge, usersTable, type SettlementResult } from "@workspace/db";
import { and, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { logger } from "../lib/logger";

const DEFAULT_CLOSEOUT_INTERVAL_MS = 60_000;
const CLOSEOUT_ALERT_CLAIM_LEASE_MS = 5 * 60_000;
export const PODIUM_CLOSEOUT_ALERT_FAILURE_THRESHOLD = 3;

type CloseoutFailureSnapshot = {
  challengeId: string;
  failureCount: number;
};

type ClaimedCloseoutAlert = {
  challengeId: string;
  challengeName: string;
  failureCount: number;
  lastFailedAt: Date;
  claimId: string;
};

type CloseoutDependencies = {
  findChallengeIds: (today: string) => Promise<string[]>;
  settle: (challengeId: string, now: Date) => Promise<Pick<SettlementResult, "alreadySettled">>;
  recordFailure: (challengeId: string, now: Date, today: string) => Promise<CloseoutFailureSnapshot | null>;
  claimAlert: (challengeId: string, now: Date, today: string) => Promise<ClaimedCloseoutAlert | null>;
  sendAlert: (alert: ClaimedCloseoutAlert) => Promise<void>;
  markAlertSent: (challengeId: string, claimId: string, now: Date) => Promise<void>;
  releaseAlertClaim: (challengeId: string, claimId: string) => Promise<void>;
};

const defaultDependencies: CloseoutDependencies = {
  async findChallengeIds(today) {
    const challenges = await db
      .select({ id: challengesTable.id })
      .from(challengesTable)
      .where(and(
        eq(challengesTable.challengeType, "ranking"),
        eq(challengesTable.settlementStatus, "open"),
        lt(challengesTable.endDate, today),
      ));
    return challenges.map((challenge) => challenge.id);
  },
  settle: settleChallenge,
  async recordFailure(challengeId, now, today) {
    // A concurrent successful settlement must never regain an active alert.
    const [challenge] = await db.update(challengesTable).set({
      closeoutFailureCount: sql`${challengesTable.closeoutFailureCount} + 1`,
      closeoutLastFailedAt: now,
    }).where(and(
      eq(challengesTable.id, challengeId),
      eq(challengesTable.challengeType, "ranking"),
      eq(challengesTable.settlementStatus, "open"),
      lt(challengesTable.endDate, today),
    )).returning({
      challengeId: challengesTable.id,
      failureCount: challengesTable.closeoutFailureCount,
    });
    return challenge ?? null;
  },
  async claimAlert(challengeId, now, today) {
    const claimId = randomUUID();
    const expiredClaimBefore = new Date(now.getTime() - CLOSEOUT_ALERT_CLAIM_LEASE_MS);
    const [challenge] = await db.update(challengesTable).set({
      closeoutAlertClaimId: claimId,
      closeoutAlertClaimedAt: now,
    }).where(and(
      eq(challengesTable.id, challengeId),
      eq(challengesTable.challengeType, "ranking"),
      eq(challengesTable.settlementStatus, "open"),
      lt(challengesTable.endDate, today),
      gte(challengesTable.closeoutFailureCount, PODIUM_CLOSEOUT_ALERT_FAILURE_THRESHOLD),
      isNull(challengesTable.closeoutAlertSentAt),
      or(
        isNull(challengesTable.closeoutAlertClaimId),
        isNull(challengesTable.closeoutAlertClaimedAt),
        lt(challengesTable.closeoutAlertClaimedAt, expiredClaimBefore),
      ),
    )).returning({
      challengeId: challengesTable.id,
      challengeName: challengesTable.name,
      failureCount: challengesTable.closeoutFailureCount,
      lastFailedAt: challengesTable.closeoutLastFailedAt,
    });
    if (!challenge?.lastFailedAt) return null;
    return { ...challenge, lastFailedAt: challenge.lastFailedAt, claimId };
  },
  async sendAlert(alert) {
    const from = process.env.RESEND_FROM_EMAIL?.trim();
    if (!from) throw new Error("RESEND_FROM_EMAIL is required to send podium closeout alerts.");

    const admins = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.role, "admin"));
    const recipients = [...new Set(admins.map(({ email }) => email?.trim()).filter((email): email is string => Boolean(email)))];
    if (recipients.length === 0) throw new Error("No admin email recipients are configured for podium closeout alerts.");

    const connectors = new ReplitConnectors();
    const response = await connectors.proxy("resend", "/emails", {
      method: "POST",
      headers: { "Idempotency-Key": `podium-closeout-alert:${alert.challengeId}` },
      body: {
        from,
        to: recipients,
        subject: `Ranking payout blocked: ${alert.challengeName}`,
        text: [
          "A ranking challenge has repeatedly failed automatic payout closeout.",
          "",
          `Challenge: ${alert.challengeName}`,
          `Challenge ID: ${alert.challengeId}`,
          `Failure count: ${alert.failureCount}`,
          `Last failure: ${alert.lastFailedAt.toISOString()}`,
        ].join("\n"),
      },
    });
    if (!response.ok) {
      throw new Error(`Resend rejected the podium closeout alert (HTTP ${response.status}).`);
    }
  },
  async markAlertSent(challengeId, claimId, now) {
    await db.update(challengesTable).set({
      closeoutAlertSentAt: now,
      closeoutAlertClaimId: null,
      closeoutAlertClaimedAt: null,
    }).where(and(
      eq(challengesTable.id, challengeId),
      eq(challengesTable.settlementStatus, "open"),
      eq(challengesTable.closeoutAlertClaimId, claimId),
    ));
  },
  async releaseAlertClaim(challengeId, claimId) {
    await db.update(challengesTable).set({
      closeoutAlertClaimId: null,
      closeoutAlertClaimedAt: null,
    }).where(and(
      eq(challengesTable.id, challengeId),
      eq(challengesTable.settlementStatus, "open"),
      eq(challengesTable.closeoutAlertClaimId, claimId),
    ));
  },
};

export type PodiumCloseoutResult = {
  found: number;
  settled: number;
  failed: number;
};

export async function closeFinishedPodiumChallenges(
  now = new Date(),
  overrides: Partial<CloseoutDependencies> = {},
): Promise<PodiumCloseoutResult> {
  const dependencies: CloseoutDependencies = { ...defaultDependencies, ...overrides };
  const today = now.toISOString().slice(0, 10);
  const challengeIds = await dependencies.findChallengeIds(today);
  let settled = 0;
  let failed = 0;

  for (const challengeId of challengeIds) {
    try {
      const result = await dependencies.settle(challengeId, now);
      if (!result.alreadySettled) settled += 1;
    } catch (err) {
      failed += 1;
      logger.error({ err, challengeId }, "Podium challenge closeout failed");
      let failure: CloseoutFailureSnapshot | null;
      try {
        failure = await dependencies.recordFailure(challengeId, now, today);
      } catch (recordError) {
        logger.error({ err: recordError, challengeId }, "Could not record podium closeout failure");
        continue;
      }
      if (!failure || failure.failureCount < PODIUM_CLOSEOUT_ALERT_FAILURE_THRESHOLD) continue;

      let alert: ClaimedCloseoutAlert | null;
      try {
        alert = await dependencies.claimAlert(challengeId, now, today);
      } catch (claimError) {
        logger.error({ err: claimError, challengeId }, "Could not claim podium closeout support alert");
        continue;
      }
      if (!alert) continue;
      try {
        await dependencies.sendAlert(alert);
        await dependencies.markAlertSent(challengeId, alert.claimId, now);
        logger.warn({
          challengeId,
          failureCount: alert.failureCount,
          lastFailedAt: alert.lastFailedAt,
        }, "Podium closeout support alert sent");
      } catch (notificationError) {
        try {
          await dependencies.releaseAlertClaim(challengeId, alert.claimId);
        } catch (releaseError) {
          logger.error({ err: releaseError, challengeId }, "Could not release podium closeout alert claim");
        }
        logger.error({ err: notificationError, challengeId }, "Could not send podium closeout support alert");
      }
    }
  }

  return { found: challengeIds.length, settled, failed };
}

export function startPodiumCloseoutScheduler(
  intervalMs = DEFAULT_CLOSEOUT_INTERVAL_MS,
): NodeJS.Timeout {
  let running = false;

  const run = async () => {
    if (running) return;
    running = true;
    try {
      const result = await closeFinishedPodiumChallenges();
      if (result.found > 0) logger.info(result, "Podium challenge closeout pass completed");
    } catch (err) {
      logger.error({ err }, "Podium challenge closeout pass failed");
    } finally {
      running = false;
    }
  };

  void run();
  const timer = setInterval(() => void run(), intervalMs);
  timer.unref();
  return timer;
}