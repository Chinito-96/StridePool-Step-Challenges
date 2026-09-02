import { createInsertSchema } from "drizzle-zod";
import { date, index, integer, pgTable, serial, text, timestamp, uniqueIndex, varchar, boolean, numeric } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { usersTable } from "./auth";

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
  goalType: varchar("goal_type").notNull().default("fixed"),
  community: boolean("community").notNull().default(false),
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

export const insertChallengeSchema = createInsertSchema(challengesTable);
export const insertEntrySchema = createInsertSchema(entriesTable);
export const insertDailyStepRecordSchema = createInsertSchema(dailyStepRecordsTable);
export type InsertChallenge = z.infer<typeof insertChallengeSchema>;
export type InsertEntry = z.infer<typeof insertEntrySchema>;
export type InsertDailyStepRecord = z.infer<typeof insertDailyStepRecordSchema>;
export type Challenge = typeof challengesTable.$inferSelect;
export type Entry = typeof entriesTable.$inferSelect;
export type DailyStepRecord = typeof dailyStepRecordsTable.$inferSelect;