import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { prepareNativeWorkspace } from './prepare-native-workspace.mjs';

test('enables macOS/Windows binaries without weakening security overrides', () => {
  const source = [
    'minimumReleaseAge: 1440',
    'overrides:',
    '  "esbuild>@esbuild/darwin-arm64": "-"',
    '  "esbuild>@esbuild/win32-x64": "-"',
    '  "@expo/ngrok-bin>@expo/ngrok-bin-darwin-arm64": "-"',
    '  "lightningcss>lightningcss-darwin-arm64": "-"',
    '  "@tailwindcss/oxide>@tailwindcss/oxide-win32-x64-msvc": "-"',
    '  "rollup>@rollup/rollup-darwin-arm64": "-"',
    '  "esbuild>@esbuild/freebsd-x64": "-"',
    '  esbuild: "0.28.2"',
    '  qs: "6.16.0"',
    '',
  ].join('\n');
  const result = prepareNativeWorkspace(source);
  assert.equal(result.removed, 6);
  assert.equal(result.content, [
    'minimumReleaseAge: 1440',
    'overrides:',
    '  "esbuild>@esbuild/freebsd-x64": "-"',
    '  esbuild: "0.28.2"',
    '  qs: "6.16.0"',
    '',
  ].join('\n'));
});

test('preparation is idempotent and supports Windows line endings', () => {
  const source = 'overrides:\r\n  "esbuild>@esbuild/darwin-x64": "-"\r\n  esbuild: "0.28.2"\r\n';
  const first = prepareNativeWorkspace(source);
  assert.equal(first.removed, 1);
  assert.equal(first.content, 'overrides:\r\n  esbuild: "0.28.2"\r\n');
  assert.deepEqual(prepareNativeWorkspace(first.content), { content: first.content, removed: 0 });
});

test('the real workspace preserves all non-platform-exclusion settings', async () => {
  const source = await readFile(new URL('../../../pnpm-workspace.yaml', import.meta.url), 'utf8');
  const result = prepareNativeWorkspace(source);
  const binaryFamilies = ['"esbuild>@esbuild/', '"lightningcss>lightningcss-', '"@tailwindcss/oxide>@tailwindcss/oxide-', '"rollup>@rollup/', '"@expo/ngrok-bin>@expo/ngrok-bin-'];
  const exclusions = source.split('\n').filter((line) =>
    binaryFamilies.some((prefix) => line.trim().startsWith(prefix))
    && /darwin|win32/.test(line)
    && /":\s*"-"\s*$/.test(line));
  assert.equal(result.removed, exclusions.length);
  for (const line of exclusions) assert.ok(!result.content.split('\n').includes(line));
  for (const line of source.split('\n')) {
    if (exclusions.includes(line)) continue;
    if (line.includes('# replit uses linux-x64 only')) continue;
    assert.ok(result.content.split('\n').includes(line), `Unexpectedly changed setting: ${line}`);
  }
});

test('write mode refuses to change a Replit workspace', async () => {
  const workspacePath = new URL('../../../pnpm-workspace.yaml', import.meta.url);
  const before = await readFile(workspacePath, 'utf8');
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./prepare-native-workspace.mjs', import.meta.url)), '--write'],
    { env: { ...process.env, REPL_ID: 'native-build-guard-test' }, encoding: 'utf8' },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /external build checkout, not in Replit/);
  assert.equal(await readFile(workspacePath, 'utf8'), before);
});