import type { StridePoolHealthModule } from './types';

export type { HealthSource, NativeStepSample, PermissionState } from './types';

const unavailable: StridePoolHealthModule = {
  async requestPermissions() { return 'denied'; },
  async getPermissionStatus() { return 'denied'; },
  async readStepSamples() { return []; },
};

export default unavailable;