import { randomUUID } from "node:crypto";
import type {
  CheckoutInput,
  ComplianceStatus,
  EligibilityDecision,
  EligibilityInput,
  LedgerEntry,
  PaidPlayLaunchControl,
  PayoutOnboardingInput,
  ProviderWebhookInput,
  WithdrawalInput,
} from "@workspace/api-zod";
import {
  db,
  challengesTable,
  entriesTable,
  getMembershipSummary,
  membershipPlanFor,
  membershipPolicyFor,
  moneyReconciliationRunsTable,
  payoutStatesTable,
  providerMoneyEventsTable,
  usersTable,
  walletLedgerEntriesTable,
} from "@workspace/db";
import { and, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import { projectPayoutEvent, signedLedgerAmountCents } from "./ledger-policy";
import {
  createStripeCheckout,
  createStripePayoutOnboarding,
  createStripeProCheckout,
  createStripeBillingPortal,
  createStripeWithdrawal,
  getStripePayoutAccount,
  getStripeProviderStatus,
} from "./stripe-provider";

const providerName = "Stripe";
export const MINIMUM_WITHDRAWAL_CENTS = 2_000;
type StripeProviderStatus = ReturnType<typeof getStripeProviderStatus>;
type LaunchEnvironment = Readonly<Record<string, string | undefined>>;

function readApprovedStates(environment: LaunchEnvironment): string[] {
  return (environment.PAID_PLAY_APPROVED_STATES ?? "")
    .split(",")
    .map((state) => state.trim().toUpperCase())
    .filter(Boolean);
}

type PaidPlayLaunchInput = {
  enabled: boolean;
  counselApproved: boolean;
  approvedStates: string[];
  providerReady: boolean;
  webhookReady: boolean;
  backfillReady: boolean;
  sandboxReconciliationPassed: boolean;
};

function getPaidPlayLaunchControls(input: PaidPlayLaunchInput): PaidPlayLaunchControl[] {
  const control = (
    id: PaidPlayLaunchControl["id"],
    ready: boolean,
    readyExplanation: string,
    blockingExplanation: string,
  ): PaidPlayLaunchControl => ({
    id,
    status: ready ? "ready" : "blocking",
    explanation: ready ? readyExplanation : blockingExplanation,
  });
  // Only fixed messages and readiness booleans belong in this public response.
  return [
    control("launch_enabled", input.enabled,
      "The paid-play launch switch is enabled.",
      "Keep paid play disabled until all other controls are ready, then set PAID_PLAY_ENABLED=true."),
    control("counsel_approval", input.counselApproved,
      "Written counsel approval is marked as recorded.",
      "Obtain and record written qualified-counsel approval before setting PAID_PLAY_COUNSEL_APPROVED=true."),
    control("approved_states", input.approvedStates.length > 0,
      "An approved-jurisdiction list is configured.",
      "After written counsel approval, add only covered jurisdictions to PAID_PLAY_APPROVED_STATES."),
    control("stripe_provider", input.providerReady,
      "Stripe provider initialization is complete.",
      "Confirm the managed Stripe connection is authorized and resolve provider initialization failures in server logs."),
    control("managed_webhook", input.webhookReady,
      "Managed webhook signature-verification configuration is ready.",
      "Complete managed webhook initialization and confirm signature verification is configured for /api/stripe/webhook."),
    control("provider_backfill", input.backfillReady,
      "Stripe provider backfill is complete.",
      "Resolve Stripe sync backfill failures in server logs and rerun provider initialization until backfill completes."),
    control("sandbox_reconciliation", input.sandboxReconciliationPassed,
      "Sandbox reconciliation is marked as approved.",
      "Review signed sandbox payment, refund, dispute, and payout evidence plus a matched persisted reconciliation run before setting STRIPE_SANDBOX_RECONCILIATION_PASSED=true."),
  ];
}

export function isPaidPlayLaunchEnabled(input: PaidPlayLaunchInput): boolean {
  return getPaidPlayLaunchControls(input).every((control) => control.status === "ready");
}

function eligibilityReasons(input: EligibilityInput, status: ComplianceStatus): string[] {
  const reasons: string[] = [];
  if (!Number.isInteger(input.age)) reasons.push("Age must be a whole number.");
  if (input.age < status.minAge) reasons.push(`Paid play is available only to people ${status.minAge}+.`);
  if (!status.approvedStates.length) {
    reasons.push("Paid play is paused while state-by-state counsel review is pending.");
  } else if (status.counselReviewRequired) {
    reasons.push("Paid play is paused until written qualified-counsel approval is recorded.");
  } else if (!status.approvedStates.includes(input.state.toUpperCase())) {
    reasons.push("Paid play is not available in this state.");
  }
  if (input.identityStatus !== "verified") reasons.push("Complete identity verification before a paid entry.");
  if (!input.acceptedTerms) reasons.push("Accept the paid-challenge terms and refund policy.");
  if (!status.providerConfigured) reasons.push("Payment and payout providers are not connected yet.");
  return reasons;
}

export function getComplianceStatus(
  provider: StripeProviderStatus = getStripeProviderStatus(),
  environment: LaunchEnvironment = process.env,
): ComplianceStatus {
  const approvedStates = readApprovedStates(environment);
  const counselApproved = environment.PAID_PLAY_COUNSEL_APPROVED === "true";
  const providerConfigured = provider.providerReady && provider.webhookReady;
  const launchControls = getPaidPlayLaunchControls({
    enabled: environment.PAID_PLAY_ENABLED === "true",
    counselApproved,
    approvedStates,
    providerReady: provider.providerReady,
    webhookReady: provider.webhookReady,
    backfillReady: provider.backfillReady,
    sandboxReconciliationPassed: provider.sandboxReconciliationPassed,
  });
  return {
    paidPlayEnabled: launchControls.every((control) => control.status === "ready"),
    launchControls,
    providerConfigured,
    providerName,
    webhookReady: provider.webhookReady,
    sandboxReconciliationPassed: provider.sandboxReconciliationPassed,
    counselReviewRequired: !counselApproved || approvedStates.length === 0,
    minAge: 18,
    approvedStates,
    requirements: [
      "18 or older",
      "Identity verified by the payment provider",
      "State eligibility confirmed after counsel review",
      "Paid-challenge terms and refund policy accepted",
      "Geolocation, tax, dispute, responsible-play, and record-retention notices acknowledged",
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

export function checkEligibility(
  input: EligibilityInput,
  provider?: StripeProviderStatus,
  environment?: LaunchEnvironment,
): EligibilityDecision {
  const status = getComplianceStatus(provider, environment);
  const reasons = eligibilityReasons(input, status);
  return {
    eligible: reasons.length === 0 && status.paidPlayEnabled,
    reasons: status.paidPlayEnabled ? reasons : [...reasons, "Paid play is not enabled for this launch."],
    checkedAt: new Date(),
  };
}

function legacyIdempotencyMatch(
  metadata: Record<string, unknown>,
  idempotencyKey: string,
): boolean {
  return metadata.idempotencyKey === idempotencyKey;
}

export async function createCheckout(userId: string, input: CheckoutInput) {
  const existingEntries = await db.select().from(walletLedgerEntriesTable).where(and(
    eq(walletLedgerEntriesTable.userId, userId),
    eq(walletLedgerEntriesTable.eventType, "payment_intent_created"),
  ));
  const existing = existingEntries.find((entry) =>
    entry.idempotencyKey === input.idempotencyKey
    || legacyIdempotencyMatch(entry.metadata, input.idempotencyKey),
  );
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
  const policy = membershipPolicyFor(user);
  const challengeEntryCents = Math.round(Number(challenge.entryFee) * 100);
  const totalCents = challengeEntryCents + policy.challengeJoinPriceCents;
  if (totalCents !== input.amountCents) {
    throw new Error(`This entry costs $${(totalCents / 100).toFixed(2)}: $${(challengeEntryCents / 100).toFixed(2)} for the challenge plus the ${membershipPlanFor(user) === "pro" ? "Pro" : "Free"} platform fee of $${(policy.challengeJoinPriceCents / 100).toFixed(2)}.`);
  }
  const [existingEntry] = await db.select({ id: entriesTable.id }).from(entriesTable).where(and(
    eq(entriesTable.userId, userId),
    eq(entriesTable.challengeId, challenge.id),
    eq(entriesTable.status, "active"),
  ));
  if (existingEntry) throw new Error("You already joined this challenge.");
  const membership = await getMembershipSummary(userId);
  if (membership.activeChallengeCount >= membership.activeChallengeLimit) {
    throw new Error(`${membership.plan === "pro" ? "Pro" : "Free"} accounts can join up to ${membership.activeChallengeLimit} active challenge${membership.activeChallengeLimit === 1 ? "" : "s"} at a time.`);
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

  const checkout = await createStripeCheckout(user, challenge, totalCents, challengeEntryCents, policy.challengeJoinPriceCents, input.idempotencyKey);
  if (!checkout.url) throw new Error("Stripe did not return a hosted checkout URL.");
  const entry = await db.transaction(async (tx) => {
    const [racedEntry] = await tx.select().from(walletLedgerEntriesTable).where(and(
      eq(walletLedgerEntriesTable.userId, userId),
      eq(walletLedgerEntriesTable.eventType, "payment_intent_created"),
      eq(walletLedgerEntriesTable.idempotencyKey, input.idempotencyKey),
    ));
    if (racedEntry) return racedEntry;
    const [inserted] = await tx.insert(walletLedgerEntriesTable).values({
      id: `ledger_${randomUUID()}`,
      userId,
      eventType: "payment_intent_created",
      status: "pending_provider",
      amountCents: input.amountCents,
      currency: input.currency,
      providerEventId: null,
      idempotencyKey: input.idempotencyKey,
      challengeId: input.challengeId,
      metadata: {
        checkoutId: checkout.id,
        checkoutUrl: checkout.url,
        idempotencyKey: input.idempotencyKey,
        auditRule: "provider webhook required before funds are committed",
        challengeEntryCents,
        platformFeeCents: policy.challengeJoinPriceCents,
      },
    }).onConflictDoNothing().returning();
    if (inserted) return inserted;
    const [conflict] = await tx.select().from(walletLedgerEntriesTable).where(and(
      eq(walletLedgerEntriesTable.userId, userId),
      eq(walletLedgerEntriesTable.eventType, "payment_intent_created"),
      eq(walletLedgerEntriesTable.idempotencyKey, input.idempotencyKey),
    ));
    if (!conflict) throw new Error("Checkout idempotency conflict could not be recovered.");
    return conflict;
  });
  return {
    checkoutId: String(entry.metadata.checkoutId ?? checkout.id),
    checkoutUrl: String(entry.metadata.checkoutUrl ?? checkout.url),
    status: "requires_action" as const,
    provider: providerName,
    ledgerEntryId: entry.id,
  };
}

export async function createMembershipBillingPortal(userId: string) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) throw new Error("Account not found.");
  return createStripeBillingPortal(user);
}

export async function createProSubscriptionCheckout(userId: string) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) throw new Error("Account not found.");
  if (membershipPlanFor(user) === "pro") throw new Error("This account already has an active Pro membership.");
  const checkout = await createStripeProCheckout(user, `pro-subscription-${user.id}-${Date.now()}`);
  if (!checkout.url) throw new Error("Stripe did not return a hosted checkout URL.");
  return {
    checkoutId: checkout.id,
    checkoutUrl: checkout.url,
    status: "requires_action" as const,
    provider: providerName,
  };
}

export async function startPayoutOnboarding(userId: string, input: PayoutOnboardingInput) {
  const existingEntries = await db.select().from(walletLedgerEntriesTable).where(and(
    eq(walletLedgerEntriesTable.userId, userId),
    eq(walletLedgerEntriesTable.eventType, "payout_onboarding_started"),
  ));
  const existing = existingEntries.find((entry) =>
    entry.idempotencyKey === input.idempotencyKey
    || legacyIdempotencyMatch(entry.metadata, input.idempotencyKey),
  );
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
  await db.transaction(async (tx) => {
    await tx.insert(walletLedgerEntriesTable).values({
      id: `ledger_${randomUUID()}`,
      userId,
      eventType: "payout_onboarding_started",
      status: "pending_provider",
      amountCents: 0,
      currency: "usd",
      providerEventId: null,
      idempotencyKey: input.idempotencyKey,
      challengeId: null,
      metadata: {
        onboardingId: accountId,
        onboardingUrl: accountLink.url,
        idempotencyKey: input.idempotencyKey,
        auditRule: "provider onboarding must complete before withdrawal",
      },
    }).onConflictDoNothing();
  });
  return {
    onboardingId: accountId,
    onboardingUrl: accountLink.url,
    status: "pending" as const,
    provider: providerName,
  };
}

export async function getPayoutAccount(userId: string) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) throw new Error("Account was not found.");
  const status = await getStripePayoutAccount(user);
  return {
    ...status,
    provider: providerName,
    minimumWithdrawal: MINIMUM_WITHDRAWAL_CENTS / 100,
  };
}

export async function withdrawAvailableBalance(userId: string, input: WithdrawalInput) {
  const existing = await db.select().from(walletLedgerEntriesTable).where(and(
    eq(walletLedgerEntriesTable.userId, userId),
    eq(walletLedgerEntriesTable.idempotencyKey, input.idempotencyKey),
  ));
  if (existing[0]) {
    return {
      withdrawalId: String(existing[0].metadata.payoutId ?? existing[0].id),
      amountCents: existing[0].amountCents,
      status: "pending" as const,
      provider: providerName,
    };
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) throw new Error("Account was not found.");
  const amountCents = Math.round(Number(user.walletBalance) * 100);
  if (amountCents < MINIMUM_WITHDRAWAL_CENTS) {
    throw new Error(`Keep at least $${(MINIMUM_WITHDRAWAL_CENTS / 100).toFixed(2)} available before withdrawing.`);
  }
  const account = await getStripePayoutAccount(user);
  if (!account.linked || !account.payoutsEnabled) {
    throw new Error("Link and verify a bank account before withdrawing.");
  }
  const ledgerId = `ledger_${randomUUID()}`;
  const reservedAmountCents = await db.transaction(async (tx) => {
    const [lockedUser] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).for("update");
    const lockedAmountCents = Math.round(Number(lockedUser?.walletBalance ?? 0) * 100);
    if (!lockedUser || lockedAmountCents < MINIMUM_WITHDRAWAL_CENTS) {
      throw new Error("Available balance changed before the withdrawal could be recorded.");
    }
    await tx.update(usersTable).set({
      walletBalance: "0.00",
    }).where(eq(usersTable.id, userId));
    await tx.insert(walletLedgerEntriesTable).values({
      id: ledgerId,
      userId,
      eventType: "withdrawal_requested",
      status: "pending_provider",
      amountCents: lockedAmountCents,
      currency: "usd",
      providerEventId: null,
      idempotencyKey: input.idempotencyKey,
      challengeId: null,
      metadata: {
        auditRule: "available wallet balance reserved before provider payout reconciliation",
      },
    });
    return lockedAmountCents;
  });
  let withdrawal: Awaited<ReturnType<typeof createStripeWithdrawal>>;
  try {
    withdrawal = await createStripeWithdrawal(user, reservedAmountCents, input.idempotencyKey);
  } catch (error) {
    await db.transaction(async (tx) => {
      const [entry] = await tx.select().from(walletLedgerEntriesTable).where(eq(walletLedgerEntriesTable.id, ledgerId)).for("update");
      if (entry?.status === "pending_provider") {
        await tx.update(usersTable).set({
          walletBalance: sql`${usersTable.walletBalance} + ${(entry.amountCents / 100).toFixed(2)}`,
        }).where(eq(usersTable.id, userId));
        await tx.update(walletLedgerEntriesTable).set({
          status: "provider_failed",
          metadata: { ...entry.metadata, failure: error instanceof Error ? error.message : "Provider withdrawal failed." },
        }).where(eq(walletLedgerEntriesTable.id, ledgerId));
      }
    });
    throw error;
  }
  await db.update(walletLedgerEntriesTable).set({
    metadata: {
      payoutId: withdrawal.payoutId,
      transferId: withdrawal.transferId,
      auditRule: "available wallet balance reserved before provider payout reconciliation",
    },
  }).where(eq(walletLedgerEntriesTable.id, ledgerId));
  return {
    withdrawalId: withdrawal.payoutId,
    amountCents: reservedAmountCents,
    status: "pending" as const,
    provider: providerName,
  };
}

export async function recordProviderWebhook(input: ProviderWebhookInput) {
  return db.transaction(async (tx) => {
    const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, input.userId));
    if (!user) throw new Error("Provider event references an unknown account.");

    const [receipt] = await tx.insert(providerMoneyEventsTable).values({
      providerEventId: input.providerEventId,
      provider: providerName,
      eventType: input.eventType,
      userId: input.userId,
      amountCents: input.amountCents,
      currency: input.currency,
      challengeId: input.challengeId,
      metadata: input.metadata,
    }).onConflictDoNothing().returning();
    if (!receipt) {
      const [duplicate] = await tx.select().from(walletLedgerEntriesTable)
        .where(eq(walletLedgerEntriesTable.providerEventId, input.providerEventId));
      if (!duplicate) throw new Error("Provider event receipt exists without its ledger entry.");
      return { accepted: true, duplicate: true, ledgerEntryId: duplicate.id };
    }

    let retryCount: number | undefined;
    if (input.eventType === "payout_failed" || input.eventType === "payout_succeeded") {
      const payoutId = String(input.metadata.stripe_payout_id ?? input.providerEventId);
      const isSuccess = input.eventType === "payout_succeeded";
      const initialProjection = projectPayoutEvent(undefined, input.eventType, input.providerEventId);
      const [payoutState] = await tx.insert(payoutStatesTable).values({
        providerPayoutId: payoutId,
        provider: providerName,
        userId: input.userId,
        status: initialProjection.status,
        retryCount: initialProjection.retryCount,
        amountCents: input.amountCents,
        currency: input.currency,
        lastProviderEventId: initialProjection.lastProviderEventId,
        metadata: input.metadata,
      }).onConflictDoUpdate({
        target: payoutStatesTable.providerPayoutId,
        set: {
          status: sql`case when ${payoutStatesTable.status} = 'paid' then 'paid' when ${isSuccess} then 'paid' else 'retry_pending' end`,
          retryCount: sql`case when ${payoutStatesTable.status} = 'paid' then ${payoutStatesTable.retryCount} when ${isSuccess} then ${payoutStatesTable.retryCount} else ${payoutStatesTable.retryCount} + 1 end`,
          lastProviderEventId: sql`case when ${payoutStatesTable.status} = 'paid' then ${payoutStatesTable.lastProviderEventId} else ${input.providerEventId} end`,
          updatedAt: new Date(),
        },
      }).returning();
      retryCount = payoutState.retryCount;
    }

    const [entry] = await tx.insert(walletLedgerEntriesTable).values({
      id: `ledger_${randomUUID()}`,
      userId: input.userId,
      eventType: input.eventType,
      status: input.eventType.endsWith("failed") ? "failed" : "recorded",
      amountCents: input.amountCents,
      currency: input.currency,
      providerEventId: input.providerEventId,
      idempotencyKey: `${providerName.toLowerCase()}:${input.providerEventId}`,
      challengeId: input.challengeId,
      metadata: {
        ...input.metadata,
        settlementPolicy: "integer_cents",
        ...(retryCount === undefined ? {} : { retryCount }),
      },
    }).returning();
    return { accepted: true, duplicate: false, ledgerEntryId: entry.id };
  });
}

export type ProviderReportInput = {
  provider?: string;
  providerReportId: string;
  periodStart: Date;
  periodEnd: Date;
  totalCents: number;
  eventCount?: number;
  reportMetadata?: Record<string, unknown>;
};

export async function reconcileProviderReport(input: ProviderReportInput) {
  if (!Number.isInteger(input.totalCents) || input.totalCents < 0) {
    throw new Error("Provider report totals must be non-negative integer cents.");
  }
  if (!Number.isInteger(input.eventCount ?? 0) || (input.eventCount ?? 0) < 0) {
    throw new Error("Provider report event counts must be non-negative integers.");
  }
  if (input.periodEnd <= input.periodStart) throw new Error("Provider report period must have a positive duration.");

  const provider = input.provider ?? providerName;
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(moneyReconciliationRunsTable).where(and(
      eq(moneyReconciliationRunsTable.provider, provider),
      eq(moneyReconciliationRunsTable.providerReportId, input.providerReportId),
    ));
    if (existing) return { ...existing, duplicate: true };

    const entries = await tx.select({
      eventType: walletLedgerEntriesTable.eventType,
      amountCents: walletLedgerEntriesTable.amountCents,
    }).from(walletLedgerEntriesTable).where(and(
      eq(walletLedgerEntriesTable.currency, "usd"),
      isNotNull(walletLedgerEntriesTable.providerEventId),
      gte(walletLedgerEntriesTable.createdAt, input.periodStart),
      lt(walletLedgerEntriesTable.createdAt, input.periodEnd),
    ));
    const ledgerTotalCents = entries.reduce(
      (total, entry) => total + signedLedgerAmountCents(entry.eventType, entry.amountCents),
      0,
    );
    const ledgerEventCount = entries.length;
    const discrepancyCents = input.totalCents - ledgerTotalCents;
    const status = discrepancyCents === 0
      && (input.eventCount === undefined || input.eventCount === ledgerEventCount)
      ? "matched"
      : "mismatch";
    const [run] = await tx.insert(moneyReconciliationRunsTable).values({
      id: `reconciliation_${randomUUID()}`,
      provider,
      providerReportId: input.providerReportId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      providerTotalCents: input.totalCents,
      ledgerTotalCents,
      discrepancyCents,
      providerEventCount: input.eventCount ?? null,
      ledgerEventCount,
      status,
      reportMetadata: input.reportMetadata ?? {},
    }).onConflictDoNothing().returning();
    if (run) return { ...run, duplicate: false };
    const [conflict] = await tx.select().from(moneyReconciliationRunsTable).where(and(
      eq(moneyReconciliationRunsTable.provider, provider),
      eq(moneyReconciliationRunsTable.providerReportId, input.providerReportId),
    ));
    if (!conflict) throw new Error("Reconciliation idempotency conflict could not be recovered.");
    return { ...conflict, duplicate: true };
  });
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