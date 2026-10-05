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

/**
 * Durable support-alert state for the exact expected webhook URL. This stores
 * incident metadata only; it never changes provider readiness or endpoint
 * configuration.
 */
export const stripeWebhookHealthAlertStatesTable = pgTable(
  "stripe_webhook_health_alert_states",
  {
    endpointUrl: varchar("endpoint_url").primaryKey(),
    endpointId: varchar("endpoint_id"),
    observedStatus: varchar("observed_status").notNull().default("unknown"),
    consecutiveChecks: integer("consecutive_checks").notNull().default(0),
    observedSince: timestamp("observed_since", { withTimezone: true }),
    candidateIncidentId: varchar("candidate_incident_id"),
    activeStatus: varchar("active_status"),
    activeIncidentId: varchar("active_incident_id"),
    notificationClaimId: varchar("notification_claim_id"),
    notificationClaimType: varchar("notification_claim_type"),
    notificationClaimStatus: varchar("notification_claim_status"),
    notificationClaimIncidentId: varchar("notification_claim_incident_id"),
    notificationClaimedAt: timestamp("notification_claimed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export type StripeWebhookHealthAlertState =
  typeof stripeWebhookHealthAlertStatesTable.$inferSelect;
export const insertStripeWebhookHealthAlertStateSchema =
  createInsertSchema(stripeWebhookHealthAlertStatesTable);
export type InsertStripeWebhookHealthAlertState =
  z.infer<typeof insertStripeWebhookHealthAlertStateSchema>;