import assert from "node:assert/strict";
import test from "node:test";
import type { Challenge, DailyStepRecord } from "@workspace/db";
import { buildLifetimeLeaderboard, calculateProjectedPayouts, getParticipantStatus } from "./stridepool-status";

const challenge = (overrides: Partial<Challenge> = {}) => ({
  id: "test",
  name: "Test",
  theme: "Test",
  level: "Steady",
  startDate: "2026-09-01",
  endDate: "2026-09-05",
  days: 5,
  dailyGoal: 8000,
  entryFee: "0.00",
  prizePool: "0.00",
  participantCount: 0,
  finishers: 0,
  settlementStatus: "open",
  settledAt: null,
  settledPool: null,
  color: "#000000",
  challengeType: "elimination",
  goalType: "fixed",
  community: true,
  createdAt: new Date("2026-08-01T00:00:00Z"),
  ...overrides,
}) as Challenge;

const record = (recordDate: string, steps: number) => ({ userId: "walker", challengeId: "test", recordDate, steps, verified: true } as DailyStepRecord);

test("elimination challenges remove participants after any closed missed day", () => {
  assert.equal(getParticipantStatus(challenge(), [record("2026-09-02", 8000)], 8000, undefined, "2026-09-02").status, "eliminated");
  assert.equal(getParticipantStatus(challenge(), [], 8000, undefined, "2026-09-02").status, "eliminated");
});

test("an unfinished current day does not count as missed", () => {
  assert.equal(getParticipantStatus(challenge(), [record("2026-09-01", 8000)], 8000, undefined, "2026-09-02").status, "on_track");
});

test("goal-format challenges finish only when every day meets its target", () => {
  const everyDay = [record("2026-09-01", 8000), record("2026-09-02", 8000), record("2026-09-03", 8000), record("2026-09-04", 8000), record("2026-09-05", 8000)];
  const oneDayMissed = [record("2026-09-01", 8000), record("2026-09-03", 8000), record("2026-09-04", 8000), record("2026-09-05", 8000)];
  assert.equal(getParticipantStatus(challenge({ challengeType: "goal" }), everyDay, 8000, undefined, "2026-09-06").status, "finished");
  assert.equal(getParticipantStatus(challenge({ challengeType: "goal" }), oneDayMissed, 8000, undefined, "2026-09-06").status, "eliminated");
});

test("late-arriving verified records can restore an active elimination status", () => {
  assert.equal(getParticipantStatus(challenge(), [], 8000, undefined, "2026-09-02").status, "eliminated");
  assert.equal(getParticipantStatus(challenge(), [record("2026-09-01", 8000)], 8000, undefined, "2026-09-02").status, "on_track");
});

test("manual overrides supersede computed status", () => {
  assert.equal(getParticipantStatus(challenge(), [], 8000, "on_track", "2026-09-02").status, "on_track");
  assert.equal(getParticipantStatus(challenge(), [record("2026-09-01", 8000)], 8000, "finished", "2026-09-02").status, "finished");
});

test("ranking challenges never eliminate walkers for missing a daily target", () => {
  assert.equal(getParticipantStatus(challenge({ challengeType: "ranking", dailyGoal: 0 }), [], 0, undefined, "2026-09-03").status, "on_track");
  assert.equal(getParticipantStatus(challenge({ challengeType: "ranking", dailyGoal: 0 }), [], 0, undefined, "2026-09-06").status, "finished");
});

test("lifetime ranking counts mirrored free rows once per user and date", () => {
  const leaderboard = buildLifetimeLeaderboard([
    { userId: "a", displayName: "Alex", recordDate: "2026-09-01", steps: 8000 },
    { userId: "a", displayName: "Alex", recordDate: "2026-09-01", steps: 9000 },
    { userId: "a", displayName: "Alex", recordDate: "2026-09-02", steps: 7000 },
    { userId: "b", displayName: "Bea", recordDate: "2026-09-01", steps: 15000 },
  ], "a");
  assert.deepEqual(leaderboard.map((entry) => ({ userId: entry.userId, steps: entry.steps, daysLogged: entry.daysLogged, isCurrentUser: entry.isCurrentUser })), [
    { userId: "a", steps: 16000, daysLogged: 2, isCurrentUser: true },
    { userId: "b", steps: 15000, daysLogged: 1, isCurrentUser: false },
  ]);
});

test("projected payouts divide the pool only among contestants still qualified", () => {
  const result = calculateProjectedPayouts([
    { userId: "a", status: "on_track" },
    { userId: "b", status: "eliminated" },
    { userId: "c", status: "on_track" },
  ], 30);
  assert.equal(result.eligibleParticipantCount, 2);
  assert.equal(result.disqualifiedCount, 1);
  assert.equal(result.payoutByUserId.get("a"), 15);
  assert.equal(result.payoutByUserId.get("b"), undefined);
  assert.equal(result.payoutByUserId.get("c"), 15);
});

test("projected payouts allocate indivisible cents deterministically", () => {
  const result = calculateProjectedPayouts([
    { userId: "a", status: "on_track" },
    { userId: "b", status: "on_track" },
    { userId: "c", status: "on_track" },
  ], 10);
  assert.deepEqual([...result.payoutByUserId.values()], [3.34, 3.33, 3.33]);
});