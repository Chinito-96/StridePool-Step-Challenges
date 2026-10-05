import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

const fixturePath = fileURLToPath(
  new URL("./stridepool-browser-harness-failure-fixture.test.ts", import.meta.url),
);
const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "stridepool-browser-harness-"));
after(() => rmSync(tempDirectory, { recursive: true, force: true }));

const scenarios = [
  {
    name: "missing Chromium",
    scenario: "missing-chromium",
    diagnostic: "Browser persistence validation requires Chromium.",
    shouldCloseBrowser: false,
  },
  {
    name: "API process exit",
    scenario: "api-exit",
    diagnostic: "Test server exited before serving http://127.0.0.1:40101/api/healthz (code 17",
    shouldCloseBrowser: true,
  },
  {
    name: "web process exit",
    scenario: "web-exit",
    diagnostic: "Test server exited before serving http://127.0.0.1:40103/ (code 23",
    shouldCloseBrowser: true,
  },
  {
    name: "browser assertion failure",
    scenario: "assertion-failure",
    diagnostic: "Injected browser assertion failure.",
    shouldCloseBrowser: true,
  },
] as const;

for (const { name, scenario, diagnostic, shouldCloseBrowser } of scenarios) {
  test(`failed browser check (${name}) exits nonzero and cleans its resources`, () => {
    const markerPath = path.join(tempDirectory, `${scenario}.json`);
    const childEnvironment: NodeJS.ProcessEnv = {
      ...process.env,
      STRIDEPOOL_BROWSER_FAILURE_SCENARIO: scenario,
      STRIDEPOOL_BROWSER_FAILURE_MARKER: markerPath,
    };
    // The parent test runner's worker marker makes a nested `node --test`
    // invocation skip its files unless it is removed from the child process.
    delete childEnvironment.NODE_TEST_CONTEXT;
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx/esm", "--test", "--test-reporter=spec", fixturePath],
      {
        cwd: process.cwd(),
        env: childEnvironment,
        encoding: "utf8",
        timeout: 15_000,
      },
    );

    assert.notEqual(
      result.status,
      0,
      `The injected ${name} was expected to fail.\n${result.stdout}\n${result.stderr}`,
    );
    assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(diagnostic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    const cleanupState = JSON.parse(readFileSync(markerPath, "utf8")) as {
      fixtureRows: string[];
      liveProcesses: number;
      browserClosed: boolean;
    };
    assert.deepEqual(cleanupState.fixtureRows, [], "Fixture rows must be removed after failure.");
    assert.equal(cleanupState.liveProcesses, 0, "No child process groups may remain live.");
    assert.equal(cleanupState.browserClosed, shouldCloseBrowser);
  });
}