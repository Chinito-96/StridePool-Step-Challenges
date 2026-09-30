export type HealthSource = 'apple_health' | 'health_connect';
export type PermissionState = 'connected' | 'denied' | 'revoked';
export type NativeStepSample = {
  sourceSampleId: string;
  recordDate: string;
  steps: number;
  startTime: string;
  endTime: string;
  rawPayload: Record<string, unknown>;
};

export type StridePoolHealthModule = {
  requestPermissions(source: HealthSource): Promise<PermissionState>;
  getPermissionStatus(source: HealthSource): Promise<PermissionState>;
  readStepSamples(source: HealthSource, since?: string): Promise<NativeStepSample[]>;
};