import { randomUUID } from "node:crypto";
import { cancelChallengeWithRefunds, db, findUnderFilledPaidChallenges, usersTable, walletLedgerEntriesTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

/**
 * Paid Play Terms §5.4: refunds go to the original payment method. If that is
 * not possible, the refund is credited to the wallet as a "refund_wallet_credit",
 * which can be withdrawn without the $20 minimum (§6.3).
 *
 * Settlement and leave transactions write "entry_refund_requested" rows with
 * status "pending_provider"; this processor turns them into provider refunds.
 */

export type ProviderRefundOutcome =
  | { kind: "submitted"; refundId: string }
  | { kind: "cannot_refund_to_card"; reason: string }
  | { kind: "retry_later"; reason: string };

export type RefundDependencies = {
  refundToCard: (input: { paymentIntentId: string; amountCents: number; ledgerId: string }) => Promise<ProviderRefundOutcome>;
};

/** Stripe error codes meaning the card can never receive this refund. */
const NON_RETRYABLE_CODES = new Set([
  "charge_expired_for_refund",
  "charge_already_refunded",
  "charge_disputed",
  "resource_missing",
]);

export function classifyStripeRefundError(error: unknown): ProviderRefundOutcome {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  if (NON_RETRYABLE_CODES.has(code)) return { kind: "cannot_refund_to_card", reason: code };
  return { kind: "retry_later", reason: code || (error instanceof Error ? error.message : "unknown") };
}

export const stripeRefundDependencies: RefundDependencies = {
  async refundToCard({ paymentIntentId, amountCents, ledgerId }) {
    const { getUncachableStripeClient } = await import("../stripeClient");
    const stripe = await getUncachableStripeClient();
    try {
      const refund = await stripe.refunds.create(
        {
          payment_intent: paymentIntentId,
          amount: amountCents,
          reason: "requested_by_customer",
          metadata: { stridepool_ledger_id: ledgerId, stridepool_policy: "paid_play_terms_5_3" },
        },
        { idempotencyKey: `stridepool-terms-refund-${ledgerId}` },
      );
      return { kind: "submitted", refundId: refund.id };
    } catch (error) {
      return classifyStripeRefundError(error);
    }
  },
};

export type RefundPassResult = { found: number; submitted: number; walletCredited: number; retrying: number };

export async function processPendingEntryRefunds(
  dependencies: RefundDependencies = stripeRefundDependencies,
  limit = 50,
): Promise<RefundPassResult> {
  const pending = await db.select().from(walletLedgerEntriesTable).where(and(
    eq(walletLedgerEntriesTable.eventType, "entry_refund_requested"),
    eq(walletLedgerEntriesTable.status, "pending_provider"),
  )).limit(limit);
  const result: RefundPassResult = { found: pending.length, submitted: 0, walletCredited: 0, retrying: 0 };

  for (const row of pending) {
    const reference = typeof row.metadata.paymentReference === "string" ? row.metadata.paymentReference : "";
    const outcome: ProviderRefundOutcome = reference.startsWith("pi_")
      ? await dependencies.refundToCard({ paymentIntentId: reference, amountCents: row.amountCents, ledgerId: row.id })
      : { kind: "cannot_refund_to_card", reason: "no_payment_intent_reference" };

    if (outcome.kind === "submitted") {
      await db.update(walletLedgerEntriesTable).set({
        status: "submitted_to_provider",
        metadata: { ...row.metadata, stripeRefundId: outcome.refundId },
      }).where(and(eq(walletLedgerEntriesTable.id, row.id), eq(walletLedgerEntriesTable.status, "pending_provider")));
      result.submitted += 1;
      continue;
    }

    if (outcome.kind === "cannot_refund_to_card") {
      await db.transaction(async (tx) => {
        const [claimed] = await tx.update(walletLedgerEntriesTable).set({
          status: "wallet_fallback",
          metadata: { ...row.metadata, fallbackReason: outcome.reason },
        }).where(and(eq(walletLedgerEntriesTable.id, row.id), eq(walletLedgerEntriesTable.status, "pending_provider"))).returning();
        if (!claimed) return;
        await tx.update(usersTable).set({
          walletBalance: sql`${usersTable.walletBalance} + ${(row.amountCents / 100).toFixed(2)}`,
        }).where(eq(usersTable.id, row.userId));
        await tx.insert(walletLedgerEntriesTable).values({
          id: `ledger_refund_credit_${randomUUID()}`,
          userId: row.userId,
          eventType: "refund_wallet_credit",
          status: "recorded",
          amountCents: row.amountCents,
          currency: "usd",
          idempotencyKey: `refund_wallet_credit:${row.id}`,
          challengeId: row.challengeId,
          metadata: { source: "paid_play_terms_5_4_fallback", refundRequestId: row.id, reason: outcome.reason },
        }).onConflictDoNothing();
      });
      result.walletCredited += 1;
      continue;
    }

    const attempts = Number(row.metadata.refundAttempts ?? 0) + 1;
    await db.update(walletLedgerEntriesTable).set({
      metadata: { ...row.metadata, refundAttempts: attempts, lastRefundError: outcome.reason },
    }).where(eq(walletLedgerEntriesTable.id, row.id));
    logger.warn({ ledgerId: row.id, attempts, reason: outcome.reason }, "Entry refund will be retried");
    result.retrying += 1;
  }
  return result;
}

export function startEntryRefundScheduler(intervalMs = 60_000): NodeJS.Timeout {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      // §4.5: cancel under-filled paid challenges at their start time first,
      // so their refund requests are picked up in the same pass.
      for (const challengeId of await findUnderFilledPaidChallenges()) {
        const cancelled = await cancelChallengeWithRefunds(challengeId, "challenge_under_filled");
        if (cancelled.cancelled) logger.info(cancelled, "Under-filled challenge cancelled and refunded");
      }
      const result = await processPendingEntryRefunds();
      if (result.found > 0) logger.info(result, "Entry refund pass completed");
    } catch (err) {
      logger.error({ err }, "Entry refund pass failed");
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), intervalMs);
  timer.unref();
  return timer;
}
