export type Allocation = { userId: string; amountCents: number };

/**
 * Split a pool without floating point arithmetic. Sorting the ids makes the
 * one-cent remainder deterministic and independently auditable.
 */
export function allocatePool(poolCents: number, winnerIds: string[]): Allocation[] {
  if (!Number.isInteger(poolCents) || poolCents < 0) throw new Error("Pool must be a non-negative integer number of cents.");
  if (!winnerIds.length) return [];
  const orderedIds = [...new Set(winnerIds)].sort();
  const base = Math.floor(poolCents / orderedIds.length);
  const remainder = poolCents % orderedIds.length;
  return orderedIds.map((userId, index) => ({ userId, amountCents: base + (index < remainder ? 1 : 0) }));
}

export function refundAmount(poolCents: number, entryCents: number) {
  if (!Number.isInteger(poolCents) || !Number.isInteger(entryCents)) throw new Error("Refund amounts must be integer cents.");
  return Math.max(0, Math.min(poolCents, entryCents));
}

export function nextPayoutRetry(retryCount: number) {
  if (!Number.isInteger(retryCount) || retryCount < 0) throw new Error("Retry count must be a non-negative integer.");
  return { retryCount: retryCount + 1, status: "retry_pending" as const };
}