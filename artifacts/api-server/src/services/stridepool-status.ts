import type { Challenge, DailyStepRecord } from "@workspace/db";

export type ParticipantStatus = "on_track" | "eliminated" | "finished";
export type LifetimeLeaderboardRow = { userId: string; displayName: string | null; recordDate: string; steps: number };
export type ProjectedPayoutRow = { userId: string; status: ParticipantStatus };

function shiftDate(value: string, amount: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function daysThrough(startDate: string, endDate: string): string[] {
  const days: string[] = [];
  for (let cursor = startDate; cursor <= endDate; cursor = shiftDate(cursor, 1)) days.push(cursor);
  return days;
}

export function getParticipantStatus(
  challenge: Challenge,
  records: DailyStepRecord[],
  dailyGoal: number,
  overrideStatus?: ParticipantStatus,
  today = new Date().toISOString().slice(0, 10),
): { status: ParticipantStatus; missedDays: number; elapsedDays: number } {
  if (overrideStatus) return { status: overrideStatus, missedDays: 0, elapsedDays: 0 };
  const through = today < challenge.startDate ? null : today > challenge.endDate ? challenge.endDate : shiftDate(today, -1);
  const elapsedDays = through ? daysThrough(challenge.startDate, through).length : 0;
  if (challenge.challengeType === "ranking") {
    return { status: today > challenge.endDate ? "finished" : "on_track", missedDays: 0, elapsedDays };
  }
  const qualifyingDates = new Set(
    records
      .filter((record) => record.recordDate >= challenge.startDate && record.recordDate <= challenge.endDate && record.steps >= dailyGoal)
      .map((record) => record.recordDate),
  );
  const missedDays = through ? daysThrough(challenge.startDate, through).filter((date) => !qualifyingDates.has(date)).length : 0;
  if (challenge.challengeType === "elimination" && missedDays > 0) {
    return { status: "eliminated", missedDays, elapsedDays };
  }
  if (today > challenge.endDate) {
    return { status: missedDays === 0 ? "finished" : "eliminated", missedDays, elapsedDays };
  }
  return { status: "on_track", missedDays, elapsedDays };
}

export function buildLifetimeLeaderboard(rows: LifetimeLeaderboardRow[], currentUserId: string | null) {
  const perUserDate = new Map<string, number>();
  const names = new Map<string, string>();
  for (const row of rows) {
    const key = `${row.userId}:${row.recordDate}`;
    perUserDate.set(key, Math.max(perUserDate.get(key) ?? 0, row.steps));
    names.set(row.userId, row.displayName || "StridePool walker");
  }
  const totals = new Map<string, { steps: number; daysLogged: number }>();
  for (const [key, steps] of perUserDate) {
    const userId = key.slice(0, key.indexOf(":"));
    const current = totals.get(userId) ?? { steps: 0, daysLogged: 0 };
    current.steps += steps;
    current.daysLogged += 1;
    totals.set(userId, current);
  }
  return [...totals.entries()]
    .map(([userId, total]) => ({ userId, displayName: names.get(userId) ?? "StridePool walker", ...total, isCurrentUser: userId === currentUserId }))
    .sort((a, b) => b.steps - a.steps || b.daysLogged - a.daysLogged || a.displayName.localeCompare(b.displayName))
    .map((entry, index) => ({ rank: index + 1, ...entry }));
}

export function calculateProjectedPayouts(rows: ProjectedPayoutRow[], prizePool: number) {
  const eligible = rows.filter((row) => row.status !== "eliminated");
  const poolCents = Math.round(prizePool * 100);
  const baseCents = eligible.length ? Math.floor(poolCents / eligible.length) : 0;
  const remainder = eligible.length ? poolCents % eligible.length : 0;
  return {
    eligibleParticipantCount: eligible.length,
    disqualifiedCount: rows.length - eligible.length,
    payoutByUserId: new Map(eligible.map((row, index) => [
      row.userId,
      (baseCents + (index < remainder ? 1 : 0)) / 100,
    ])),
  };
}