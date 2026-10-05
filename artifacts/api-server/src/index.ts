import app from "./app";
import { logger } from "./lib/logger";
import { startPodiumCloseoutScheduler } from "./services/podium-closeout";
import { initializeStripeProvider } from "./services/stripe-provider";
import { pool } from "@workspace/db";
import { assertWebhookHealthSchemaReady } from "./services/schema-preflight";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

await assertWebhookHealthSchemaReady(async (tables) => {
  const result = await pool.query<{ table_name: string }>(
    "SELECT table_name FROM unnest($1::text[]) AS required(table_name) WHERE to_regclass(table_name) IS NULL",
    [tables],
  );
  return result.rows.map((row) => row.table_name);
});
await initializeStripeProvider();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startPodiumCloseoutScheduler();
});
