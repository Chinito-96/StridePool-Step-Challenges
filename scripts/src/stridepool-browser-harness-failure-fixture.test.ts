import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { test } from "node:test";
import type { ChildProcess } from "node:child_process";
import {
  initializeWithCleanup,
  launchRequiredChromium,
  stopProcess,
  waitForHttp,
} from "./stridepool-browser-harness";

interface StubProcessState {
  pid: number;
  live: boolean;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  listeners: Array<() => void>;
}

function createStubProcess(
  pid: number,
  initialExitCode: number | null,
  state: StubProcessState[],
  groupHasLiveChild = initialExitCode === null,
): { handle: ChildProcess; state: StubProcessState } {
  const processState: StubProcessState = {
    pid,
    // An exited package-manager wrapper may still have a server process in its
    // process group. Keep that group live to verify cleanup does not return early.
    live: groupHasLiveChild,
    exitCode: initialExitCode,
    signalCode: null,
    listeners: [],
  };
  state.push(processState);
  const handle = {
    pid,
    get exitCode() {
      return processState.exitCode;
    },
    get signalCode() {
      return processState.signalCode;
    },
    once(_event: string, listener: () => void) {
      processState.listeners.push(listener);
      return handle;
    },
    kill(signal: NodeJS.Signals) {
      processState.live = false;
      processState.signalCode = signal;
      processState.listeners.splice(0).forEach((listener) => listener());
      return true;
    },
  } as unknown as ChildProcess;
  return { handle, state: processState };
}

const scenario = process.env.STRIDEPOOL_BROWSER_FAILURE_SCENARIO;
const markerPath = process.env.STRIDEPOOL_BROWSER_FAILURE_MARKER;

test(`injected browser harness failure: ${scenario ?? "missing scenario"}`, async (t) => {
  assert.ok(scenario, "A failure scenario must be selected.");
  assert.ok(markerPath, "A cleanup marker path must be provided.");

  const fixtureRows = new Set<string>();
  const processes: StubProcessState[] = [];
  let browserClosed = false;
  let cleanup: Awaited<ReturnType<typeof initializeWithCleanup>>["cleanup"] | undefined;

  t.after(async () => {
    try {
      await cleanup?.close();
    } finally {
      writeFileSync(markerPath!, JSON.stringify({
        fixtureRows: [...fixtureRows],
        liveProcesses: processes.filter((entry) => entry.live).length,
        browserClosed,
      }));
    }
  });

  const initialized = await initializeWithCleanup(async (resources) => {
    resources.defer(() => fixtureRows.clear());

    const browser = await launchRequiredChromium(async () => {
      if (scenario === "missing-chromium") {
        throw new Error("Injected missing Chromium executable.");
      }
      return { close: async () => { browserClosed = true; } };
    });
    resources.defer(() => browser.close());

    if (scenario !== "missing-chromium") {
      fixtureRows.add("disposable-browser-fixture");
    }

    if (scenario === "api-exit") {
      const api = createStubProcess(31_101, 17, processes, true);
      resources.defer(() => stopProcess(api.handle, {
        platform: "linux",
        signalGroup: (_pid, signal) => {
          if (signal === "SIGTERM" || signal === "SIGKILL") api.state.live = false;
        },
        groupExists: () => api.state.live,
        sleep: async () => {},
      }));
      await waitForHttp("http://127.0.0.1:40101/api/healthz", api.handle);
    } else if (scenario === "web-exit" || scenario === "assertion-failure") {
      const api = createStubProcess(31_102, null, processes);
      resources.defer(() => stopProcess(api.handle, {
        platform: "linux",
        signalGroup: (_pid, signal) => {
          api.state.live = false;
          api.state.exitCode = signal === "SIGTERM" ? 0 : 137;
          api.state.listeners.splice(0).forEach((listener) => listener());
        },
        groupExists: () => api.state.live,
        sleep: async () => {},
      }));
      await waitForHttp("http://127.0.0.1:40102/api/healthz", api.handle, {
        fetch: async () => new Response("ok", { status: 200 }),
      });

      if (scenario === "web-exit") {
        const web = createStubProcess(31_103, 23, processes, true);
        resources.defer(() => stopProcess(web.handle, {
          platform: "linux",
          signalGroup: (_pid, signal) => {
            if (signal === "SIGTERM" || signal === "SIGKILL") web.state.live = false;
          },
          groupExists: () => web.state.live,
          sleep: async () => {},
        }));
        await waitForHttp("http://127.0.0.1:40103/", web.handle);
      }
    } else {
      throw new Error(`Unknown browser harness failure scenario: ${scenario}`);
    }
    return browser;
  });
  cleanup = initialized.cleanup;

  if (scenario === "assertion-failure") {
    assert.fail("Injected browser assertion failure.");
  }
});