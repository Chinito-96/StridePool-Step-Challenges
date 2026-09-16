export type StepSourceId = "apple_health" | "health_connect";

export type NormalizedStepSample = {
  sourceSampleId: string;
  recordDate: string;
  steps: number;
  startTime: string;
  endTime: string;
  recordedAt: string;
  rawPayload: Record<string, unknown>;
};

export type NativePermissionStatus = "connected" | "denied" | "revoked";
export type NativeHealthSample = {
  sourceSampleId?: string;
  id?: string;
  uuid?: string;
  recordDate?: string;
  startTime?: string;
  endTime?: string;
  startDate?: string;
  endDate?: string;
  steps?: number;
  count?: number;
  rawPayload?: Record<string, unknown>;
  [key: string]: unknown;
};

export type NativeHealthBridge = {
  requestPermissions: (source: "apple_health" | "health_connect") => Promise<NativePermissionStatus>;
  getPermissionStatus?: (source: "apple_health" | "health_connect") => Promise<NativePermissionStatus>;
  readStepSamples: (source: "apple_health" | "health_connect", since?: string) => Promise<NativeHealthSample[]>;
  openSettings?: (source: "apple_health" | "health_connect") => Promise<void>;
};

declare global {
  interface Window {
    StridePoolHealth?: NativeHealthBridge;
  }
}

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

function normalizeNativeSample(sample: NativeHealthSample, source: "apple_health" | "health_connect", index: number): NormalizedStepSample | null {
  const startTime = sample.startTime ?? sample.startDate;
  const endTime = sample.endTime ?? sample.endDate;
  const steps = sample.steps ?? sample.count;
  if (!startTime || !endTime || typeof steps !== "number" || !Number.isInteger(steps) || steps < 0) return null;
  const start = new Date(startTime);
  const end = new Date(endTime);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return null;
  const recordDate = sample.recordDate && /^\d{4}-\d{2}-\d{2}$/.test(sample.recordDate)
    ? sample.recordDate
    : dateOnly(startTime);
  return {
    sourceSampleId: sample.sourceSampleId ?? sample.uuid ?? sample.id ?? `${source}-${start.toISOString()}-${end.toISOString()}-${index}`,
    recordDate,
    steps,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    recordedAt: new Date().toISOString(),
    rawPayload: sample.rawPayload ?? { source, ...sample },
  };
}

export function normalizeAppleHealthSamples(samples: NativeHealthSample[]): NormalizedStepSample[] {
  return samples.flatMap((sample, index) => {
    const normalized = normalizeNativeSample(sample, "apple_health", index);
    return normalized ? [normalized] : [];
  });
}

export function normalizeHealthConnectSamples(samples: NativeHealthSample[]): NormalizedStepSample[] {
  return samples.flatMap((sample, index) => {
    const normalized = normalizeNativeSample(sample, "health_connect", index);
    return normalized ? [normalized] : [];
  });
}
