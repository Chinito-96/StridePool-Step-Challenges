import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Replit's workspace excludes optional macOS/Windows binaries for Linux.
// Allow only those platform binaries in an external native-build checkout.
export function prepareNativeWorkspace(source) {
  let removed = 0;
  const binaryExclusion = /^[ \t]+"(?:esbuild>@esbuild\/|lightningcss>lightningcss-|@tailwindcss\/oxide>@tailwindcss\/oxide-|rollup>@rollup\/rollup-|@expo\/ngrok-bin>@expo\/ngrok-bin-)(?:darwin|win32)[^"]*":[ \t]*"-"[ \t]*\r?\n/gm;
  let content = source.replace(binaryExclusion, () => {
    removed += 1;
    return '';
  });
  if (removed > 0) {
    content = content.replace(
      '# replit uses linux-x64 only, we can exclude all other platforms',
      '# Keep macOS/Windows binaries available for external native builds',
    );
  }
  return { content, removed };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--write' && arg !== '--check')) {
    throw new Error('Usage: node scripts/prepare-native-workspace.mjs [--check | --write]');
  }
  if (args.includes('--write') && args.includes('--check')) {
    throw new Error('Choose either --check or --write.');
  }
  if (args.includes('--write') && process.env.REPL_ID) {
    throw new Error('Run --write only in your external build checkout, not in Replit.');
  }

  const workspacePath = new URL('../../../pnpm-workspace.yaml', import.meta.url);
  const result = prepareNativeWorkspace(await readFile(workspacePath, 'utf8'));
  if (!args.includes('--write')) {
    console.info(`${result.removed} macOS/Windows binary exclusions found. No files changed.`);
    console.info('In your external checkout, use --write before installing dependencies.');
    return;
  }
  if (result.removed === 0) {
    console.info('Native build platforms are already enabled. No files changed.');
    return;
  }
  await writeFile(workspacePath, result.content);
  console.info(`Removed ${result.removed} platform exclusions from the local workspace config.`);
  console.info('Security version overrides and the minimum release age are unchanged.');
  console.info('From the repository root, run pnpm install --no-frozen-lockfile.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}