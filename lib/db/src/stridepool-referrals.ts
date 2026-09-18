import { and, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db } from "./index";
import { referralCodesTable, referralsTable, usersTable } from "./schema";

export const REFERRAL_TRIAL_DAYS = 30;

function addReferralMonth(from: Date): Date {
  const result = new Date(from);
  result.setUTCDate(result.getUTCDate() + REFERRAL_TRIAL_DAYS);
  return result;
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

export async function ensureReferralCode(ownerUserId: string): Promise<string> {
  const [existing] = await db.select({ code: referralCodesTable.code })
    .from(referralCodesTable)
    .where(eq(referralCodesTable.ownerUserId, ownerUserId));
  if (existing) return existing.code;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = `SP-${randomBytes(5).toString("hex").toUpperCase()}`;
    try {
      const [created] = await db.insert(referralCodesTable).values({ code, ownerUserId }).returning({ code: referralCodesTable.code });
      if (created) return created.code;
    } catch {
      // A generated code collision is safe to retry.
    }
  }
  throw new Error("Could not create a referral code.");
}

export async function getReferralPreview(code: string) {
  const [row] = await db.select({
    code: referralCodesTable.code,
    owner: usersTable,
  }).from(referralCodesTable)
    .innerJoin(usersTable, eq(referralCodesTable.ownerUserId, usersTable.id))
    .where(eq(referralCodesTable.code, normalizeCode(code)));
  if (!row) return null;
  return {
    code: row.code,
    referrerDisplayName: row.owner.displayName || [row.owner.firstName, row.owner.lastName].filter(Boolean).join(" ") || "A StridePool walker",
  };
}

export async function claimReferralCode(referredUserId: string, code: string) {
  const normalizedCode = normalizeCode(code);
  return db.transaction(async (tx) => {
    const [codeRow] = await tx.select().from(referralCodesTable).where(eq(referralCodesTable.code, normalizedCode));
    if (!codeRow) throw new Error("That referral link is not available.");
    if (codeRow.ownerUserId === referredUserId) throw new Error("You cannot use your own referral link.");

    const [existing] = await tx.select().from(referralsTable).where(eq(referralsTable.referredUserId, referredUserId));
    if (existing) {
      if (existing.code === normalizedCode) return { status: existing.status as "pending" | "qualified" };
      throw new Error("This account already has a referral attached.");
    }
    const [created] = await tx.insert(referralsTable).values({
      code: normalizedCode,
      referrerUserId: codeRow.ownerUserId,
      referredUserId,
    }).returning({ status: referralsTable.status });
    return { status: (created?.status ?? "pending") as "pending" | "qualified" };
  });
}

export async function qualifyReferralForUser(referredUserId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const [referral] = await tx.update(referralsTable).set({
      status: "qualified",
      qualifiedAt: now,
    }).where(and(
      eq(referralsTable.referredUserId, referredUserId),
      eq(referralsTable.status, "pending"),
    )).returning();
    if (!referral) return null;

    const [referrer, referred] = await Promise.all([
      tx.select().from(usersTable).where(eq(usersTable.id, referral.referrerUserId)).then(([user]) => user),
      tx.select().from(usersTable).where(eq(usersTable.id, referral.referredUserId)).then(([user]) => user),
    ]);
    if (!referrer || !referred) return null;

    const grantTrial = async (user: typeof usersTable.$inferSelect) => {
      const currentEnd = user.proTrialEndsAt && user.proTrialEndsAt > now ? user.proTrialEndsAt : now;
      const trialEndsAt = addReferralMonth(currentEnd);
      if (user.subscriptionStatus === "active") {
        const [updated] = await tx.update(usersTable).set({
          proTrialEndsAt: trialEndsAt,
          updatedAt: now,
        }).where(eq(usersTable.id, user.id)).returning();
        return { trialEndsAt, updated: updated ?? user };
      }
      const [updated] = await tx.update(usersTable).set({
        membershipPlan: "pro",
        subscriptionStatus: "trialing",
        proTrialEndsAt: trialEndsAt,
        updatedAt: now,
      }).where(eq(usersTable.id, user.id)).returning();
      return { trialEndsAt, updated: updated ?? user };
    };

    const [referrerGrant, referredGrant] = await Promise.all([grantTrial(referrer), grantTrial(referred)]);
    await tx.update(referralsTable).set({
      referrerTrialEndsAt: referrerGrant.trialEndsAt,
      referredTrialEndsAt: referredGrant.trialEndsAt,
    }).where(eq(referralsTable.id, referral.id));
    return {
      referralId: referral.id,
      referrerUserId: referral.referrerUserId,
      referredUserId: referral.referredUserId,
      referrerTrialEndsAt: referrerGrant.trialEndsAt,
      referredTrialEndsAt: referredGrant.trialEndsAt,
    };
  });
}

export async function getReferralSummary(userId: string) {
  const code = await ensureReferralCode(userId);
  const [user] = await db.select({ proTrialEndsAt: usersTable.proTrialEndsAt })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  const rows = await db.select({ status: referralsTable.status })
    .from(referralsTable)
    .where(eq(referralsTable.referrerUserId, userId));
  return {
    code,
    pendingCount: rows.filter((row) => row.status === "pending").length,
    qualifiedCount: rows.filter((row) => row.status === "qualified").length,
    proTrialEndsAt: user?.proTrialEndsAt?.toISOString() ?? null,
  };
}