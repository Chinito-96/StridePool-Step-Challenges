export const REQUIRED_WEBHOOK_HEALTH_TABLES = [
  "public.stripe_webhook_health_baselines",
  "public.stripe_webhook_health_receipts",
  "public.stripe_webhook_health_alert_states",
];

/** Read-only preflight. Schema changes belong to development setup and the Publish flow. */
export async function assertWebhookHealthSchemaReady(
  findMissing: (tables: string[]) => Promise<string[]>,
): Promise<void> {
  const missing = await findMissing(REQUIRED_WEBHOOK_HEALTH_TABLES);
  if (missing.length) {
    throw new Error(
      `Database schema is out of date: missing ${missing.join(", ")}. Apply the current development schema with pnpm --filter @workspace/db run push, then publish the schema through the Publishing flow. Paid play remains closed; no startup migration was attempted.`,
    );
  }
}