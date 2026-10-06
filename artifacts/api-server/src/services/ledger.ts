import { randomUUID } from "node:crypto";
import type {
  CheckoutInput,
  EligibilityInput,
  LedgerEntry,
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
  paidEntryBlocks,
  withdrawalBlocks,
  MINIMUM_WITHDRAWAL_CENTS as POLICY_MINIMUM_WITHDRAWAL_CENTS,
} from "@workspace/db";
import { and, desc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import {
  payoutBalanceMovements,
  payoutBalanceTransactionKey,
  projectPayoutEvent,
  setProviderReconciliationMismatch,
  signedLedgerAmountCents,
  type StripePayoutBalanceTransaction,
} from "./ledger-policy";
import {
  checkEligibility as checkLaunchEligibility,
  getComplianceStatus as buildComplianceStatus,
  isPaidPlayLaunchEnabled,
  type LaunchEnvironment,
  type LaunchProviderStatus,
} from "./ledger-launch-policy";
import {
  createStripeCheckout,
  createStripePayoutOnboarding,
  createStripeProCheckout,
  createStripeBillingPortal,
  createStripeWithdrawal,
  getStripePayoutAccount,
  getStripeProviderStatus,
} from "./stripe-provider";
import { hasCurrentPaidTermsAcceptance } from "./eligibility-consent";
import { assertProductionWithdrawalsEnabled } from "./stripe-live-policy";

const providerName = "Stripe";
export const MINIMUM_WITHDRAWAL_CENTS = POLICY_MINIMUM_WITHDRAWAL_CENTS;
export { isPaidPlayLaunchEnabled };

export function getComplianceStatus(
  provider: LaunchProviderStatus = getStripeProviderStatus(),
  environment: LaunchEnvironment = process.env,
) {
  return buildComplianceStatus(provider, environment);
}

export function checkEligibility(
  input: EligibilityInput,
  provider?: LaunchProviderStatus,
  environment?: LaunchEnvironment,
) {
  return checkLaunchEligibility(
    input,
    provider ?? getStripeProviderStatus(),
    environment ?? process.env,
  );
}

/** Paid Play Terms §12.3: a user-set weekly cap on paid entry spending. */
export async function assertWithinWeeklyEntryLimit(
  user: typeof usersTable.$inferSelect,
  newEntryTotalCents: number,
  now = new Date(),
): Promise<void> {
  const limit = user.paidPlayWeeklyEntryLimitCents;
  if (limit === null || limit === undefined) return;
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const [spent] = await db.select({
    cents: sql<number>`coalesce(sum(round(${entriesTable.entryFee} * 100) + ${entriesTable.platformFeeCents}), 0)`,
  }).from(entriesTable).where(and(
    eq(entriesTable.userId, user.id),
    gte(entriesTable.joinedAt, since),
    isNotNull(entriesTable.paymentReference),
  ));
  if (Number(spent?.cents ?? 0) + newEntryTotalCents > limit) {
    throw new Error(`This entry would exceed your weekly paid-entry limit of $${(limit / 100).toFixed(2)}.`);
  }
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
    // Client-editable legacy profile values cannot authorize real-money play.
    // Keep this closed until server-verified provider identity evidence is integrated.
    identityStatus: "not_started",
    acceptedTerms: hasCurrentPaidTermsAcceptance(user),
  });
  if (!eligibility.eligible) {
    throw new Error(eligibility.reasons.join(" "));
  }
  // Paid Play Terms §1.2, §9.6, §12.3, §13.3: account-level blocks.
  const accountBlocks = paidEntryBlocks(user);
  if (accountBlocks.length) throw new Error(accountBlocks.join(" "));
  if (user.accountClosedAt) throw new Error("This account is closed.");
  await assertWithinWeeklyEntryLimit(user, totalCents);
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

/** Refunds credited to the wallet (§5.4 fallback) that have not yet been withdrawn below the minimum. */
export async function unwithdrawnRefundCreditCents(userId: string): Promise<number> {
  const entries = await db.select().from(walletLedgerEntriesTable).where(and(
    eq(walletLedgerEntriesTable.userId, userId),
    inArray(walletLedgerEntriesTable.eventType, ["refund_wallet_credit", "withdrawal_requested"]),
  ));
  const credited = entries
    .filter((entry) => entry.eventType === "refund_wallet_credit")
    .reduce((sum, entry) => sum + entry.amountCents, 0);
  const usedBelowMinimum = entries
    .filter((entry) => entry.eventType === "withdrawal_requested" && entry.metadata.purpose === "refund_credit" && entry.status !== "provider_failed")
    .reduce((sum, entry) => sum + entry.amountCents, 0);
  return Math.max(0, credited - usedBelowMinimum);
}

type WithdrawalDependencies = {
  getPayoutAccount: typeof getStripePayoutAccount;
  createWithdrawal: typeof createStripeWithdrawal;
};

export async function withdrawAvailableBalance(
  userId: string,
  input: WithdrawalInput,
  dependencies: WithdrawalDependencies = {
    getPayoutAccount: getStripePayoutAccount,
    createWithdrawal: createStripeWithdrawal,
  },
) {
  // Reject before reserving wallet funds or contacting Stripe.
  assertProductionWithdrawalsEnabled(process.env);
  const amountCents = input.amountCents;
  const purpose = input.purpose ?? "standard";
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new Error("Withdrawal amount must be a positive whole number of cents.");
  }
  const existingResult = (entry: typeof walletLedgerEntriesTable.$inferSelect) => {
    if (entry.amountCents !== amountCents) {
      throw new Error("This withdrawal request key was already used for a different amount.");
    }
    if (entry.status === "provider_failed") {
      throw new Error("This withdrawal already failed. Submit a new request to retry.");
    }
    return {
      withdrawalId: String(entry.metadata.payoutId ?? entry.id),
      amountCents: entry.amountCents,
      status: "pending" as const,
      provider: providerName,
    };
  };
  const existing = await db.select().from(walletLedgerEntriesTable).where(and(
    eq(walletLedgerEntriesTable.userId, userId),
    eq(walletLedgerEntriesTable.idempotencyKey, input.idempotencyKey),
  ));
  if (existing[0]) return existingResult(existing[0]);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) throw new Error("Account was not found.");
  const availableCents = Math.round(Number(user.walletBalance) * 100);
  if (amountCents > availableCents) {
    throw new Error("Requested withdrawal exceeds your available wallet balance.");
  }
  // Paid Play Terms §6.3/§6.4: the $20 minimum does not apply to wallet
  // refund credits or to the full-balance payout when an account closes.
  if (amountCents < MINIMUM_WITHDRAWAL_CENTS) {
    if (purpose === "account_closure") {
      if (amountCents !== availableCents) throw new Error("An account-closure payout must withdraw the full available balance.");
    } else if (purpose === "refund_credit") {
      const refundCredits = await unwithdrawnRefundCreditCents(userId);
      if (amountCents > refundCredits) throw new Error("Only wallet refund credits can be withdrawn below the $20.00 minimum.");
    } else {
      throw new Error("Withdrawal amount must be at least $20.00 in whole cents.");
    }
  }
  // Paid Play Terms §1.2: withdrawals are requested from a permitted state.
  // Closure payouts return money already owed, so they are not blocked.
  if (purpose !== "account_closure") {
    const blocks = withdrawalBlocks(user);
    if (blocks.length) throw new Error(blocks.join(" "));
  }
  const account = await dependencies.getPayoutAccount(user);
  if (!account.linked || !account.payoutsEnabled) {
    throw new Error("Link and verify a bank account before withdrawing.");
  }
  const ledgerId = `ledger_${randomUUID()}`;
  const reservation = await db.transaction(async (tx) => {
    const [lockedUser] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).for("update");
    const [racedEntry] = await tx.select().from(walletLedgerEntriesTable).where(and(
      eq(walletLedgerEntriesTable.userId, userId),
      eq(walletLedgerEntriesTable.idempotencyKey, input.idempotencyKey),
    )).for("update");
    if (racedEntry) {
      return { existing: racedEntry };
    }
    const lockedAmountCents = Math.round(Number(lockedUser?.walletBalance ?? 0) * 100);
    if (!lockedUser || lockedAmountCents < amountCents) {
      throw new Error("Available balance changed or is too low for the requested withdrawal.");
    }
    await tx.update(usersTable).set({
      walletBalance: ((lockedAmountCents - amountCents) / 100).toFixed(2),
    }).where(eq(usersTable.id, userId));
    await tx.insert(walletLedgerEntriesTable).values({
      id: ledgerId,
      userId,
      eventType: "withdrawal_requested",
      status: "pending_provider",
      amountCents,
      currency: "usd",
      providerEventId: null,
      idempotencyKey: input.idempotencyKey,
      challengeId: null,
      metadata: {
        auditRule: "available wallet balance reserved before provider payout reconciliation",
        purpose,
      },
    });
    return { reservedAmountCents: amountCents };
  });
  if ("existing" in reservation && reservation.existing) return existingResult(reservation.existing);
  if (!("reservedAmountCents" in reservation)) {
    throw new Error("Withdrawal reservation could not be completed.");
  }
  const reservedAmountCents = reservation.reservedAmountCents;
  let withdrawal: Awaited<ReturnType<typeof createStripeWithdrawal>>;
  try {
    withdrawal = await dependencies.createWithdrawal(user, reservedAmountCents, input.idempotencyKey);
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
      purpose,
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
      const providerStatus = typeof input.metadata.stripe_payout_status === "string"
        ? input.metadata.stripe_payout_status
        : undefined;
      const initialProjection = projectPayoutEvent(
        undefined,
        input.eventType,
        input.providerEventId,
        providerStatus,
      );
      const isSuccess = initialProjection.status === "paid";
      const alreadyPaidAuthoritatively = sql`(
        ${payoutStatesTable.status} = 'paid'
        and ${payoutStatesTable.metadata}->>'stripe_payout_status' is distinct from 'failed'
      )`;
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
          status: sql`case when ${alreadyPaidAuthoritatively} then 'paid' when ${isSuccess} then 'paid' else 'retry_pending' end`,
          retryCount: sql`case when ${alreadyPaidAuthoritatively} then ${payoutStatesTable.retryCount} when ${isSuccess} then ${payoutStatesTable.retryCount} else ${payoutStatesTable.retryCount} + 1 end`,
          lastProviderEventId: sql`case when ${alreadyPaidAuthoritatively} then ${payoutStatesTable.lastProviderEventId} else ${input.providerEventId} end`,
          metadata: sql`case when ${alreadyPaidAuthoritatively} then ${payoutStatesTable.metadata} else ${payoutStatesTable.metadata} || ${JSON.stringify(input.metadata)}::jsonb end`,
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

    const rawBalanceTransactions = input.metadata.stripe_balance_transactions;
    if (rawBalanceTransactions !== undefined) {
      let parsedBalanceTransactions: unknown = rawBalanceTransactions;
      if (typeof rawBalanceTransactions === "string") {
        try {
          parsedBalanceTransactions = JSON.parse(rawBalanceTransactions) as unknown;
        } catch {
          throw new Error("Stripe payout balance transaction data is invalid.");
        }
      }
      if (!Array.isArray(parsedBalanceTransactions)) {
        throw new Error("Stripe payout balance transaction data is invalid.");
      }
      const movements = payoutBalanceMovements(
        parsedBalanceTransactions as StripePayoutBalanceTransaction[],
      );
      if (movements.length) {
        await tx.insert(walletLedgerEntriesTable).values(movements.map((movement) => ({
          id: `ledger_${randomUUID()}`,
          userId: input.userId,
          eventType: movement.eventType,
          status: "recorded",
          amountCents: movement.amountCents,
          currency: movement.transaction.currency,
          providerEventId: null,
          idempotencyKey: movement.idempotencyKey,
          challengeId: null,
          metadata: {
            stripe_balance_transaction_id: movement.transaction.id,
            stripe_balance_transaction_type: movement.transaction.type,
            stripe_payout_id: movement.transaction.payoutId,
            stripe_connect_account_id: movement.transaction.accountId,
            stripe_balance_transaction_amount_cents: movement.transaction.amountCents,
            stripe_balance_transaction_fee_cents: movement.transaction.feeCents,
            stripe_balance_transaction_net_cents: movement.transaction.netCents,
            stripe_balance_transaction_created: movement.transaction.createdAtSeconds,
            stripe_balance_transaction_reporting_category: movement.transaction.reportingCategory,
            settlementPolicy: "stripe_balance_transaction",
          },
        }))).onConflictDoNothing();
      }
    }

    return { accepted: true, duplicate: false, ledgerEntryId: entry.id };
  });
}

export async function refreshProviderReconciliationGate(provider = providerName): Promise<void> {
  const runs = await db.select({
    id: moneyReconciliationRunsTable.id,
    status: moneyReconciliationRunsTable.status,
    periodStart: moneyReconciliationRunsTable.periodStart,
    periodEnd: moneyReconciliationRunsTable.periodEnd,
    createdAt: moneyReconciliationRunsTable.createdAt,
  })
    .from(moneyReconciliationRunsTable)
    .where(eq(moneyReconciliationRunsTable.provider, provider))
    .orderBy(desc(moneyReconciliationRunsTable.createdAt), desc(moneyReconciliationRunsTable.id));
  const hasUnresolvedMismatch = runs.some((mismatch) =>
    mismatch.status === "mismatch"
    && !runs.some((match) =>
      match.status === "matched"
      && match.id !== mismatch.id
      && match.periodStart.getTime() === mismatch.periodStart.getTime()
      && match.periodEnd.getTime() === mismatch.periodEnd.getTime()
      && match.createdAt.getTime() >= mismatch.createdAt.getTime(),
    ),
  );
  setProviderReconciliationMismatch(hasUnresolvedMismatch);
}

export type ProviderBalanceTransactionReportItem = {
  id: string;
  accountId: string;
  netCents: number;
};

export type ProviderReportInput = {
  provider?: string;
  providerReportId: string;
  periodStart: Date;
  periodEnd: Date;
  totalCents: number;
  eventCount?: number;
  balanceTransactions?: ProviderBalanceTransactionReportItem[];
  reportMetadata?: Record<string, unknown>;
};

export async function reconcileProviderReport(input: ProviderReportInput) {
  const balanceTransactions = input.balanceTransactions;
  if (!Number.isInteger(input.totalCents)
    || (!balanceTransactions && input.totalCents < 0)) {
    throw new Error("Provider report totals must be integer cents.");
  }
  if (!Number.isInteger(input.eventCount ?? 0) || (input.eventCount ?? 0) < 0) {
    throw new Error("Provider report event counts must be non-negative integers.");
  }
  if (input.periodEnd <= input.periodStart) throw new Error("Provider report period must have a positive duration.");
  if (balanceTransactions) {
    const identities = balanceTransactions.map(({ accountId, id }) =>
      payoutBalanceTransactionKey(accountId, id),
    );
    if (!balanceTransactions.length || new Set(identities).size !== identities.length) {
      throw new Error("Provider balance transaction reports must contain unique transaction ids.");
    }
    if (balanceTransactions.some(({ netCents }) => !Number.isInteger(netCents))) {
      throw new Error("Provider balance transaction report amounts must be whole cents.");
    }
    const reportedTotal = balanceTransactions.reduce((sum, transaction) =>
      sum + transaction.netCents, 0,
    );
    if (reportedTotal !== input.totalCents) {
      throw new Error("Provider report total does not equal its balance transaction rows.");
    }
    if (input.eventCount !== undefined && input.eventCount !== balanceTransactions.length) {
      throw new Error("Provider report count does not match its balance transaction rows.");
    }
  }

  const provider = input.provider ?? providerName;
  const run = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(moneyReconciliationRunsTable).where(and(
      eq(moneyReconciliationRunsTable.provider, provider),
      eq(moneyReconciliationRunsTable.providerReportId, input.providerReportId),
    ));
    if (existing) return { ...existing, duplicate: true };

    const entries = await tx.select({
      eventType: walletLedgerEntriesTable.eventType,
      amountCents: walletLedgerEntriesTable.amountCents,
      metadata: walletLedgerEntriesTable.metadata,
    }).from(walletLedgerEntriesTable).where(and(
      eq(walletLedgerEntriesTable.currency, "usd"),
      ...(balanceTransactions
        ? [inArray(
          walletLedgerEntriesTable.idempotencyKey,
          balanceTransactions.map(({ accountId, id }) => payoutBalanceTransactionKey(accountId, id)),
        )]
        : [
          isNotNull(walletLedgerEntriesTable.providerEventId),
          gte(walletLedgerEntriesTable.createdAt, input.periodStart),
          lt(walletLedgerEntriesTable.createdAt, input.periodEnd),
        ]),
    ));
    const ledgerTotalCents = entries.reduce(
      (total, entry) => total + signedLedgerAmountCents(
        entry.eventType,
        entry.amountCents,
        entry.metadata,
      ),
      0,
    );
    const ledgerEventCount = entries.length;
    const discrepancyCents = input.totalCents - ledgerTotalCents;
    const status = discrepancyCents === 0
      && ((input.eventCount ?? balanceTransactions?.length) === undefined
        || (input.eventCount ?? balanceTransactions?.length) === ledgerEventCount)
      ? "matched"
      : "mismatch";
    const reportMetadata = {
      ...(input.reportMetadata ?? {}),
      ...(balanceTransactions ? {
        reconciliationBasis: "stripe_balance_transactions",
        stripeBalanceTransactionIds: balanceTransactions.map(({ id }) => id),
      } : {}),
    };
    const [run] = await tx.insert(moneyReconciliationRunsTable).values({
      id: `reconciliation_${randomUUID()}`,
      provider,
      providerReportId: input.providerReportId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      providerTotalCents: input.totalCents,
      ledgerTotalCents,
      discrepancyCents,
      providerEventCount: input.eventCount ?? balanceTransactions?.length ?? null,
      ledgerEventCount,
      status,
      reportMetadata,
    }).onConflictDoNothing().returning();
    if (run) return { ...run, duplicate: false };
    const [conflict] = await tx.select().from(moneyReconciliationRunsTable).where(and(
      eq(moneyReconciliationRunsTable.provider, provider),
      eq(moneyReconciliationRunsTable.providerReportId, input.providerReportId),
    ));
    if (!conflict) throw new Error("Reconciliation idempotency conflict could not be recovered.");
    return { ...conflict, duplicate: true };
  });
  await refreshProviderReconciliationGate(provider);
  return run;
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