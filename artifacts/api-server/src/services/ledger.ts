import { randomUUID } from "node:crypto";
import type {
  CheckoutInput,
  ComplianceStatus,
  EligibilityDecision,
  EligibilityInput,
  LedgerEntry,
  PayoutOnboardingInput,
  ProviderWebhookInput,
} from "@workspace/api-zod";
import { db, challengesTable, usersTable, walletLedgerEntriesTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { nextPayoutRetry } from "./settlement";
import {
  createStripeCheckout,
  createStripePayoutOnboarding,
  getStripeProviderStatus,
} from "./stripe-provider";

const providerName = "Stripe";
const approvedStates = (process.env.PAID_PLAY_APPROVED_STATES ?? "")
  .split(",")
  .map((state) => state.trim().toUpperCase())
  .filter(Boolean);

function eligibilityReasons(input: EligibilityInput, status: ComplianceStatus): string[] {
  const reasons: string[] = [];
  if (!Number.isInteger(input.age)) reasons.push("Age must be a whole number.");
  if (input.age < status.minAge) reasons.push(`Paid play is available only to people ${status.minAge}+.`);
  if (!status.approvedStates.length) {
    reasons.push("Paid play is paused while state-by-state counsel review is pending.");
  } else if (!status.approvedStates.includes(input.state.toUpperCase())) {
    reasons.push("Paid play is not available in this state.");
  }
  if (input.identityStatus !== "verified") reasons.push("Complete identity verification before a paid entry.");
  if (!input.acceptedTerms) reasons.push("Accept the paid-challenge terms and refund policy.");
  if (!status.providerConfigured) reasons.push("Payment and payout providers are not connected yet.");
  return reasons;
}

export function getComplianceStatus(): ComplianceStatus {
  const provider = getStripeProviderStatus();
  const providerConfigured = provider.providerReady && provider.webhookReady;
  const paidPlayEnabled =
    process.env.PAID_PLAY_ENABLED === "true"
    && providerConfigured
    && provider.backfillReady
    && provider.sandboxReconciliationPassed;
  return {
    paidPlayEnabled,
    providerConfigured,
    providerName,
    webhookReady: provider.webhookReady,
    sandboxReconciliationPassed: provider.sandboxReconciliationPassed,
    counselReviewRequired: approvedStates.length === 0,
    minAge: 18,
    approvedStates,
    requirements: [
      "18 or older",
      "Identity verified by the payment provider",
      "State eligibility confirmed after counsel review",
      "Paid-challenge terms and refund policy accepted",
      "Settlement, refund, dispute, and payout-retry events reconciled from the provider",
    ],
    settlementPolicy: [
      "All amounts are stored as integer USD cents; no floating-point balance math",
      "Winner shares use deterministic largest-remainder rounding and must reconcile to the pool",
      "No-finisher refunds and provider disputes are separate immutable events",
      "Failed payouts remain pending and carry a retry count until reconciled by the provider",
    ],
  };
}

export function checkEligibility(input: EligibilityInput): EligibilityDecision {
  const status = getComplianceStatus();
  const reasons = eligibilityReasons(input, status);
  return {
    eligible: reasons.length === 0 && status.paidPlayEnabled,
    reasons: status.paidPlayEnabled ? reasons : [...reasons, "Paid play is not enabled for this launch."],
    checkedAt: new Date(),
  };
}

export async function createCheckout(userId: string, input: CheckoutInput) {
  const existingEntries = await db.select().from(walletLedgerEntriesTable).where(and(
    eq(walletLedgerEntriesTable.userId, userId),
    eq(walletLedgerEntriesTable.eventType, "payment_intent_created"),
  ));
  const existing = existingEntries.find((entry) => entry.metadata.idempotencyKey === input.idempotencyKey);
  if (existing) {
    return {
      checkoutId: String(existing.metadata.checkoutId ?? ""),
      checkoutUrl: String(existing.metadata.checkoutUrl ?? ""),
      status: "requires_action" as const,
      provider: providerName,
      ledgerEntryId: existing.id,
    };
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  const [challenge] = await db.select().from(challengesTable).where(eq(challengesTable.id, input.challengeId));
  if (!user || !challenge) throw new Error("Challenge or account was not found.");
  if (Math.round(Number(challenge.entryFee) * 100) !== input.amountCents || challenge.community || input.amountCents < 1) {
    throw new Error("Checkout amount does not match this challenge.");
  }
  const eligibility = checkEligibility({
    age: user.eligibilityAge,
    state: user.eligibilityState,
    identityStatus: user.eligibilityIdentityStatus as EligibilityInput["identityStatus"],
    acceptedTerms: user.eligibilityAcceptedTerms,
  });
  if (!eligibility.eligible) {
    throw new Error(eligibility.reasons.join(" "));
  }
  if (!Number.isInteger(input.amountCents)) throw new Error("Money amounts must be whole cents.");

  const checkout = await createStripeCheckout(user, challenge, input.amountCents, input.idempotencyKey);
  if (!checkout.url) throw new Error("Stripe did not return a hosted checkout URL.");
  const [entry] = await db.insert(walletLedgerEntriesTable).values({
    id: `ledger_${randomUUID()}`,
    userId,
    eventType: "payment_intent_created",
    status: "pending_provider",
    amountCents: input.amountCents,
    currency: input.currency,
    providerEventId: null,
    challengeId: input.challengeId,
    metadata: {
      checkoutId: checkout.id,
      checkoutUrl: checkout.url,
      idempotencyKey: input.idempotencyKey,
      auditRule: "provider webhook required before funds are committed",
    },
  }).returning();
  return {
    checkoutId: checkout.id,
    checkoutUrl: checkout.url,
    status: "requires_action" as const,
    provider: providerName,
    ledgerEntryId: entry.id,
  };
}

export async function startPayoutOnboarding(userId: string, input: PayoutOnboardingInput) {
  const existingEntries = await db.select().from(walletLedgerEntriesTable).where(and(
    eq(walletLedgerEntriesTable.userId, userId),
    eq(walletLedgerEntriesTable.eventType, "payout_onboarding_started"),
  ));
  const existing = existingEntries.find((entry) => entry.metadata.idempotencyKey === input.idempotencyKey);
  if (existing) {
    return {
      onboardingId: String(existing.metadata.onboardingId ?? ""),
      onboardingUrl: String(existing.metadata.onboardingUrl ?? ""),
      status: "pending" as const,
      provider: providerName,
    };
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) throw new Error("Account was not found.");
  const { accountId, accountLink } = await createStripePayoutOnboarding(
    user,
    input.idempotencyKey,
  );
  await db.insert(walletLedgerEntriesTable).values({
    id: `ledger_${randomUUID()}`,
    userId,
    eventType: "payout_onboarding_started",
    status: "pending_provider",
    amountCents: 0,
    currency: "usd",
    providerEventId: null,
    challengeId: null,
    metadata: {
      onboardingId: accountId,
      onboardingUrl: accountLink.url,
      idempotencyKey: input.idempotencyKey,
      auditRule: "provider onboarding must complete before withdrawal",
    },
  });
  return {
    onboardingId: accountId,
    onboardingUrl: accountLink.url,
    status: "pending" as const,
    provider: providerName,
  };
}

export async function recordProviderWebhook(input: ProviderWebhookInput) {
  const [duplicate] = await db.select().from(walletLedgerEntriesTable).where(eq(walletLedgerEntriesTable.providerEventId, input.providerEventId));
  if (duplicate) return { accepted: true, duplicate: true, ledgerEntryId: duplicate.id };
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, input.userId));
  if (!user) throw new Error("Provider event references an unknown account.");
  const [entry] = await db.insert(walletLedgerEntriesTable).values({
    id: `ledger_${randomUUID()}`,
    userId: input.userId,
    eventType: input.eventType,
    status: input.eventType.endsWith("failed") ? "failed" : "recorded",
    amountCents: input.amountCents,
    currency: input.currency,
    providerEventId: input.providerEventId,
    challengeId: input.challengeId,
    metadata: {
      ...input.metadata,
      settlementPolicy: "integer_cents",
      retryCount: input.eventType === "payout_failed"
        ? nextPayoutRetry(Number(input.metadata.retryCount ?? 0)).retryCount
        : undefined,
    },
  }).returning();
  return { accepted: true, duplicate: false, ledgerEntryId: entry.id };
}

export async function getLedger(userId: string): Promise<LedgerEntry[]> {
  const entries = await db.select().from(walletLedgerEntriesTable)
    .where(eq(walletLedgerEntriesTable.userId, userId))
    .orderBy(desc(walletLedgerEntriesTable.createdAt));
  return entries.map((entry) => ({
    id: entry.id,
    userId: entry.userId,
    eventType: entry.eventType,
    status: entry.status,
    amountCents: entry.amountCents,
    currency: entry.currency,
    providerEventId: entry.providerEventId,
    challengeId: entry.challengeId,
    metadata: entry.metadata,
    createdAt: entry.createdAt,
  }));
}

export function isProviderConfigured() {
  const provider = getStripeProviderStatus();
  return provider.providerReady && provider.webhookReady;
}