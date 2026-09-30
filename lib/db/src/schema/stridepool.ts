import { createInsertSchema } from "drizzle-zod";
import { date, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, varchar, boolean, numeric } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { usersTable } from "./auth";

export const groupsTable = pgTable(
  "stridepool_groups",
  {
    id: varchar("id").primaryKey(),
    name: text("name").notNull(),
    ownerUserId: varchar("owner_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("stridepool_groups_owner_idx").on(table.ownerUserId, table.createdAt),
  ],
);

export const groupMembersTable = pgTable(
  "stridepool_group_members",
  {
    id: serial("id").primaryKey(),
    groupId: varchar("group_id").notNull().references(() => groupsTable.id, { onDelete: "cascade" }),
    userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("stridepool_group_members_unique").on(table.groupId, table.userId),
    index("stridepool_group_members_user_idx").on(table.userId, table.joinedAt),
  ],
);

export const challengesTable = pgTable("challenges", {
  id: varchar("id").primaryKey(),
  name: text("name").notNull(),
  theme: text("theme").notNull(),
  level: varchar("level").notNull(),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  days: integer("days").notNull(),
  dailyGoal: integer("daily_goal").notNull(),
  entryFee: numeric("entry_fee", { precision: 12, scale: 2 }).notNull().default("0"),
  prizePool: numeric("prize_pool", { precision: 12, scale: 2 }).notNull().default("0"),
  participantCount: integer("participant_count").notNull().default(0),
  finishers: integer("finishers").notNull().default(0),
  settlementStatus: varchar("settlement_status").notNull().default("open"),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  settledPool: numeric("settled_pool", { precision: 12, scale: 2 }),
  color: varchar("color").notNull(),
  challengeType: varchar("challenge_type").notNull().default("goal"),
  goalType: varchar("goal_type").notNull().default("fixed"),
  community: boolean("community").notNull().default(false),
  groupId: varchar("group_id").references(() => groupsTable.id, { onDelete: "set null" }),
  creatorUserId: varchar("creator_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  graceDays: integer("grace_days").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const entriesTable = pgTable(
  "entries",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    challengeId: varchar("challenge_id").notNull().references(() => challengesTable.id, { onDelete: "cascade" }),
    status: varchar("status").notNull().default("active"),
    entryFee: numeric("entry_fee", { precision: 12, scale: 2 }).notNull().default("0"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true }),
    // Future real-payment fields: do not treat these as payment processing yet.
    paymentProvider: varchar("payment_provider"),
    paymentReference: varchar("payment_reference"),
    settlementStatus: varchar("settlement_status"),
    settlementAmount: numeric("settlement_amount", { precision: 12, scale: 2 }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("entries_user_challenge_unique").on(table.userId, table.challengeId),
    index("entries_user_idx").on(table.userId),
    index("entries_challenge_idx").on(table.challengeId),
  ],
);

export const dailyStepRecordsTable = pgTable(
  "daily_step_records",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    challengeId: varchar("challenge_id").references(() => challengesTable.id, { onDelete: "set null" }),
    recordDate: date("record_date", { mode: "string" }).notNull(),
    steps: integer("steps").notNull().default(0),
    source: varchar("source").notNull().default("demo"),
    verified: boolean("verified").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("daily_step_records_user_challenge_date_unique").on(table.userId, table.challengeId, table.recordDate),
    index("daily_step_records_user_idx").on(table.userId),
  ],
);

export const healthSourceConnectionsTable = pgTable(
  "health_source_connections",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    source: varchar("source").notNull(),
    status: varchar("status").notNull().default("connected"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("health_source_connections_user_source_unique").on(table.userId, table.source),
    index("health_source_connections_user_idx").on(table.userId),
  ],
);

export const stepSourceSamplesTable = pgTable(
  "step_source_samples",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    source: varchar("source").notNull(),
    sourceSampleId: varchar("source_sample_id").notNull(),
    recordDate: date("record_date", { mode: "string" }).notNull(),
    steps: integer("steps").notNull(),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }),
    rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>().notNull().default({}),
    verificationStatus: varchar("verification_status").notNull().default("verified"),
    reviewFlags: jsonb("review_flags").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("step_source_samples_user_source_id_unique").on(table.userId, table.source, table.sourceSampleId),
    index("step_source_samples_user_date_idx").on(table.userId, table.recordDate),
    index("step_source_samples_review_idx").on(table.verificationStatus),
  ],
);

export const challengeRecoveryCasesTable = pgTable(
  "challenge_recovery_cases",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    challengeId: varchar("challenge_id").notNull().references(() => challengesTable.id, { onDelete: "cascade" }),
    type: varchar("type").notNull(),
    status: varchar("status").notNull().default("requested"),
    reason: text("reason").notNull(),
    sourceFlags: jsonb("source_flags").$type<string[]>().notNull().default([]),
    reviewMessage: text("review_message").notNull().default("Support will review this with your source history before settlement."),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("challenge_recovery_cases_user_idx").on(table.userId, table.updatedAt),
    index("challenge_recovery_cases_challenge_idx").on(table.challengeId),
  ],
);
export const challengeParticipantOverridesTable = pgTable(
  "challenge_participant_overrides",
  {
    id: serial("id").primaryKey(),
    challengeId: varchar("challenge_id").notNull().references(() => challengesTable.id, { onDelete: "cascade" }),
    userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    adminUserId: varchar("admin_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    status: varchar("status").notNull(),
    previousStatus: varchar("previous_status").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("challenge_participant_overrides_user_idx").on(table.userId, table.createdAt),
    index("challenge_participant_overrides_challenge_idx").on(table.challengeId, table.createdAt),
  ],
);

export const challengeInvitesTable = pgTable(
  "challenge_invites",
  {
    id: serial("id").primaryKey(),
    challengeId: varchar("challenge_id").notNull().references(() => challengesTable.id, { onDelete: "cascade" }),
    inviterUserId: varchar("inviter_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    inviteeUserId: varchar("invitee_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    token: varchar("token").notNull(),
    status: varchar("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("challenge_invites_token_unique").on(table.token),
    index("challenge_invites_challenge_idx").on(table.challengeId, table.createdAt),
    index("challenge_invites_invitee_idx").on(table.inviteeUserId, table.status),
  ],
);

export const referralCodesTable = pgTable(
  "stridepool_referral_codes",
  {
    code: varchar("code").primaryKey(),
    ownerUserId: varchar("owner_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("stridepool_referral_codes_owner_unique").on(table.ownerUserId),
  ],
);

export const referralsTable = pgTable(
  "stridepool_referrals",
  {
    id: serial("id").primaryKey(),
    code: varchar("code").notNull().references(() => referralCodesTable.code, { onDelete: "cascade" }),
    referrerUserId: varchar("referrer_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    referredUserId: varchar("referred_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    status: varchar("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    qualifiedAt: timestamp("qualified_at", { withTimezone: true }),
    referrerTrialEndsAt: timestamp("referrer_trial_ends_at", { withTimezone: true }),
    referredTrialEndsAt: timestamp("referred_trial_ends_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("stridepool_referrals_referred_unique").on(table.referredUserId),
    index("stridepool_referrals_referrer_idx").on(table.referrerUserId, table.createdAt),
    index("stridepool_referrals_status_idx").on(table.status, table.createdAt),
  ],
);

export const notificationsTable = pgTable(
  "stridepool_notifications",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    type: varchar("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    challengeId: varchar("challenge_id").references(() => challengesTable.id, { onDelete: "cascade" }),
    actorUserId: varchar("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    dedupeKey: varchar("dedupe_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("stridepool_notifications_dedupe_unique").on(table.dedupeKey),
    index("stridepool_notifications_user_idx").on(table.userId, table.createdAt),
  ],
);

export const walletLedgerEntriesTable = pgTable(
  "wallet_ledger_entries",
  {
    id: varchar("id").primaryKey(),
    userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    eventType: varchar("event_type").notNull(),
    status: varchar("status").notNull(),
    amountCents: integer("amount_cents").notNull().default(0),
    currency: varchar("currency").notNull().default("usd"),
    providerEventId: varchar("provider_event_id"),
    idempotencyKey: varchar("idempotency_key"),
    challengeId: varchar("challenge_id").references(() => challengesTable.id, { onDelete: "set null" }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("wallet_ledger_provider_event_unique").on(table.providerEventId),
    uniqueIndex("wallet_ledger_user_idempotency_unique").on(table.userId, table.idempotencyKey),
    index("wallet_ledger_user_idx").on(table.userId, table.createdAt),
  ],
);

/**
 * A receipt is inserted in the same transaction as its ledger entry. It is
 * intentionally separate from the append-only wallet ledger so a duplicate
 * webhook can be acknowledged without ever creating a second money event.
 */
export const providerMoneyEventsTable = pgTable(
  "provider_money_events",
  {
    providerEventId: varchar("provider_event_id").primaryKey(),
    provider: varchar("provider").notNull(),
    eventType: varchar("event_type").notNull(),
    userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    amountCents: integer("amount_cents").notNull().default(0),
    currency: varchar("currency").notNull().default("usd"),
    challengeId: varchar("challenge_id").references(() => challengesTable.id, { onDelete: "set null" }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("provider_money_events_provider_event_unique").on(table.provider, table.providerEventId),
    index("provider_money_events_user_idx").on(table.userId, table.receivedAt),
  ],
);

/**
 * Payout status is a materialized view of immutable provider events. The
 * status transition prevents a late payout.failed event from moving a paid
 * payout back to retry_pending.
 */
export const payoutStatesTable = pgTable(
  "payout_states",
  {
    providerPayoutId: varchar("provider_payout_id").primaryKey(),
    provider: varchar("provider").notNull(),
    userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    status: varchar("status").notNull(),
    retryCount: integer("retry_count").notNull().default(0),
    amountCents: integer("amount_cents").notNull().default(0),
    currency: varchar("currency").notNull().default("usd"),
    lastProviderEventId: varchar("last_provider_event_id").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("payout_states_provider_payout_unique").on(table.provider, table.providerPayoutId),
    index("payout_states_user_idx").on(table.userId, table.updatedAt),
  ],
);

export const moneyReconciliationRunsTable = pgTable(
  "money_reconciliation_runs",
  {
    id: varchar("id").primaryKey(),
    provider: varchar("provider").notNull(),
    providerReportId: varchar("provider_report_id").notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    providerTotalCents: integer("provider_total_cents").notNull(),
    ledgerTotalCents: integer("ledger_total_cents").notNull(),
    discrepancyCents: integer("discrepancy_cents").notNull(),
    providerEventCount: integer("provider_event_count"),
    ledgerEventCount: integer("ledger_event_count").notNull(),
    status: varchar("status").notNull(),
    reportMetadata: jsonb("report_metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("money_reconciliation_provider_report_unique").on(table.provider, table.providerReportId),
    index("money_reconciliation_created_idx").on(table.createdAt),
  ],
);

export const insertChallengeSchema = createInsertSchema(challengesTable);
export const insertGroupSchema = createInsertSchema(groupsTable);
export const insertGroupMemberSchema = createInsertSchema(groupMembersTable);
export const insertEntrySchema = createInsertSchema(entriesTable);
export const insertDailyStepRecordSchema = createInsertSchema(dailyStepRecordsTable);
export const insertWalletLedgerEntrySchema = createInsertSchema(walletLedgerEntriesTable);
export type InsertChallenge = z.infer<typeof insertChallengeSchema>;
export type InsertEntry = z.infer<typeof insertEntrySchema>;
export type InsertDailyStepRecord = z.infer<typeof insertDailyStepRecordSchema>;
export type Challenge = typeof challengesTable.$inferSelect;
export type Group = typeof groupsTable.$inferSelect;
export type GroupMember = typeof groupMembersTable.$inferSelect;
export type Entry = typeof entriesTable.$inferSelect;
export type DailyStepRecord = typeof dailyStepRecordsTable.$inferSelect;
export type HealthSourceConnection = typeof healthSourceConnectionsTable.$inferSelect;
export type StepSourceSample = typeof stepSourceSamplesTable.$inferSelect;

export type ChallengeRecoveryCase = typeof challengeRecoveryCasesTable.$inferSelect;
export type ChallengeParticipantOverride = typeof challengeParticipantOverridesTable.$inferSelect;
export type ChallengeInvite = typeof challengeInvitesTable.$inferSelect;
export type ReferralCode = typeof referralCodesTable.$inferSelect;
export type Referral = typeof referralsTable.$inferSelect;
export type Notification = typeof notificationsTable.$inferSelect;
export type WalletLedgerEntry = typeof walletLedgerEntriesTable.$inferSelect;
export type ProviderMoneyEvent = typeof providerMoneyEventsTable.$inferSelect;
export type PayoutState = typeof payoutStatesTable.$inferSelect;
export type MoneyReconciliationRun = typeof moneyReconciliationRunsTable.$inferSelect;

export const challengeRecoveryDecisionsTable = pgTable(
  "challenge_recovery_decisions",
  {
    id: serial("id").primaryKey(),
    recoveryCaseId: integer("recovery_case_id").notNull().references(() => challengeRecoveryCasesTable.id, { onDelete: "cascade" }),
    adminUserId: varchar("admin_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    decision: varchar("decision").notNull(),
    explanation: text("explanation").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("challenge_recovery_decisions_case_idx").on(table.recoveryCaseId, table.createdAt),
    index("challenge_recovery_decisions_admin_idx").on(table.adminUserId, table.createdAt),
  ],
);
