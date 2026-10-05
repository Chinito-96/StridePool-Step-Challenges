import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareNativeWorkspace } from './prepare-native-workspace.mjs';

export function validateEasBuild({ domain, platform, workspace }) {
  const hostname = typeof domain === 'string' ? domain.trim() : '';
  const label = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
  const hostnamePattern = new RegExp(`^${label}(?:\\.${label})+$`, 'i');
  if (!hostnamePattern.test(hostname) || hostname.length > 253 || domain !== hostname || isIP(hostname)
    || /\.(?:localhost|local|internal|test)$/i.test(hostname)
    || hostname.toLowerCase().endsWith('.expo.kirk.replit.dev')) {
    throw new Error('Set EXPO_PUBLIC_DOMAIN to the StridePool web/API hostname in the EAS preview environment. Do not include a scheme, path, port, credentials, or the Expo/Metro hostname.');
  }
  if (!['android', 'ios'].includes(platform)) {
    throw new Error('EAS_BUILD_PLATFORM must identify android or ios.');
  }
  if (platform === 'ios') {
    const macExclusions = workspace.split('\n').filter((line) => line.includes('darwin')).join('\n') + '\n';
    if (prepareNativeWorkspace(macExclusions).removed > 0) {
      throw new Error('The upload still excludes macOS build binaries. Run prepare-native-workspace.mjs --write in the external checkout, then pnpm install --no-frozen-lockfile at the repository root before uploading to EAS.');
    }
  }
}

async function main() {
  const workspace = await readFile(new URL('../../../pnpm-workspace.yaml', import.meta.url), 'utf8');
  validateEasBuild({
    domain: process.env.EXPO_PUBLIC_DOMAIN,
    platform: process.env.EAS_BUILD_PLATFORM,
    workspace,
  });
  console.info('EAS native build preflight passed. This does not establish device or launch readiness.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}