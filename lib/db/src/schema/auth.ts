import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, numeric, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

export const sessionsTable = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// Profile, demo-wallet, and personalized-goal fields live on the user row so
// the first persistence pass stays small. The nullable payment fields are
// deliberately reserved for the later provider-backed wallet migration.
export const usersTable = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  displayName: varchar("display_name"),
  role: varchar("role").notNull().default("user"),
  walletBalance: numeric("wallet_balance", { precision: 12, scale: 2 }).notNull().default("42.50"),
  walletPending: numeric("wallet_pending", { precision: 12, scale: 2 }).notNull().default("18.00"),
  totalEarned: numeric("total_earned", { precision: 12, scale: 2 }).notNull().default("156.75"),
  goalBaseline: numeric("goal_baseline", { precision: 8, scale: 0 }).notNull().default("7500"),
  reminders: boolean("reminders").notNull().default(true),
  weeklyDigest: boolean("weekly_digest").notNull().default(true),
  publicProgress: boolean("public_progress").notNull().default(false),
  healthConnected: boolean("health_connected").notNull().default(true),
  eligibilityAge: integer("eligibility_age").notNull().default(0),
  eligibilityState: varchar("eligibility_state").notNull().default(""),
  eligibilityIdentityStatus: varchar("eligibility_identity_status").notNull().default("not_started"),
  eligibilityAcceptedTerms: boolean("eligibility_accepted_terms").notNull().default(false),
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