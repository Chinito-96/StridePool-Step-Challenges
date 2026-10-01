/**
 * Development-only signed webhook exercise. These locally signed fixtures are
 * NOT Stripe-issued events and are not sufficient evidence to open paid play.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, moneyReconciliationRunsTable, payoutStatesTable, providerMoneyEventsTable, usersTable, walletLedgerEntriesTable } from "@workspace/db";
import { and, eq, gte, lt } from "drizzle-orm";
import { getStripeWebhookSecret, getUncachableStripeClient } from "../stripeClient";
import { processStripeWebhook } from "./stripe-provider";
import { reconcileProviderReport } from "./ledger";

const amount = 1_000;
const requiredTypes = [
  "payment_intent.succeeded", "payment_intent.payment_failed", "charge.refunded",
  "charge.dispute.created", "charge.dispute.closed", "payout.paid", "payout.failed",
] as const;

async function main() {
  if (process.env.REPLIT_ENVIRONMENT !== "development") {
    throw new Error("Set REPLIT_ENVIRONMENT=development only after confirming the database is development.");
  }
  if (process.env.STRIPE_SANDBOX_RECONCILIATION_PASSED === "true") {
    throw new Error("Turn off the reconciliation gate before running local fixtures.");
  }
  const stripe = await getUncachableStripeClient();
  const providerEvents = await stripe.events.list({ limit: 1 });
  if (!providerEvents.data.length || providerEvents.data[0].livemode) {
    throw new Error("A Stripe test-mode account with at least one event is required.");
  }
  const secret = await getStripeWebhookSecret();
  const suffix = randomUUID().replaceAll("-", "");
  const userId = `sandbox_reconcile_${suffix}`;
  const connectAccountId = `acct_fixture_${suffix}`;
  await db.insert(usersTable).values({ id: userId, stripeConnectAccountId: connectAccountId });

  const metadata = { stridepool_user_id: userId };
  const intent = { id: `pi_fixture_${suffix}`, object: "payment_intent", amount, currency: "usd", status: "succeeded", metadata };
  const charge = {
    id: `ch_fixture_${suffix}`, object: "charge", amount, amount_refunded: 250,
    currency: "usd", status: "succeeded", metadata, payment_intent: intent,
  };
  const dispute = {
    id: `dp_fixture_${suffix}`, object: "dispute", amount: 300, currency: "usd",
    status: "won", metadata, charge,
  };
  const payout = {
    id: `po_fixture_${suffix}`, object: "payout", amount: 500, currency: "usd",
    status: "paid", metadata: {},
  };
  const objects = [
    intent,
    { ...intent, id: `pi_failed_fixture_${suffix}`, status: "requires_payment_method" },
    charge,
    { ...dispute, status: "needs_response" },
    dispute,
    payout,
    { ...payout, status: "failed", failure_code: "account_closed" },
  ];
  const events = requiredTypes.map((type, index) => ({
    id: `evt_fixture_${index}_${suffix}`,
    object: "event",
    api_version: "2026-08-26.dahlia",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type,
    ...(type.startsWith("payout.") ? { account: connectAccountId } : {}),
    data: { object: objects[index] },
  }));
  const started = new Date(Date.now() - 5_000);
  async function deliver(index: number) {
    const payload = JSON.stringify(events[index]);
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
    return processStripeWebhook(Buffer.from(payload), signature);
  }

  // Deliver terminal states before preceding states, and duplicate each event.
  for (const index of [4, 2, 1, 5, 6, 3, 0]) {
    const first = await deliver(index);
    const second = await deliver(index);
    assert.equal(first.ignored, false, `${requiredTypes[index]} was ignored`);
    assert.ok("duplicate" in first);
    assert.ok("duplicate" in second);
    assert.equal(first.duplicate, false, `${requiredTypes[index]} was already recorded`);
    assert.equal(second.duplicate, true, `${requiredTypes[index]} was recorded twice`);
  }

  const ids = events.map((event) => event.id);
  const receipts = await db.select().from(providerMoneyEventsTable);
  const ledgers = await db.select().from(walletLedgerEntriesTable).where(eq(walletLedgerEntriesTable.userId, userId));
  assert.deepEqual(
    receipts.filter((row) => ids.includes(row.providerEventId)).map((row) => row.providerEventId).sort(),
    [...ids].sort(),
  );
  assert.deepEqual(ledgers.map((row) => row.providerEventId).sort(), [...ids].sort());
  const [state] = await db.select().from(payoutStatesTable)
    .where(eq(payoutStatesTable.providerPayoutId, payout.id));
  assert.equal(state.status, "paid", "A late payout failure must not reverse a paid payout.");
  assert.equal(state.retryCount, 0);

  const ended = new Date(Date.now() + 5_000);
  const allPeriodEntries = await db.select().from(walletLedgerEntriesTable)
    .where(and(gte(walletLedgerEntriesTable.createdAt, started), lt(walletLedgerEntriesTable.createdAt, ended)));
  const periodProviderEntries = allPeriodEntries.filter((entry) => entry.providerEventId);
  assert.equal(periodProviderEntries.length, ids.length, "Other provider activity overlaps the fixture window; do not reconcile an ambiguous period.");
  const reportId = `local-fixture-${suffix}`;
  // Expected total comes from the fixed fixture manifest, not the ledger.
  const run = await reconcileProviderReport({
    providerReportId: reportId,
    periodStart: started,
    periodEnd: ended,
    totalCents: amount - 250 - 300 + 300 - 500,
    eventCount: requiredTypes.length,
    reportMetadata: {
      source: "locally_signed_fixture_not_stripe_provider_report",
      eventIds: ids,
      eventTypes: requiredTypes,
    },
  });
  assert.equal(run.status, "matched");
  assert.equal(run.ledgerEventCount, 7);
  assert.equal(run.discrepancyCents, 0);
  const [persisted] = await db.select().from(moneyReconciliationRunsTable)
    .where(eq(moneyReconciliationRunsTable.providerReportId, reportId));
  assert.equal(persisted?.id, run.id);
  console.log(JSON.stringify({
    fixtureOnly: true,
    reportId,
    status: persisted.status,
    eventCount: persisted.ledgerEventCount,
    totalCents: persisted.ledgerTotalCents,
    note: "Locally signed fixtures are not Stripe-issued evidence. Do not enable the launch gate.",
  }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});