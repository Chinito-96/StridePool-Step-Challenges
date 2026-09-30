import { requireOptionalNativeModule } from 'expo-modules-core';
import type { HealthSource, NativeStepSample, PermissionState, StridePoolHealthModule } from './types';

export type { HealthSource, NativeStepSample, PermissionState } from './types';
// Expo Go cannot contain local native modules. Keep its preview usable without
// silently claiming that HealthKit permission was denied.
const nativeModule = requireOptionalNativeModule<StridePoolHealthModule>('StridePoolHealth');
const unavailable: StridePoolHealthModule = {
  async requestPermissions() { throw new Error('HealthKit requires an installed StridePool development or release build; it is unavailable in Expo Go.'); },
  async getPermissionStatus() { throw new Error('HealthKit is unavailable in Expo Go.'); },
  async readStepSamples() { throw new Error('HealthKit is unavailable in Expo Go.'); },
};

export default nativeModule ?? unavailable;