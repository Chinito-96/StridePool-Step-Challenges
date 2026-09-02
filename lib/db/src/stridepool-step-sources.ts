export const STEP_SOURCE_IDS = [
  "demo",
  "manual",
  "csv_import",
  "apple_health",
  "health_connect",
] as const;

export type StepSourceId = (typeof STEP_SOURCE_IDS)[number];

export type StepSampleForReview = {
  steps: number;
  startTime: Date;
  endTime: Date;
  recordedAt?: Date | null;
};

export const STEP_REVIEW_LIMITS = {
  maxSampleSteps: 60_000,
  maxDailySteps: 60_000,
  burstSteps: 1_500,
  burstWindowMinutes: 5,
  maxBackfillHours: 48,
} as const;

export function reviewStepSample(sample: StepSampleForReview): string[] {
  const flags: string[] = [];
  const durationMinutes = (sample.endTime.getTime() - sample.startTime.getTime()) / 60000;

  if (durationMinutes <= 0) flags.push("invalid_interval");
  if (durationMinutes > 0 && durationMinutes < STEP_REVIEW_LIMITS.burstWindowMinutes && sample.steps > STEP_REVIEW_LIMITS.burstSteps) {
    flags.push("burst_rate");
  }
  if (sample.steps > STEP_REVIEW_LIMITS.maxSampleSteps) flags.push("implausible_sample_total");
  if (sample.recordedAt && sample.recordedAt.getTime() - sample.endTime.getTime() > STEP_REVIEW_LIMITS.maxBackfillHours * 60 * 60 * 1000) {
    flags.push("backfilled_data");
  }

  return flags;
}

export function sourceLabel(source: StepSourceId): string {
  return {
    demo: "Demo steps",
    manual: "Manual entry",
    csv_import: "CSV import",
    apple_health: "Apple Health",
    health_connect: "Android Health Connect",
  }[source];
}