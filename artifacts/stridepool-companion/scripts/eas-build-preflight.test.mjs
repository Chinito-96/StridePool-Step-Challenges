import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateEasBuild } from './eas-build-preflight.mjs';
import { prepareNativeWorkspace } from './prepare-native-workspace.mjs';

test('requires a web backend hostname rather than a missing or malformed target', () => {
  for (const domain of [undefined, '', 'localhost', '127.0.0.1', 'api.localhost', 'api.local', 'api.internal', 'example.com ', 'https://example.com', 'example.com/path', 'example.com:443', 'user@example.com', 'example.com?key=x', 'preview.expo.kirk.replit.dev']) {
    assert.throws(() => validateEasBuild({ domain, platform: 'android', workspace: '' }), /EXPO_PUBLIC_DOMAIN/);
  }
  assert.doesNotThrow(() => validateEasBuild({ domain: 'stridepool-test.example.com', platform: 'android', workspace: '' }));
});

test('requires an explicit platform', () => {
  assert.throws(() => validateEasBuild({ domain: 'example.com', platform: undefined, workspace: '' }), /EAS_BUILD_PLATFORM/);
});

test('iPhone builds require a prepared workspace, Android can retain Linux exclusions', async () => {
  const workspace = await readFile(new URL('../../../pnpm-workspace.yaml', import.meta.url), 'utf8');
  const common = { domain: 'example.com', workspace };
  const hasMacExclusions = prepareNativeWorkspace(workspace.split('\n').filter((line) => line.includes('darwin')).join('\n') + '\n').removed > 0;
  if (hasMacExclusions) assert.throws(() => validateEasBuild({ ...common, platform: 'ios' }), /excludes macOS/);
  assert.doesNotThrow(() => validateEasBuild({ ...common, platform: 'android' }));
  assert.doesNotThrow(() => validateEasBuild({
    ...common, platform: 'ios', workspace: prepareNativeWorkspace(workspace).content,
  }));
});

test('the checked-in EAS profile produces internal real-device builds, not store submissions', async () => {
  const config = JSON.parse(await readFile(new URL('../eas.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(config.build), ['preview']);
  assert.equal(config.build.preview.distribution, 'internal');
  assert.equal(config.build.preview.environment, 'preview');
  assert.equal(config.build.preview.android.buildType, 'apk');
  assert.equal(config.build.preview.ios.simulator, false);
  assert.notEqual(config.build.preview.developmentClient, true);
  assert.equal(config.submit, undefined);
});

test('default upload ignores local secrets and generated projects but retains health-module source', () => {
  const excluded = [
    'artifacts/stridepool-companion/.env',
    'artifacts/stridepool-companion/credentials.json',
    'artifacts/stridepool-companion/signing.p12',
    'artifacts/stridepool-companion/AuthKey.p8',
    'artifacts/stridepool-companion/app.mobileprovision',
    'artifacts/stridepool-companion/release.keystore',
    'artifacts/stridepool-companion/google-service-account.json',
    'artifacts/stridepool-companion/ios/generated.xcodeproj',
    'artifacts/stridepool-companion/android/build.gradle',
  ];
  const cwd = new URL('../../../', import.meta.url);
  const result = spawnSync('git', ['check-ignore', '--no-index', ...excluded], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split('\n').sort(), excluded.sort());
  const retained = spawnSync('git', [
    'check-ignore', '--no-index',
    'artifacts/stridepool-companion/modules/stridepool-health/ios/StridePoolHealthModule.swift',
    'artifacts/stridepool-companion/modules/stridepool-health/android/build.gradle',
    'pnpm-workspace.yaml',
    'pnpm-lock.yaml',
    'lib/api-client-react/src/index.ts',
  ], { cwd, encoding: 'utf8' });
  assert.equal(retained.status, 1, retained.stderr);
  assert.equal(retained.stdout, '');
});