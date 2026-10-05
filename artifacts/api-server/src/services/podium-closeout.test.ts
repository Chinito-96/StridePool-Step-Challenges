import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { closeFinishedPodiumChallenges, PODIUM_CLOSEOUT_ALERT_FAILURE_THRESHOLD } from "./podium-closeout";

describe("podium challenge closeout", () => {
  it("uses the UTC date and settles every discovered challenge", async () => {
    const settled: Array<{ challengeId: string; now: Date }> = [];
    let receivedToday = "";
    const now = new Date("2026-09-16T00:00:01.000Z");

    const result = await closeFinishedPodiumChallenges(now, {
      findChallengeIds: async (today) => {
        receivedToday = today;
        return ["ranking-one", "ranking-two"];
      },
      settle: async (challengeId, settledAt) => {
        settled.push({ challengeId, now: settledAt });
        return { alreadySettled: false };
      },
      recordFailure: async () => null,
    });

    assert.equal(receivedToday, "2026-09-16");
    assert.deepEqual(settled, [
      { challengeId: "ranking-one", now },
      { challengeId: "ranking-two", now },
    ]);
    assert.deepEqual(result, { found: 2, settled: 2, failed: 0 });
  });

  it("continues after a failure so later challenges can close", async () => {
    const attempted: string[] = [];
    const failures: Array<{ challengeId: string; now: Date; today: string }> = [];

    const result = await closeFinishedPodiumChallenges(new Date("2026-09-16T12:00:00Z"), {
      findChallengeIds: async () => ["fails-once", "still-closes"],
      settle: async (challengeId) => {
        attempted.push(challengeId);
        if (challengeId === "fails-once") throw new Error("temporary failure");
        return { alreadySettled: false };
      },
      recordFailure: async (challengeId, now, today) => {
        failures.push({ challengeId, now, today });
        return null;
      },
    });

    assert.deepEqual(attempted, ["fails-once", "still-closes"]);
    assert.deepEqual(failures, [{ challengeId: "fails-once", now: new Date("2026-09-16T12:00:00Z"), today: "2026-09-16" }]);
    assert.deepEqual(result, { found: 2, settled: 1, failed: 1 });
  });

  it("counts only one new settlement when closeout passes discover the same challenge", async () => {
    let settlementAttempts = 0;
    let releaseSettlements!: () => void;
    let resolveBothAttempts!: () => void;
    const settlementBarrier = new Promise<void>((resolve) => {
      releaseSettlements = resolve;
    });
    const bothAttemptsStarted = new Promise<void>((resolve) => {
      resolveBothAttempts = resolve;
    });
    const payoutLedgerEntries: string[] = [];
    const dependencies = {
      findChallengeIds: async () => ["shared-ranking"],
      settle: async () => {
        const attempt = ++settlementAttempts;
        if (attempt === 2) resolveBothAttempts();
        await settlementBarrier;
        if (attempt === 1) {
          payoutLedgerEntries.push("shared-ranking-payout");
          return { alreadySettled: false };
        }
        return { alreadySettled: true };
      },
      recordFailure: async () => null,
    };

    const firstPass = closeFinishedPodiumChallenges(new Date("2026-09-16T12:00:00Z"), dependencies);
    const secondPass = closeFinishedPodiumChallenges(new Date("2026-09-16T12:00:00Z"), dependencies);
    await bothAttemptsStarted;
    releaseSettlements();
    const results = await Promise.all([firstPass, secondPass]);

    assert.equal(settlementAttempts, 2);
    assert.deepEqual(results.map((result) => result.settled).sort(), [0, 1]);
    assert.deepEqual(results.map((result) => result.failed), [0, 0]);
    assert.deepEqual(payoutLedgerEntries, ["shared-ranking-payout"]);
  });

  it("emails support once when a closeout failure reaches the alert threshold", async () => {
    const now = new Date("2026-09-16T12:00:00.000Z");
    const sent: Array<{ challengeId: string; failureCount: number; lastFailedAt: Date }> = [];
    let failureCount = 0;
    let notificationSent = false;
    const dependencies = {
      findChallengeIds: async () => ["blocked-ranking"],
      settle: async () => {
        throw new Error("payout closeout unavailable");
      },
      recordFailure: async (challengeId: string) => ({
        challengeId,
        failureCount: ++failureCount,
      }),
      claimAlert: async (challengeId: string, at: Date) => notificationSent ? null : ({
        challengeId,
        challengeName: "Weekend ranking",
        failureCount,
        lastFailedAt: at,
        claimId: `claim-${failureCount}`,
      }),
      sendAlert: async (alert: { challengeId: string; failureCount: number; lastFailedAt: Date }) => {
        sent.push({
          challengeId: alert.challengeId,
          failureCount: alert.failureCount,
          lastFailedAt: alert.lastFailedAt,
        });
      },
      markAlertSent: async () => {
        notificationSent = true;
      },
      releaseAlertClaim: async () => {},
    };

    for (let attempt = 1; attempt <= PODIUM_CLOSEOUT_ALERT_FAILURE_THRESHOLD - 1; attempt += 1) {
      await closeFinishedPodiumChallenges(now, dependencies);
    }
    assert.deepEqual(sent, []);

    await closeFinishedPodiumChallenges(now, dependencies);
    await closeFinishedPodiumChallenges(now, dependencies);
    assert.deepEqual(sent, [{
      challengeId: "blocked-ranking",
      failureCount: PODIUM_CLOSEOUT_ALERT_FAILURE_THRESHOLD,
      lastFailedAt: now,
    }]);
  });
});
