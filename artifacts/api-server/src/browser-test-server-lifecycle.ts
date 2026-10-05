import type { Server } from "node:http";

interface ServerPool {
  end(): Promise<void>;
}

interface SignalSource {
  once(signal: NodeJS.Signals, listener: () => void): unknown;
  exitCode?: string | number | null;
}

export function registerBrowserTestServerShutdown(
  server: Pick<Server, "close" | "closeAllConnections">,
  pool: ServerPool,
  signalSource: SignalSource = process,
): () => void {
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;

    server.close((closeError) => {
      void (async () => {
        try {
          await pool.end();
        } catch (error) {
          console.error("Browser test API database pool failed to close.", error);
          signalSource.exitCode = 1;
        }
        if (closeError) {
          console.error("Browser test API server failed to close.", closeError);
          signalSource.exitCode = 1;
        }
      })();
    });
    server.closeAllConnections();
  };

  signalSource.once("SIGTERM", shutdown);
  signalSource.once("SIGINT", shutdown);
  return shutdown;
}