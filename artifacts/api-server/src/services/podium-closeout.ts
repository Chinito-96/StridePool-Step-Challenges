import { challengesTable, db, settleChallenge } from "@workspace/db";
import { and, eq, lt } from "drizzle-orm";
import { logger } from "../lib/logger";

const DEFAULT_CLOSEOUT_INTERVAL_MS = 60_000;

type CloseoutDependencies = {
  findChallengeIds: (today: string) => Promise<string[]>;
  settle: (challengeId: string, now: Date) => Promise<unknown>;
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
      await dependencies.settle(challengeId, now);
      settled += 1;
    } catch (err) {
      failed += 1;
      logger.error({ err, challengeId }, "Podium challenge closeout failed");
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