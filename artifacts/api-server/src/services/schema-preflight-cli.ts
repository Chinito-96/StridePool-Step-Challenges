import { pool } from "@workspace/db";
import { assertWebhookHealthDatabaseSchemaReady } from "./schema-preflight";

try {
  await assertWebhookHealthDatabaseSchemaReady((query, values) =>
    pool.query<{ table_name: string }>(query, values)
  );
  console.info("Stripe webhook-health schema is ready.");
} finally {
  await pool.end();
}