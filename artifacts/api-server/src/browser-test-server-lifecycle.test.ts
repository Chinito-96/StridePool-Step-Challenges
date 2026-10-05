import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { Server } from "node:http";
import { registerBrowserTestServerShutdown } from "./browser-test-server-lifecycle";

function createSignalSource() {
  const emitter = new EventEmitter() as EventEmitter & { exitCode?: number };
  return {
    source: emitter,
    emit(signal: NodeJS.Signals) {
      emitter.emit(signal);
    },
    get exitCode() {
      return emitter.exitCode;
    },
  };
}

test("browser test API shutdown closes connections and the database pool once", async () => {
  const signals = createSignalSource();
  let closeCalls = 0;
  let connectionCloseCalls = 0;
  let poolCloseCalls = 0;
  const server = {
    close(callback: (error?: Error) => void) {
      closeCalls += 1;
      callback();
    },
    closeAllConnections() {
      connectionCloseCalls += 1;
    },
  } as unknown as Server;

  registerBrowserTestServerShutdown(server, {
    async end() {
      poolCloseCalls += 1;
    },
  }, signals.source);

  signals.emit("SIGTERM");
  signals.emit("SIGINT");
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(closeCalls, 1);
  assert.equal(connectionCloseCalls, 1);
  assert.equal(poolCloseCalls, 1);
  assert.equal(signals.exitCode, undefined);
});

test("browser test API shutdown reports a database pool close failure", async () => {
  const signals = createSignalSource();
  const server = {
    close(callback: (error?: Error) => void) {
      callback();
    },
    closeAllConnections() {},
  } as unknown as Server;
  const originalError = console.error;
  const diagnostics: unknown[][] = [];
  console.error = (...args: unknown[]) => diagnostics.push(args);

  try {
    registerBrowserTestServerShutdown(server, {
      async end() {
        throw new Error("Injected pool close failure.");
      },
    }, signals.source);
    signals.emit("SIGTERM");
    await new Promise<void>((resolve) => setImmediate(resolve));
  } finally {
    console.error = originalError;
  }

  assert.equal(signals.exitCode, 1);
  assert.match(String(diagnostics[0]?.[0]), /database pool failed to close/);
  assert.match(String(diagnostics[0]?.[1]), /Injected pool close failure/);
});