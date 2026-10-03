import { challengesTable, db, settleChallenge, type SettlementResult } from "@workspace/db";
import { and, eq, lt, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

const DEFAULT_CLOSEOUT_INTERVAL_MS = 60_000;

type CloseoutDependencies = {
  findChallengeIds: (today: string) => Promise<string[]>;
  settle: (challengeId: string, now: Date) => Promise<Pick<SettlementResult, "alreadySettled">>;
  recordFailure: (challengeId: string, now: Date, today: string) => Promise<void>;
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
    await db.update(challengesTable).set({
      closeoutFailureCount: sql`${challengesTable.closeoutFailureCount} + 1`,
      closeoutLastFailedAt: now,
    }).where(and(
      eq(challengesTable.id, challengeId),
      eq(challengesTable.challengeType, "ranking"),
      eq(challengesTable.settlementStatus, "open"),
      lt(challengesTable.endDate, today),
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
  dependencies: CloseoutDependencies = defaultDependencies,
): Promise<PodiumCloseoutResult> {
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
      try {
        await dependencies.recordFailure(challengeId, now, today);
      } catch (recordError) {
        logger.error({ err: recordError, challengeId }, "Could not record podium closeout failure");
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