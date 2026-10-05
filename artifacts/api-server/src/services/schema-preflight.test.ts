import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertWebhookHealthDatabaseSchemaReady,
  assertWebhookHealthSchemaReady,
  REQUIRED_WEBHOOK_HEALTH_TABLES,
} from "./schema-preflight";

test("schema preflight allows a current schema", async () => {
  await assertWebhookHealthSchemaReady(async (tables) => {
    assert.deepEqual(tables, REQUIRED_WEBHOOK_HEALTH_TABLES);
    return [];
  });
});

test("missing webhook tables fail with an actionable, non-destructive correction", async () => {
  await assert.rejects(
    assertWebhookHealthSchemaReady(async () => ["public.stripe_webhook_health_baselines"]),
    /Database schema is out of date.*pnpm --filter @workspace\/db run push.*Publishing flow.*preflight:webhook-health-schema.*no startup migration/,
  );
});

test("database preflight checks all required tables through a read-only catalog query", async () => {
  let checkedTables: string[] = [];
  await assertWebhookHealthDatabaseSchemaReady(async (query, [tables]) => {
    assert.match(query, /to_regclass/);
    checkedTables = tables;
    return { rows: [] };
  });
  assert.deepEqual(checkedTables, REQUIRED_WEBHOOK_HEALTH_TABLES);
});

test("database preflight fails with the actionable error when the catalog reports missing tables", async () => {
  await assert.rejects(
    assertWebhookHealthDatabaseSchemaReady(async (_query, [tables]) => ({
      rows: tables.map((table_name) => ({ table_name })),
    })),
    /missing public\.stripe_webhook_health_baselines, public\.stripe_webhook_health_receipts, public\.stripe_webhook_health_alert_states/,
  );
});
