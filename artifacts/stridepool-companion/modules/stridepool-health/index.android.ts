import type { readRecords } from 'react-native-health-connect';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import type { HealthSource, NativeStepSample, PermissionState, StridePoolHealthModule } from './types';

export type { HealthSource, NativeStepSample, PermissionState } from './types';

const stepPermission = { accessType: 'read', recordType: 'Steps' } as const;
const backgroundPermission = { accessType: 'read', recordType: 'BackgroundAccessPermission' } as const;

async function healthConnect() {
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    throw new Error('Health Connect requires an installed StridePool development or release build; it is unavailable in Expo Go.');
  }
  // Defer native-module evaluation so Expo Go can load the companion preview.
  return import('react-native-health-connect');
}

async function available() {
  return (await healthConnect()).initialize();
}

async function isGranted() {
  if (!await available()) return false;
  const permissions = await (await healthConnect()).getGrantedPermissions();
  return permissions.some((permission) =>
    permission.accessType === stepPermission.accessType &&
    permission.recordType === stepPermission.recordType
  );
}

const module: StridePoolHealthModule = {
  async requestPermissions(source): Promise<PermissionState> {
    if (source !== 'health_connect' || !await available()) return 'denied';
    const granted = await (await healthConnect()).requestPermission([stepPermission, backgroundPermission]);
    return granted.some((permission) => permission.accessType === 'read' && permission.recordType === 'Steps')
      ? 'connected'
      : 'denied';
  },
  async getPermissionStatus(source): Promise<PermissionState> {
    if (source !== 'health_connect' || !await available()) return 'denied';
    return await isGranted() ? 'connected' : 'revoked';
  },
  async readStepSamples(source, since): Promise<NativeStepSample[]> {
    if (source !== 'health_connect' || !await isGranted()) return [];
    const startTime = since ?? new Date(Date.now() - 172800000).toISOString();
    const records: Awaited<ReturnType<typeof readRecords<'Steps'>>>['records'] = [];
    let pageToken: string | undefined;
    do {
      const response = await (await healthConnect()).readRecords('Steps', {
        timeRangeFilter: {
          operator: 'between',
          startTime,
          endTime: new Date().toISOString(),
        },
        pageSize: 500,
        ascendingOrder: true,
        pageToken,
      });
      records.push(...response.records);
      pageToken = response.pageToken;
    } while (pageToken);
    return records.map((record) => {
      const stableId = record.metadata?.id ?? [
        'health-connect',
        record.metadata?.dataOrigin ?? 'unknown',
        record.metadata?.lastModifiedTime ?? 'unknown',
        record.startTime,
        record.endTime,
        String(record.count),
      ].join('-');
      const localStart = new Date(record.startTime);
      const recordDate = [
        String(localStart.getFullYear()).padStart(4, '0'),
        String(localStart.getMonth() + 1).padStart(2, '0'),
        String(localStart.getDate()).padStart(2, '0'),
      ].join('-');
      return ({
      sourceSampleId: stableId,
      recordDate,
      steps: record.count,
      startTime: record.startTime,
      endTime: record.endTime,
      rawPayload: {
        platform: 'health_connect',
        id: stableId,
        dataOrigin: record.metadata?.dataOrigin ?? 'unknown',
      },
    })});
  },
};

export default module;