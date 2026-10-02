import { createInsertSchema } from "drizzle-zod";
import { boolean, index, integer, pgTable, primaryKey, timestamp, varchar } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const stripeWebhookHealthBaselinesTable = pgTable(
  "stripe_webhook_health_baselines",
  {
    endpointId: varchar("endpoint_id").notNull(),
    endpointUrl: varchar("endpoint_url").notNull(),
    monitoringStartedAt: timestamp("monitoring_started_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "stripe_webhook_health_baselines_pk",
      columns: [table.endpointId, table.endpointUrl],
    }),
    index("stripe_webhook_health_baselines_started_idx").on(table.monitoringStartedAt),
  ],
);

export type StripeWebhookHealthBaseline =
  typeof stripeWebhookHealthBaselinesTable.$inferSelect;
export const insertStripeWebhookHealthBaselineSchema =
  createInsertSchema(stripeWebhookHealthBaselinesTable);
export type InsertStripeWebhookHealthBaseline =
  z.infer<typeof insertStripeWebhookHealthBaselineSchema>;

/**
 * Minimal durable receipt for each verified delivery attempt. Event payloads
 * and signing secrets are deliberately not retained here.
 */
export const stripeWebhookHealthReceiptsTable = pgTable(
  "stripe_webhook_health_receipts",
  {
    receiptKey: varchar("receipt_key").primaryKey(),
    eventId: varchar("event_id").notNull(),
    endpointId: varchar("endpoint_id"),
    endpointUrl: varchar("endpoint_url"),
    eventType: varchar("event_type").notNull(),
    eventCreatedAt: timestamp("event_created_at", { withTimezone: true }).notNull(),
    livemode: boolean("livemode").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    successfulAt: timestamp("successful_at", { withTimezone: true }),
    processingSucceeded: boolean("processing_succeeded").notNull().default(false),
    failedAttemptCount: integer("failed_attempt_count").notNull().default(0),
    lastFailedAt: timestamp("last_failed_at", { withTimezone: true }),
  },
  (table) => [
    index("stripe_webhook_health_endpoint_event_idx").on(
      table.endpointId,
      table.eventCreatedAt,
    ),
    index("stripe_webhook_health_endpoint_event_id_idx").on(
      table.endpointId,
      table.eventId,
    ),
    index("stripe_webhook_health_endpoint_received_idx").on(
      table.endpointId,
      table.receivedAt,
    ),
    index("stripe_webhook_health_url_event_idx").on(
      table.endpointUrl,
      table.eventCreatedAt,
    ),
  ],
);

export type StripeWebhookHealthReceipt =
  typeof stripeWebhookHealthReceiptsTable.$inferSelect;
export const insertStripeWebhookHealthReceiptSchema =
  createInsertSchema(stripeWebhookHealthReceiptsTable);
export type InsertStripeWebhookHealthReceipt =
  z.infer<typeof insertStripeWebhookHealthReceiptSchema>;