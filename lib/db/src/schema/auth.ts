import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const sessionsTable = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// Financial balances start empty; demo balances belong only in explicit
// development fixtures, never in defaults for real accounts.
export const usersTable = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  displayName: varchar("display_name"),
  role: varchar("role").notNull().default("user"),
  walletBalance: numeric("wallet_balance", { precision: 12, scale: 2 }).notNull().default("0.00"),
  walletPending: numeric("wallet_pending", { precision: 12, scale: 2 }).notNull().default("0.00"),
  totalEarned: numeric("total_earned", { precision: 12, scale: 2 }).notNull().default("0.00"),
  goalBaseline: numeric("goal_baseline", { precision: 8, scale: 0 }).notNull().default("7500"),
  reminders: boolean("reminders").notNull().default(true),
  weeklyDigest: boolean("weekly_digest").notNull().default(true),
  publicProgress: boolean("public_progress").notNull().default(false),
  healthConnected: boolean("health_connected").notNull().default(true),
  eligibilityAge: integer("eligibility_age").notNull().default(0),
  eligibilityState: varchar("eligibility_state").notNull().default(""),
  eligibilityIdentityStatus: varchar("eligibility_identity_status").notNull().default("not_started"),
  eligibilityAcceptedTerms: boolean("eligibility_accepted_terms").notNull().default(false),
  eligibilityAcceptedTermsAt: timestamp("eligibility_accepted_terms_at", { withTimezone: true }),
  eligibilityAcceptedTermsVersion: varchar("eligibility_accepted_terms_version"),
  // Paid Play Terms §12.3: self-exclusion and entry limits apply immediately.
  paidPlaySelfExcludedUntil: timestamp("paid_play_self_excluded_until", { withTimezone: true }),
  paidPlaySelfExcludedPermanently: boolean("paid_play_self_excluded_permanently").notNull().default(false),
  paidPlayWeeklyEntryLimitCents: integer("paid_play_weekly_entry_limit_cents"),
  // Paid Play Terms §9.6: written consent before any biometric identity check.
  biometricConsentAt: timestamp("biometric_consent_at", { withTimezone: true }),
  biometricConsentVersion: varchar("biometric_consent_version"),
  // Paid Play Terms §6.4: closure pays out the full available balance.
  accountClosedAt: timestamp("account_closed_at", { withTimezone: true }),
  weightLbs: numeric("weight_lbs", { precision: 6, scale: 1 }),
  heightInches: integer("height_inches"),
  fitnessGoals: text("fitness_goals").notNull().default(""),
  // Future real-payment fields: populate only when a provider is selected.
  stripeCustomerId: varchar("stripe_customer_id"),
  stripeConnectAccountId: varchar("stripe_connect_account_id"),
  stripeSubscriptionId: varchar("stripe_subscription_id"),
  subscriptionStatus: varchar("subscription_status").notNull().default("inactive"),
  membershipPlan: varchar("membership_plan").notNull().default("free"),
  proTrialEndsAt: timestamp("pro_trial_ends_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type UpsertUser = typeof usersTable.$inferInsert;
export type User = typeof usersTable.$inferSelect;