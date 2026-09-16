import { and, eq, gte, ne, sql } from "drizzle-orm";
import { db } from "./index";
import { challengesTable, entriesTable, usersTable } from "./schema";

export type MembershipPlan = "free" | "pro";

export const MEMBERSHIP_POLICY = {
  free: {
    monthlyPriceCents: 0,
    challengeJoinPriceCents: 200,
    activeChallengeLimit: 1,
    challengeCreationLimit: 0,
  },
  pro: {
    monthlyPriceCents: 500,
    challengeJoinPriceCents: 100,
    activeChallengeLimit: 5,
    challengeCreationLimit: 1,
  },
} as const;

export function membershipPlanFor(user: typeof usersTable.$inferSelect): MembershipPlan {
  return user.membershipPlan === "pro"
    && (user.subscriptionStatus === "active" || user.subscriptionStatus === "trialing")
    ? "pro"
    : "free";
}

export function membershipPolicyFor(user: typeof usersTable.$inferSelect) {
  return MEMBERSHIP_POLICY[membershipPlanFor(user)];
}

export async function getMembershipSummary(userId: string, now = new Date()) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) throw new Error("Account not found.");
  const today = now.toISOString().slice(0, 10);
  const [[active], [created]] = await Promise.all([
    db.select({ count: sql<number>`count(*)` })
      .from(entriesTable)
      .innerJoin(challengesTable, eq(entriesTable.challengeId, challengesTable.id))
      .where(and(
        eq(entriesTable.userId, userId),
        eq(entriesTable.status, "active"),
        gte(challengesTable.endDate, today),
        ne(challengesTable.settlementStatus, "settled"),
      )),
    db.select({ count: sql<number>`count(*)` })
      .from(challengesTable)
      .where(and(
        eq(challengesTable.creatorUserId, userId),
        gte(challengesTable.endDate, today),
        ne(challengesTable.settlementStatus, "settled"),
      )),
  ]);
  const plan = membershipPlanFor(user);
  const policy = MEMBERSHIP_POLICY[plan];
  return {
    plan,
    status: plan === "pro"
      ? (user.subscriptionStatus as "active" | "trialing")
      : user.subscriptionStatus === "past_due" || user.subscriptionStatus === "canceled"
        ? user.subscriptionStatus
        : "inactive" as const,
    monthlyPrice: policy.monthlyPriceCents / 100,
    challengeJoinPrice: policy.challengeJoinPriceCents / 100,
    activeChallengeLimit: policy.activeChallengeLimit,
    activeChallengeCount: Number(active?.count ?? 0),
    challengeCreationLimit: policy.challengeCreationLimit,
    activeCreatedChallengeCount: Number(created?.count ?? 0),
  };
}
