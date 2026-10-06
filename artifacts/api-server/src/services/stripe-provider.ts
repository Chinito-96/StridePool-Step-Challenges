import type Stripe from "stripe";
import { runMigrations } from "stripe-replit-sync";
import { activateProviderChallengeEntry, db, qualifyReferralForUser, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  getStripeSync,
  getStripeWebhookSecret,
  getUncachableStripeClient,
  hasStripeWebhookSecret,
  setRuntimeStripeWebhookSecret,
} from "../stripeClient";
import { recordProviderWebhook, refreshProviderReconciliationGate } from "./ledger";
import { openBillingPortal } from "./billing-portal";
import { openPayoutOnboarding } from "./stripe-connect";
import { assertProductionWithdrawalsEnabled } from "./stripe-live-policy";
import {
  isSandboxReconciliationPassed,
  type StripePayoutBalanceTransaction,
} from "./ledger-policy";
import {
  initializeStripeWebhookHealthBaseline,
  processSignedStripeWebhook,
  setStripeWebhookEndpointIdentity,
} from "./stripe-webhook-health";

const providerName = "Stripe";
let providerReady = false;
let webhookReady = false;
let backfillReady = false;

function publicBaseUrl(): string {
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (!domain) throw new Error("A public Replit domain is required for Stripe redirects.");
  return `https://${domain}`;
}

function escapeSearchValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

async function getOrCreateCustomer(
  stripe: Stripe,
  user: typeof usersTable.$inferSelect,
): Promise<string> {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const customer = await stripe.customers.create({
    email: user.email ?? undefined,
    name: user.displayName
      ?? ([user.firstName, user.lastName].filter(Boolean).join(" ") || undefined),
    metadata: { stridepool_user_id: user.id },
  });
  await db.update(usersTable)
    .set({ stripeCustomerId: customer.id })
    .where(eq(usersTable.id, user.id));
  return customer.id;
}

async function getOrCreatePrice(
  stripe: Stripe,
  challenge: typeof import("@workspace/db").challengesTable.$inferSelect,
  amountCents: number,
): Promise<string> {
  const challengeId = escapeSearchValue(challenge.id);
  const amount = String(amountCents);
  const existingPrices = await stripe.prices.search({
    query: `active:'true' AND metadata['stridepool_challenge_id']:'${challengeId}' AND metadata['amount_cents']:'${amount}'`,
    limit: 1,
  });
  if (existingPrices.data[0]) return existingPrices.data[0].id;

  const existingProducts = await stripe.products.search({
    query: `active:'true' AND metadata['stridepool_challenge_id']:'${challengeId}'`,
    limit: 1,
  });
  const product = existingProducts.data[0] ?? await stripe.products.create({
    name: `${challenge.name} entry`,
    description: `${challenge.days}-day StridePool challenge entry`,
    metadata: { stridepool_challenge_id: challenge.id },
  });
  const price = await stripe.prices.create({
    product: product.id,
    currency: "usd",
    unit_amount: amountCents,
    metadata: {
      stridepool_challenge_id: challenge.id,
      amount_cents: amount,
    },
  });
  return price.id;
}

async function getOrCreateProPrice(stripe: Stripe): Promise<string> {
  const existingPrices = await stripe.prices.search({
    query: "active:'true' AND metadata['stridepool_plan']:'pro_monthly'",
    limit: 1,
  });
  if (existingPrices.data[0]) return existingPrices.data[0].id;
  const existingProducts = await stripe.products.search({
    query: "active:'true' AND metadata['stridepool_plan']:'pro'",
    limit: 1,
  });
  const product = existingProducts.data[0] ?? await stripe.products.create({
    name: "StridePool Pro",
    description: "Join up to five challenges and create one active challenge.",
    metadata: { stridepool_plan: "pro" },
  });
  const price = await stripe.prices.create({
    product: product.id,
    currency: "usd",
    unit_amount: 500,
    recurring: { interval: "month" },
    metadata: { stridepool_plan: "pro_monthly" },
  });
  return price.id;
}

export function getStripeProviderStatus() {
  return {
    providerName,
    providerReady,
    webhookReady,
    backfillReady,
    sandboxReconciliationPassed: isSandboxReconciliationPassed(
      process.env.STRIPE_SANDBOX_RECONCILIATION_PASSED === "true",
    ),
  };
}

export async function initializeStripeProvider(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for Stripe.");

  await runMigrations({ databaseUrl });
  await refreshProviderReconciliationGate();
  const stripe = await getUncachableStripeClient();
  const stripeAccount = await stripe.accounts.retrieve(null);
  if (process.env.NODE_ENV === "development" && process.env.STRIPE_SANDBOX_SECRET_KEY) {
    const expectedSandboxAccountId = process.env.STRIPE_SANDBOX_ACCOUNT_ID;
    if (!expectedSandboxAccountId) {
      throw new Error("STRIPE_SANDBOX_ACCOUNT_ID is required when using the development sandbox key.");
    }
    if (stripeAccount.id !== expectedSandboxAccountId) {
      throw new Error("The development Stripe key does not match STRIPE_SANDBOX_ACCOUNT_ID.");
    }
  }
  providerReady = true;

  const stripeSync = await getStripeSync();
  const isSandboxConnectEndpoint =
    process.env.NODE_ENV === "development" && Boolean(process.env.STRIPE_SANDBOX_SECRET_KEY);
  const webhook = await stripeSync.findOrCreateManagedWebhook(
    `${publicBaseUrl()}/api/stripe/webhook`,
    {
      ...(isSandboxConnectEndpoint ? { connect: true } : {}),
      enabled_events: [
        "payment_intent.succeeded",
        "payment_intent.payment_failed",
        "charge.refunded",
        "charge.dispute.created",
        "charge.dispute.closed",
        "payout.paid",
        "payout.failed",
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
      ],
    },
  );
  setStripeWebhookEndpointIdentity(webhook.id, webhook.url, isSandboxConnectEndpoint);
  await initializeStripeWebhookHealthBaseline(webhook.id, webhook.url);
  if (webhook.secret) setRuntimeStripeWebhookSecret(webhook.secret);
  webhookReady = await hasStripeWebhookSecret();
  await stripeSync.syncBackfill();
  backfillReady = true;
}

export async function createStripeCheckout(
  user: typeof usersTable.$inferSelect,
  challenge: typeof import("@workspace/db").challengesTable.$inferSelect,
  amountCents: number,
  challengeEntryCents: number,
  platformFeeCents: number,
  idempotencyKey: string,
) {
  const stripe = await getUncachableStripeClient();
  const customerId = await getOrCreateCustomer(stripe, user);
  const priceId = await getOrCreatePrice(stripe, challenge, amountCents);
  const baseUrl = publicBaseUrl();
  const metadata = {
    stridepool_user_id: user.id,
    stridepool_challenge_id: challenge.id,
    stridepool_idempotency_key: idempotencyKey,
    stridepool_challenge_entry_cents: String(challengeEntryCents),
    stridepool_platform_fee_cents: String(platformFeeCents),
  };
  return stripe.checkout.sessions.create({
    customer: customerId,
    client_reference_id: user.id,
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${baseUrl}/challenge/${encodeURIComponent(challenge.id)}?checkout=success`,
    cancel_url: `${baseUrl}/challenge/${encodeURIComponent(challenge.id)}?checkout=cancelled`,
    metadata,
    payment_intent_data: { metadata },
  }, { idempotencyKey });
}

export async function createStripeProCheckout(
  user: typeof usersTable.$inferSelect,
  idempotencyKey: string,
) {
  const stripe = await getUncachableStripeClient();
  const customerId = await getOrCreateCustomer(stripe, user);
  const priceId = await getOrCreateProPrice(stripe);
  const baseUrl = publicBaseUrl();
  const metadata = {
    stridepool_user_id: user.id,
    stridepool_plan: "pro",
  };
  return stripe.checkout.sessions.create({
    customer: customerId,
    client_reference_id: user.id,
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${baseUrl}/profile?subscription=success`,
    cancel_url: `${baseUrl}/profile?subscription=cancelled`,
    metadata,
    subscription_data: { metadata },
  }, { idempotencyKey });
}

export async function createStripeBillingPortal(user: typeof usersTable.$inferSelect) {
  const stripe = await getUncachableStripeClient();
  return openBillingPortal(stripe, user, `${publicBaseUrl()}/profile?billing=return`);
}

async function applySubscriptionEvent(event: Stripe.Event): Promise<boolean> {
  if (event.type !== "customer.subscription.created"
    && event.type !== "customer.subscription.updated"
    && event.type !== "customer.subscription.deleted") return false;
  const subscription = event.data.object;
  const userId = subscription.metadata.stridepool_user_id;
  if (!userId) return true;
  const active = subscription.status === "active" || subscription.status === "trialing";
  await db.update(usersTable).set({
    stripeSubscriptionId: subscription.id,
    subscriptionStatus: subscription.status,
    membershipPlan: active ? "pro" : "free",
  }).where(eq(usersTable.id, userId));
  return true;
}

export async function createStripePayoutOnboarding(
  user: typeof usersTable.$inferSelect,
  idempotencyKey: string,
) {
  const stripe = await getUncachableStripeClient();
  return openPayoutOnboarding(stripe, user, idempotencyKey, publicBaseUrl(), async (accountId) => {
    await db.update(usersTable).set({ stripeConnectAccountId: accountId })
      .where(eq(usersTable.id, user.id));
  });
}

export async function getStripePayoutAccount(user: typeof usersTable.$inferSelect) {
  if (!user.stripeConnectAccountId) return { linked: false, payoutsEnabled: false };
  const stripe = await getUncachableStripeClient();
  // Accounts v2 interoperates with v1 reads; external bank accounts remain v1.
  const account = await stripe.accounts.retrieve(user.stripeConnectAccountId);
  return {
    linked: Boolean(account.details_submitted && account.external_accounts?.data.length),
    payoutsEnabled: account.payouts_enabled,
  };
}

export async function createStripeWithdrawal(
  user: typeof usersTable.$inferSelect,
  amountCents: number,
  idempotencyKey: string,
) {
  assertProductionWithdrawalsEnabled(process.env);
  if (!user.stripeConnectAccountId) throw new Error("Link a bank account before withdrawing.");
  const stripe = await getUncachableStripeClient();
  const transfer = await stripe.transfers.create({
    amount: amountCents,
    currency: "usd",
    destination: user.stripeConnectAccountId,
    metadata: { stridepool_user_id: user.id, stridepool_idempotency_key: idempotencyKey },
  }, { idempotencyKey: `${idempotencyKey}-transfer` });
  let payout: Stripe.Payout;
  try {
    payout = await stripe.payouts.create({
      amount: amountCents,
      currency: "usd",
      metadata: {
        stridepool_user_id: user.id,
        stridepool_transfer_id: transfer.id,
        stridepool_idempotency_key: idempotencyKey,
      },
    }, {
      stripeAccount: user.stripeConnectAccountId,
      idempotencyKey: `${idempotencyKey}-payout`,
    });
  } catch (error) {
    await stripe.transfers.createReversal(transfer.id, {
      amount: amountCents,
      metadata: { stridepool_user_id: user.id, stridepool_idempotency_key: idempotencyKey },
    }, { idempotencyKey: `${idempotencyKey}-transfer-reversal` });
    throw error;
  }
  return { transferId: transfer.id, payoutId: payout.id };
}

async function metadataFromPaymentIntent(
  stripe: Stripe,
  paymentIntent: string | Stripe.PaymentIntent | null,
  connectedAccountId?: string,
): Promise<Stripe.Metadata> {
  if (!paymentIntent) return {};
  if (typeof paymentIntent !== "string") return paymentIntent.metadata;
  return (await stripe.paymentIntents.retrieve(
    paymentIntent,
    {},
    connectedAccountId ? { stripeAccount: connectedAccountId } : undefined,
  )).metadata;
}

function expandableStripeId(value: string | { id: string } | null | undefined): string | undefined {
  return typeof value === "string" ? value : value?.id;
}

async function getPayoutBalanceTransactions(
  stripe: Stripe,
  payout: Stripe.Payout,
  connectedAccountId: string,
): Promise<StripePayoutBalanceTransaction[]> {
  const transactionIds = [
    expandableStripeId(payout.balance_transaction),
    expandableStripeId(payout.failure_balance_transaction),
  ].filter((id): id is string => Boolean(id));
  const uniqueTransactionIds = [...new Set(transactionIds)];
  const transactions = await Promise.all(uniqueTransactionIds.map((id) =>
    stripe.balanceTransactions.retrieve(id, {}, { stripeAccount: connectedAccountId }),
  ));
  return transactions.map((transaction) => {
    const source = expandableStripeId(transaction.source);
    if (!source) throw new Error("Stripe payout balance transaction is missing its source.");
    return {
      id: transaction.id,
      accountId: connectedAccountId,
      payoutId: payout.id,
      type: transaction.type,
      amountCents: transaction.amount,
      feeCents: transaction.fee,
      netCents: transaction.net,
      currency: transaction.currency,
      source,
      createdAtSeconds: transaction.created,
      status: transaction.status,
      reportingCategory: transaction.reporting_category,
    };
  });
}

async function normalizedStripeEvent(
  event: Stripe.Event,
): Promise<Parameters<typeof recordProviderWebhook>[0] | null> {
  const stripe = await getUncachableStripeClient();
  const connectedAccountId = typeof event.account === "string" ? event.account : undefined;
  let userId: string | undefined;
  let challengeId: string | null = null;
  let amountCents = 0;
  let currency = "usd";
  let metadata: Stripe.Metadata = {};
  let eventType: Parameters<typeof recordProviderWebhook>[0]["eventType"] | null = null;

  if (event.type === "payment_intent.succeeded" || event.type === "payment_intent.payment_failed") {
    const paymentIntent = event.data.object;
    metadata = paymentIntent.metadata;
    userId = metadata.stridepool_user_id;
    challengeId = metadata.stridepool_challenge_id ?? null;
    amountCents = paymentIntent.amount;
    currency = paymentIntent.currency;
    eventType = event.type === "payment_intent.succeeded" ? "payment_succeeded" : "payment_failed";
  } else if (event.type === "charge.refunded") {
    const charge = event.data.object;
    metadata = {
      ...charge.metadata,
      ...await metadataFromPaymentIntent(stripe, charge.payment_intent, connectedAccountId),
    };
    userId = metadata.stridepool_user_id;
    challengeId = metadata.stridepool_challenge_id ?? null;
    amountCents = charge.amount_refunded;
    currency = charge.currency;
    eventType = "refund_issued";
  } else if (event.type === "charge.dispute.created" || event.type === "charge.dispute.closed") {
    const dispute = event.data.object;
    const charge = typeof dispute.charge === "string"
      ? await stripe.charges.retrieve(
        dispute.charge,
        {},
        connectedAccountId ? { stripeAccount: connectedAccountId } : undefined,
      )
      : dispute.charge;
    metadata = {
      ...dispute.metadata,
      ...charge.metadata,
      ...await metadataFromPaymentIntent(stripe, charge.payment_intent, connectedAccountId),
    };
    userId = metadata.stridepool_user_id;
    challengeId = metadata.stridepool_challenge_id ?? null;
    amountCents = dispute.amount;
    currency = dispute.currency;
    eventType = event.type === "charge.dispute.created" ? "dispute_opened" : "dispute_closed";
  } else if (event.type === "payout.paid" || event.type === "payout.failed") {
    const payout = event.data.object;
    const connectedAccountId = typeof event.account === "string" ? event.account : undefined;
    if (!connectedAccountId) return null;
    const [user] = await db.select().from(usersTable)
      .where(eq(usersTable.stripeConnectAccountId, connectedAccountId));
    userId = user?.id;
    amountCents = payout.amount;
    currency = payout.currency;
    const balanceTransactions = await getPayoutBalanceTransactions(
      stripe,
      payout,
      connectedAccountId,
    );
    metadata = {
      stripe_payout_id: payout.id,
      stripe_connect_account_id: connectedAccountId,
      stripe_payout_status: payout.status,
      ...(payout.failure_code ? { stripe_failure_code: payout.failure_code } : {}),
      stripe_balance_transactions: JSON.stringify(balanceTransactions),
      stripe_balance_transaction_ids: balanceTransactions.map(({ id }) => id).join(","),
    };
    eventType = event.type === "payout.paid" ? "payout_succeeded" : "payout_failed";
  }

  if (!eventType || !userId) return null;
  if (currency !== "usd") throw new Error(`Unsupported Stripe currency: ${currency}.`);
  return {
    providerEventId: event.id,
    eventType,
    userId,
    amountCents,
    currency: "usd",
    challengeId,
    metadata: {
      ...metadata,
      stripe_event_type: event.type,
      stripe_livemode: event.livemode,
    },
  };
}

export async function processStripeWebhook(payload: Buffer, signature: string) {
  const stripe = await getUncachableStripeClient();
  const webhookSecret = await getStripeWebhookSecret();
  const event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  return processSignedStripeWebhook(event, async () => {
    if (!event.account) {
      const stripeSync = await getStripeSync();
      await stripeSync.processWebhook(payload, signature);
    }
    if (await applySubscriptionEvent(event)) return { accepted: true, ignored: false };
    const normalized = await normalizedStripeEvent(event);
    if (!normalized) return { accepted: true, ignored: true };
    const recorded = await recordProviderWebhook(normalized);
    if (normalized.eventType === "payment_succeeded" && normalized.challengeId) {
      try {
        const challengeEntryCents = Number(normalized.metadata.stridepool_challenge_entry_cents);
        const platformFeeCents = Number(normalized.metadata.stridepool_platform_fee_cents);
        // Paid Play Terms §5.4: keep the payment intent so refunds can return
        // to the original payment method.
        const paymentIntentId = event.type === "payment_intent.succeeded" ? event.data.object.id : null;
        await activateProviderChallengeEntry(
          normalized.userId,
          normalized.challengeId,
          challengeEntryCents,
          platformFeeCents,
          normalized.amountCents,
          paymentIntentId ?? normalized.providerEventId,
        );
        await qualifyReferralForUser(normalized.userId);
      } catch (error) {
        const paymentIntent = event.type === "payment_intent.succeeded" ? event.data.object.id : undefined;
        if (!paymentIntent) throw error;
        await stripe.refunds.create(
          { payment_intent: paymentIntent, reason: "requested_by_customer" },
          { idempotencyKey: `stridepool-entry-refund-${event.id}` },
        );
        return { ...recorded, ignored: false, entryActivated: false, refunded: true };
      }
    }
    return { ...recorded, ignored: false };
  });
}