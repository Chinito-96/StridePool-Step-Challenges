import type { ChildProcess } from "node:child_process";

type Cleanup = () => void | Promise<void>;

export class CleanupStack {
  private callbacks: Cleanup[] = [];
  private closed = false;

  defer(callback: Cleanup): void {
    if (this.closed) {
      throw new Error("Cannot register cleanup after the browser test harness is closed.");
    }
    this.callbacks.push(callback);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    const errors: unknown[] = [];
    for (const callback of this.callbacks.reverse()) {
      try {
        await callback();
      } catch (error) {
        errors.push(error);
      }
    }
    this.callbacks = [];

    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, "One or more browser test cleanup steps failed.");
    }
  }
}

export async function initializeWithCleanup<T>(
  setup: (cleanup: CleanupStack) => Promise<T>,
): Promise<{ value: T; cleanup: CleanupStack }> {
  const cleanup = new CleanupStack();
  try {
    return { value: await setup(cleanup), cleanup };
  } catch (error) {
    try {
      await cleanup.close();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Browser test setup failed and cleanup also reported an error.",
      );
    }
    throw error;
  }
}

export async function launchRequiredChromium<T>(launch: () => Promise<T>): Promise<T> {
  try {
    return await launch();
  } catch (cause) {
    throw new Error(
      "Browser persistence validation requires Chromium. Set CHROMIUM_PATH or run pnpm --filter @workspace/scripts exec playwright install --with-deps chromium.",
      { cause },
    );
  }
}

type ProcessHandle = Pick<ChildProcess, "pid" | "exitCode" | "signalCode" | "once" | "kill">;

interface StopProcessOptions {
  platform?: NodeJS.Platform;
  timeoutMs?: number;
  signalGroup?: (pid: number, signal: NodeJS.Signals) => void;
  groupExists?: (pid: number) => boolean;
  sleep?: (ms: number) => Promise<void>;
}

function hasExited(processHandle: ProcessHandle): boolean {
  return processHandle.exitCode !== null || processHandle.signalCode !== null;
}

function waitForProcessExit(processHandle: ProcessHandle, timeoutMs: number): Promise<boolean> {
  if (hasExited(processHandle)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      resolve(false);
    }, timeoutMs);
    processHandle.once("exit", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(true);
    });
  });
}

function defaultSignalGroup(pid: number, signal: NodeJS.Signals): void {
  process.kill(-pid, signal);
}

function defaultGroupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function stopProcess(
  processHandle: ProcessHandle | undefined,
  options: StopProcessOptions = {},
): Promise<void> {
  if (!processHandle) return;

  const {
    platform = process.platform,
    timeoutMs = 5_000,
    signalGroup = defaultSignalGroup,
    groupExists = defaultGroupExists,
    sleep: pause = sleep,
  } = options;
  const processGroup = platform === "win32" ? undefined : processHandle.pid;
  let groupSignaled = false;

  const sendSignal = (signal: NodeJS.Signals) => {
    if (processGroup) {
      try {
        signalGroup(processGroup, signal);
        groupSignaled = true;
        return;
      } catch {
        // The process group may already have exited; fall back to the child.
      }
    }
    if (!hasExited(processHandle)) processHandle.kill(signal);
  };

  sendSignal("SIGTERM");
  if (!hasExited(processHandle)) await waitForProcessExit(processHandle, timeoutMs);

  if (processGroup && groupSignaled && groupExists(processGroup)) {
    const deadline = Date.now() + timeoutMs;
    while (groupExists(processGroup) && Date.now() < deadline) {
      await pause(50);
    }
    if (groupExists(processGroup)) {
      sendSignal("SIGKILL");
    }
  }

  if (!hasExited(processHandle)) {
    sendSignal("SIGKILL");
  }
}

interface HttpProcessHandle {
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
}

interface WaitForHttpOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export async function waitForHttp(
  url: string,
  processHandle: HttpProcessHandle,
  options: WaitForHttpOptions = {},
): Promise<void> {
  const {
    fetch: fetchUrl = fetch,
    timeoutMs = 60_000,
    sleep: pause = sleep,
  } = options;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null || processHandle.signalCode !== null) {
      throw new Error(
        `Test server exited before serving ${url} (code ${processHandle.exitCode}, signal ${processHandle.signalCode}).`,
      );
    }
    try {
      const response = await fetchUrl(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await pause(250);
  }
  throw new Error(`Timed out waiting for ${url}: ${String(lastError)}`);
}