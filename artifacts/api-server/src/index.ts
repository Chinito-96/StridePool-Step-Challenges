import app from "./app";
import { logger } from "./lib/logger";
import { startPodiumCloseoutScheduler } from "./services/podium-closeout";
import { startStripeWebhookHealthScheduler } from "./services/stripe-webhook-health-monitor";
import { initializeStripeProvider } from "./services/stripe-provider";
import { pool } from "@workspace/db";
import { assertWebhookHealthDatabaseSchemaReady } from "./services/schema-preflight";

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

await assertWebhookHealthDatabaseSchemaReady((query, values) =>
  pool.query<{ table_name: string }>(query, values)
);
await initializeStripeProvider();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startPodiumCloseoutScheduler();
  startStripeWebhookHealthScheduler();
});
