import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAppleHealthSamples, normalizeHealthConnectSamples } from "./step-sources";

test("normalizes Apple Health records using their stable UUID", () => {
  const [normalized] = normalizeAppleHealthSamples([{
    uuid: "hk-uuid-1",
    startDate: "2026-09-16T08:00:00-04:00",
    endDate: "2026-09-16T08:30:00-04:00",
    count: 1_240,
    sourceName: "Apple Watch",
  }]);
  assert.equal(normalized?.sourceSampleId, "hk-uuid-1");
  assert.equal(normalized?.recordDate, "2026-09-16");
  assert.equal(normalized?.steps, 1_240);
  assert.equal(normalized?.startTime, "2026-09-16T12:00:00.000Z");
  assert.equal(normalized?.endTime, "2026-09-16T12:30:00.000Z");
  assert.match(normalized?.recordedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(normalized?.rawPayload, {
    source: "apple_health",
    uuid: "hk-uuid-1",
    startDate: "2026-09-16T08:00:00-04:00",
    endDate: "2026-09-16T08:30:00-04:00",
    count: 1_240,
    sourceName: "Apple Watch",
  });
});

test("normalizes Health Connect records and drops malformed intervals", () => {
  const normalized = normalizeHealthConnectSamples([
    {
      id: "hc-id-1",
      startTime: "2026-09-16T08:00:00Z",
      endTime: "2026-09-16T08:15:00Z",
      steps: 500,
    },
    {
      id: "hc-invalid",
      startTime: "2026-09-16T08:15:00Z",
      endTime: "2026-09-16T08:15:00Z",
      steps: 1,
    },
  ]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0]?.sourceSampleId, "hc-id-1");
  assert.equal(normalized[0]?.recordDate, "2026-09-16");
  assert.equal(normalized[0]?.steps, 500);
});