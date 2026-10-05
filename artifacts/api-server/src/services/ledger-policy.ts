export type PayoutStatus = "retry_pending" | "paid";

export type PayoutProjection = {
  status: PayoutStatus;
  retryCount: number;
  lastProviderEventId: string;
  providerStatus?: string;
};

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

export function signedLedgerAmountCents(eventType: string, amountCents: number): number {
  switch (eventType) {
    case "refund_issued":
    case "dispute_opened":
    case "payout_succeeded":
      return -amountCents;
    case "payment_failed":
    case "payout_failed":
      return 0;
    default:
      return amountCents;
  }
}