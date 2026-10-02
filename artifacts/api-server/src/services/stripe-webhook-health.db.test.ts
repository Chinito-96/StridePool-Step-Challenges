import assert from "node:assert/strict";
import test, { after } from "node:test";
import type Stripe from "stripe";
import { db, pool, stripeWebhookHealthBaselinesTable, stripeWebhookHealthReceiptsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  initializeStripeWebhookHealthBaseline,
  processSignedStripeWebhook,
  setStripeWebhookEndpointIdentity,
} from "./stripe-webhook-health";

const endpointId = `we_test_${crypto.randomUUID()}`;
const domain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
assert.ok(domain, "A preview domain is required for the isolated receipt test.");
const endpointUrl = `https://${domain}/api/stripe/webhook`;
setStripeWebhookEndpointIdentity(endpointId, endpointUrl, false);

after(async () => {
  await db.delete(stripeWebhookHealthReceiptsTable).where(eq(stripeWebhookHealthReceiptsTable.endpointId, endpointId));
  await db.delete(stripeWebhookHealthBaselinesTable).where(eq(stripeWebhookHealthBaselinesTable.endpointId, endpointId));
  await pool.end();
});

test("monitoring baseline is stable when initialization runs again", async () => {
  const initial = new Date("2026-01-01T00:00:00.000Z");
  assert.deepEqual(await initializeStripeWebhookHealthBaseline(endpointId, endpointUrl, initial), initial);
  assert.deepEqual(await initializeStripeWebhookHealthBaseline(endpointId, endpointUrl, new Date()), initial);
});

test("signed receipts deduplicate attempts, recover success, and survive a late failure", async () => {
  const event = {
    id: `evt_test_${crypto.randomUUID()}`,
    type: "payment_intent.payment_failed",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
  } as Stripe.Event;
  const fail = async () => { throw new Error("test processing failed"); };
  for (let attempt = 0; attempt < 3; attempt++) {
    await assert.rejects(processSignedStripeWebhook(event, fail), /test processing failed/);
  }
  const receipts = () => db.select().from(stripeWebhookHealthReceiptsTable)
    .where(eq(stripeWebhookHealthReceiptsTable.eventId, event.id));
  let rows = await receipts();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].failedAttemptCount, 3);
  assert.equal(rows[0].processingSucceeded, false);
  await processSignedStripeWebhook(event, async () => ({ accepted: true }));
  await processSignedStripeWebhook(event, async () => ({ accepted: true }));
  await assert.rejects(processSignedStripeWebhook(event, fail), /test processing failed/);
  rows = await receipts();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].processingSucceeded, true);
  assert.ok(rows[0].successfulAt);
  assert.equal(rows[0].failedAttemptCount, 4);
});