export const REQUIRED_WEBHOOK_HEALTH_TABLES = [
  "public.stripe_webhook_health_baselines",
  "public.stripe_webhook_health_receipts",
  "public.stripe_webhook_health_alert_states",
];

const findMissingTablesQuery =
  "SELECT table_name FROM unnest($1::text[]) AS required(table_name) WHERE to_regclass(table_name) IS NULL";

type TableCatalogQuery = (
  query: string,
  values: [string[]],
) => Promise<{ rows: Array<{ table_name: string }> }>;

/** Read-only preflight. Schema changes belong to development setup and the Publish flow. */
export async function assertWebhookHealthSchemaReady(
  findMissing: (tables: string[]) => Promise<string[]>,
): Promise<void> {
  const missing = await findMissing(REQUIRED_WEBHOOK_HEALTH_TABLES);
  if (missing.length) {
    throw new Error(
      `Database schema is out of date: missing ${missing.join(", ")}. Run pnpm --filter @workspace/db run push against the development database, then use the Publishing flow to apply that schema to production. Verify with pnpm --filter @workspace/api-server run preflight:webhook-health-schema. Paid play remains closed; no startup migration was attempted.`,
    );
  }
}

/** Query the catalog without changing the schema, then fail if any table is absent. */
export async function assertWebhookHealthDatabaseSchemaReady(
  query: TableCatalogQuery,
): Promise<void> {
  await assertWebhookHealthSchemaReady(async (tables) => {
    const result = await query(findMissingTablesQuery, [tables]);
    return result.rows.map((row) => row.table_name);
  });
}
