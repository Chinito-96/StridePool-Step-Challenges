import assert from "node:assert/strict";
import { test } from "node:test";
import { assertWebhookHealthSchemaReady, REQUIRED_WEBHOOK_HEALTH_TABLES } from "./schema-preflight";

test("schema preflight allows a current schema", async () => {
  await assertWebhookHealthSchemaReady(async (tables) => {
    assert.deepEqual(tables, REQUIRED_WEBHOOK_HEALTH_TABLES);
    return [];
  });
});

test("missing webhook tables fail with an actionable, non-destructive correction", async () => {
  await assert.rejects(
    assertWebhookHealthSchemaReady(async () => ["public.stripe_webhook_health_baselines"]),
    /Database schema is out of date.*development schema.*Publishing flow.*no startup migration/,
  );
});