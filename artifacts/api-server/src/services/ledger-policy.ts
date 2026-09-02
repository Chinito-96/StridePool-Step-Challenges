export type PayoutStatus = "retry_pending" | "paid";

export type PayoutProjection = {
  status: PayoutStatus;
  retryCount: number;
  lastProviderEventId: string;
};

/**
 * Provider delivery order is not guaranteed. A successful payout is terminal
 * for the projection, while every failed delivery before success increments
 * the retry count exactly once (the receipt table handles duplicate delivery).
 */
export function projectPayoutEvent(
  current: PayoutProjection | undefined,
  eventType: "payout_succeeded" | "payout_failed",
  providerEventId: string,
): PayoutProjection {
  if (current?.status === "paid") return current;
  if (eventType === "payout_succeeded") {
    return {
      status: "paid",
      retryCount: current?.retryCount ?? 0,
      lastProviderEventId: providerEventId,
    };
  }
  return {
    status: "retry_pending",
    retryCount: (current?.retryCount ?? 0) + 1,
    lastProviderEventId: providerEventId,
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