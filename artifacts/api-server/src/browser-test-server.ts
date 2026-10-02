// Serve the real routes without Stripe initialization or background payout jobs.
// This entry point is only used by the isolated browser regression.
import app from "./app";
import { pool } from "@workspace/db";

const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port <= 0) throw new Error("A valid test PORT is required.");

const server = app.listen(port, "127.0.0.1");
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    server.close(async () => {
      await pool.end();
    });
    server.closeAllConnections();
  });
}