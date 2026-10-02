import assert from "node:assert/strict";
import { test } from "node:test";
import type Stripe from "stripe";
import { canManageBilling, openBillingPortal } from "./billing-portal";

const member = { stripeCustomerId: "cus_member", stripeSubscriptionId: "sub_member", subscriptionStatus: "active" };

function fakeStripe(existing = false) {
  const calls: { configuration?: Stripe.BillingPortal.ConfigurationCreateParams; session?: Stripe.BillingPortal.SessionCreateParams } = {};
  const stripe = {
    billingPortal: {
      configurations: {
        list: async () => ({ data: existing ? [{ id: "bpc_existing", metadata: { stridepool_portal: "membership_v1" } }] : [] }),
        create: async (input: Stripe.BillingPortal.ConfigurationCreateParams) => {
          calls.configuration = input;
          return { id: "bpc_new" };
        },
      },
      sessions: {
        create: async (input: Stripe.BillingPortal.SessionCreateParams) => {
          calls.session = input;
          return { url: "https://billing.stripe.com/session/test" };
        },
      },
    },
  } as unknown as Stripe;
  return { stripe, calls };
}

test("portal uses the persisted customer and enables payment updates and period-end cancellation", async () => {
  const { stripe, calls } = fakeStripe();
  const before = { ...member };
  const result = await openBillingPortal(stripe, member, "https://example.com/profile?billing=return");
  assert.equal(result.portalUrl, "https://billing.stripe.com/session/test");
  assert.deepEqual(calls.session, {
    customer: "cus_member", configuration: "bpc_new", return_url: "https://example.com/profile?billing=return",
  });
  assert.deepEqual(calls.configuration?.features, {
    payment_method_update: { enabled: true },
    subscription_cancel: { enabled: true, mode: "at_period_end" },
    subscription_update: { enabled: false },
  });
  assert.deepEqual(member, before, "opening a portal must not change membership");
});

test("reuses the dedicated configuration", async () => {
  const { stripe, calls } = fakeStripe(true);
  await openBillingPortal(stripe, member, "https://example.com/profile?billing=return");
  assert.equal(calls.configuration, undefined);
  assert.equal(calls.session?.configuration, "bpc_existing");
});

test("referral-only Pro, missing customers, and ended subscriptions cannot open billing", async () => {
  for (const user of [
    { ...member, stripeSubscriptionId: null },
    { ...member, stripeCustomerId: null },
    { ...member, subscriptionStatus: "canceled" },
    { ...member, subscriptionStatus: "inactive" },
  ]) {
    const { stripe, calls } = fakeStripe();
    assert.equal(canManageBilling(user), false);
    await assert.rejects(openBillingPortal(stripe, user, "https://example.com"), /no subscription/);
    assert.deepEqual(calls, {});
  }
});

test("past-due subscribers can fix their payment method", () => {
  assert.equal(canManageBilling({ ...member, subscriptionStatus: "past_due" }), true);
});

test("provider failures surface instead of returning a fake portal", async () => {
  const { stripe } = fakeStripe();
  stripe.billingPortal.sessions.create = async () => { throw new Error("Provider unavailable"); };
  await assert.rejects(openBillingPortal(stripe, member, "https://example.com"), /Provider unavailable/);
});