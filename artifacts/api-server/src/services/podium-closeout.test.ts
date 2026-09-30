import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { closeFinishedPodiumChallenges } from "./podium-closeout";

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
      },
      recordFailure: async () => {},
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
      },
      recordFailure: async (challengeId, now, today) => {
        failures.push({ challengeId, now, today });
      },
    });

    assert.deepEqual(attempted, ["fails-once", "still-closes"]);
    assert.deepEqual(failures, [{ challengeId: "fails-once", now: new Date("2026-09-16T12:00:00Z"), today: "2026-09-16" }]);
    assert.deepEqual(result, { found: 2, settled: 1, failed: 1 });
  });
});