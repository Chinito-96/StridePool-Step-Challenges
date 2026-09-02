import type Stripe from "stripe";
import { runMigrations } from "stripe-replit-sync";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  getStripeSync,
  getStripeWebhookSecret,
  getUncachableStripeClient,
  hasStripeWebhookSecret,
  setRuntimeStripeWebhookSecret,
} from "../stripeClient";
import { recordProviderWebhook } from "./ledger";

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

export function getStripeProviderStatus() {
  return {
    providerName,
    providerReady,
    webhookReady,
    backfillReady,
    sandboxReconciliationPassed:
      process.env.STRIPE_SANDBOX_RECONCILIATION_PASSED === "true",
  };
}

export async function initializeStripeProvider(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for Stripe.");

  await runMigrations({ databaseUrl });
  const stripe = await getUncachableStripeClient();
  await stripe.accounts.retrieve(null);
  providerReady = true;

  const stripeSync = await getStripeSync();
  const webhook = await stripeSync.findOrCreateManagedWebhook(
    `${publicBaseUrl()}/api/stripe/webhook`,
    {
      enabled_events: [
        "payment_intent.succeeded",
        "payment_intent.payment_failed",
        "charge.refunded",
        "charge.dispute.created",
        "charge.dispute.closed",
        "payout.paid",
        "payout.failed",
      ],
    },
  );
  if (webhook.secret) setRuntimeStripeWebhookSecret(webhook.secret);
  webhookReady = await hasStripeWebhookSecret();
  await stripeSync.syncBackfill();
  backfillReady = true;
}

export async function createStripeCheckout(
  user: typeof usersTable.$inferSelect,
  challenge: typeof import("@workspace/db").challengesTable.$inferSelect,
  amountCents: number,
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

export async function createStripePayoutOnboarding(
  user: typeof usersTable.$inferSelect,
  idempotencyKey: string,
) {
  const stripe = await getUncachableStripeClient();
  let accountId = user.stripeConnectAccountId;
  if (!accountId) {
    const account = await stripe.accounts.create({
      type: "express",
      country: "US",
      email: user.email ?? undefined,
      capabilities: {
        transfers: { requested: true },
      },
      metadata: { stridepool_user_id: user.id },
    }, { idempotencyKey: `${idempotencyKey}-account` });
    accountId = account.id;
    await db.update(usersTable)
      .set({ stripeConnectAccountId: accountId })
      .where(eq(usersTable.id, user.id));
  }

  const baseUrl = publicBaseUrl();
  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    collect: "eventually_due",
    refresh_url: `${baseUrl}/wallet?onboarding=refresh`,
    return_url: `${baseUrl}/wallet?onboarding=return`,
  });
  return { accountId, accountLink };
}

async function metadataFromPaymentIntent(
  stripe: Stripe,
  paymentIntent: string | Stripe.PaymentIntent | null,
): Promise<Stripe.Metadata> {
  if (!paymentIntent) return {};
  if (typeof paymentIntent !== "string") return paymentIntent.metadata;
  return (await stripe.paymentIntents.retrieve(paymentIntent)).metadata;
}

async function normalizedStripeEvent(
  event: Stripe.Event,
): Promise<Parameters<typeof recordProviderWebhook>[0] | null> {
  const stripe = await getUncachableStripeClient();
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
      ...await metadataFromPaymentIntent(stripe, charge.payment_intent),
    };
    userId = metadata.stridepool_user_id;
    challengeId = metadata.stridepool_challenge_id ?? null;
    amountCents = charge.amount_refunded;
    currency = charge.currency;
    eventType = "refund_issued";
  } else if (event.type === "charge.dispute.created" || event.type === "charge.dispute.closed") {
    const dispute = event.data.object;
    const charge = typeof dispute.charge === "string"
      ? await stripe.charges.retrieve(dispute.charge)
      : dispute.charge;
    metadata = {
      ...dispute.metadata,
      ...charge.metadata,
      ...await metadataFromPaymentIntent(stripe, charge.payment_intent),
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
    metadata = {
      stripe_connect_account_id: connectedAccountId,
      stripe_payout_status: payout.status,
      ...(payout.failure_code ? { stripe_failure_code: payout.failure_code } : {}),
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
  const stripeSync = await getStripeSync();
  await stripeSync.processWebhook(payload, signature);
  const normalized = await normalizedStripeEvent(event);
  if (!normalized) return { accepted: true, ignored: true };
  return { ...(await recordProviderWebhook(normalized)), ignored: false };
}