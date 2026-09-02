import assert from "node:assert/strict";
import test from "node:test";
import { reviewStepSample, STEP_REVIEW_LIMITS } from "@workspace/db";

const sample = (overrides: Partial<Parameters<typeof reviewStepSample>[0]> = {}) => ({
  steps: 800,
  startTime: new Date("2026-06-01T08:00:00Z"),
  endTime: new Date("2026-06-01T08:30:00Z"),
  recordedAt: new Date("2026-06-01T08:31:00Z"),
  ...overrides,
});

test("accepts a realistic normalized step sample", () => {
  assert.deepEqual(reviewStepSample(sample()), []);
});

test("flags invalid intervals and burst-rate samples", () => {
  assert.deepEqual(reviewStepSample(sample({
    steps: STEP_REVIEW_LIMITS.burstSteps + 1,
    endTime: new Date("2026-06-01T08:04:00Z"),
  })), ["burst_rate"]);
  assert.deepEqual(reviewStepSample(sample({
    startTime: new Date("2026-06-01T09:00:00Z"),
    endTime: new Date("2026-06-01T08:30:00Z"),
  })), ["invalid_interval"]);
});

test("flags implausible samples and stale backfills", () => {
  assert.deepEqual(reviewStepSample(sample({
    steps: STEP_REVIEW_LIMITS.maxSampleSteps + 1,
    recordedAt: new Date("2026-06-04T08:31:00Z"),
  })), ["implausible_sample_total", "backfilled_data"]);
});