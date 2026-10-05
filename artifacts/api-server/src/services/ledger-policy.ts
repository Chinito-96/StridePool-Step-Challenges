export type PayoutStatus = "retry_pending" | "paid";

export type PayoutProjection = {
  status: PayoutStatus;
  retryCount: number;
  lastProviderEventId: string;
  providerStatus?: string;
};

export type StripePayoutBalanceTransaction = {
  id: string;
  accountId: string;
  payoutId: string;
  type: string;
  amountCents: number;
  feeCents: number;
  netCents: number;
  currency: string;
  source: string;
  createdAtSeconds: number;
  status: string;
  reportingCategory: string;
};

export type PayoutBalanceMovement = {
  idempotencyKey: string;
  eventType: "payout_balance_debit" | "payout_balance_reversal";
  amountCents: number;
  transaction: StripePayoutBalanceTransaction;
};

let providerReconciliationMismatch = false;

export function setProviderReconciliationMismatch(mismatch: boolean): void {
  providerReconciliationMismatch = mismatch;
}

export function hasProviderReconciliationMismatch(): boolean {
  return providerReconciliationMismatch;
}

export function isSandboxReconciliationPassed(manualApproval: boolean): boolean {
  return manualApproval && !providerReconciliationMismatch;
}

export function payoutBalanceTransactionKey(accountId: string, transactionId: string): string {
  if (!accountId || !transactionId) {
    throw new Error("Stripe balance transaction identity is incomplete.");
  }
  return `stripe:balance_transaction:${accountId}:${transactionId}`;
}

/**
 * A payout's signed events are receipts, not money movement. The linked
 * Stripe balance transactions are the authoritative debit and reversal.
 */
export function payoutBalanceMovements(
  transactions: StripePayoutBalanceTransaction[],
): PayoutBalanceMovement[] {
  const movements = new Map<string, PayoutBalanceMovement>();
  for (const transaction of transactions) {
    if (!transaction.id || !transaction.accountId || !transaction.payoutId) {
      throw new Error("Stripe payout balance transaction identity is incomplete.");
    }
    if (transaction.currency !== "usd" || transaction.source !== transaction.payoutId) {
      throw new Error("Stripe payout balance transaction does not match the payout.");
    }
    if (!Number.isInteger(transaction.netCents) || transaction.netCents === 0) {
      throw new Error("Stripe payout balance transaction must have a non-zero whole-cent net.");
    }

    let eventType: PayoutBalanceMovement["eventType"];
    if (transaction.type === "payout" && transaction.netCents < 0) {
      eventType = "payout_balance_debit";
    } else if (transaction.type === "payout_failure" && transaction.netCents > 0) {
      eventType = "payout_balance_reversal";
    } else {
      throw new Error(`Unsupported Stripe payout balance transaction type: ${transaction.type}.`);
    }

    const idempotencyKey = payoutBalanceTransactionKey(transaction.accountId, transaction.id);
    const movement = {
      idempotencyKey,
      eventType,
      amountCents: Math.abs(transaction.netCents),
      transaction,
    };
    const existing = movements.get(idempotencyKey);
    if (existing) {
      if (existing.eventType !== movement.eventType
        || existing.amountCents !== movement.amountCents
        || existing.transaction.payoutId !== transaction.payoutId) {
        throw new Error("Stripe returned conflicting data for a balance transaction.");
      }
      continue;
    }
    movements.set(idempotencyKey, movement);
  }
  return [...movements.values()].sort(
    (left, right) => left.transaction.createdAtSeconds - right.transaction.createdAtSeconds
      || left.idempotencyKey.localeCompare(right.idempotencyKey),
  );
}

/**
 * Provider delivery order is not guaranteed. Stripe's object status determines
 * the projection when present; a genuinely paid payout is terminal, while
 * distinct failed event receipts increment the retry count.
 */
export function projectPayoutEvent(
  current: PayoutProjection | undefined,
  eventType: "payout_succeeded" | "payout_failed",
  providerEventId: string,
  providerStatus?: string,
): PayoutProjection {
  // The immutable event name can disagree with Stripe's payout snapshot.
  // Use the provider's final object status for the projection, not the name.
  const projectionEventType = providerStatus === "failed"
    ? "payout_failed"
    : providerStatus === "paid"
      ? "payout_succeeded"
      : eventType;
  if (current?.status === "paid" && current.providerStatus !== "failed") return current;
  if (projectionEventType === "payout_succeeded") {
    return {
      status: "paid",
      retryCount: current?.retryCount ?? 0,
      lastProviderEventId: providerEventId,
      providerStatus,
    };
  }
  return {
    status: "retry_pending",
    retryCount: (current?.retryCount ?? 0) + 1,
    lastProviderEventId: providerEventId,
    providerStatus,
  };
}

export function signedLedgerAmountCents(
  eventType: string,
  amountCents: number,
  metadata: Record<string, unknown> = {},
): number {
  switch (eventType) {
    case "refund_issued":
    case "dispute_opened":
      return -amountCents;
    case "payout_succeeded":
      // Old event-only records remain readable. Once a status or transaction
      // snapshot is present, payout movement comes only from balance entries.
      if (metadata.stripe_payout_status === "failed") return 0;
      if (typeof metadata.stripe_balance_transaction_ids === "string"
        && metadata.stripe_balance_transaction_ids.length > 0) return 0;
      if (Array.isArray(metadata.stripe_balance_transactions)
        && metadata.stripe_balance_transactions.length > 0) return 0;
      return -amountCents;
    case "payout_balance_debit":
      return -amountCents;
    case "payout_balance_reversal":
      return amountCents;
    case "payment_failed":
    case "payout_failed":
      return 0;
    default:
      return amountCents;
  }
}