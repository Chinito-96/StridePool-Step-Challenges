import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getUncachableStripeClient } from "../stripeClient";
import { CONNECT_API_VERSION, openPayoutOnboarding } from "../services/stripe-connect";

// Explicitly sandbox-only; never attach this temporary recipient to an app user.
assert.equal(process.env.NODE_ENV, "development");
assert.ok(process.env.STRIPE_SANDBOX_SECRET_KEY?.startsWith("sk_test_"));
assert.ok(process.env.STRIPE_SANDBOX_ACCOUNT_ID);
const stripe = await getUncachableStripeClient();
const platform = await stripe.accounts.retrieve(null);
assert.equal(platform.id, process.env.STRIPE_SANDBOX_ACCOUNT_ID);
const domain = process.env.REPLIT_DEV_DOMAIN;
assert.ok(domain, "Development domain is required.");
// Clean up only recipients left by an interrupted run of this exact check.
for await (const account of stripe.v2.core.accounts.list({}, { apiVersion: CONNECT_API_VERSION })) {
  if (!account.closed && account.metadata?.stridepool_user_id === "sandbox-onboarding-smoke") {
    await stripe.v2.core.accounts.close(account.id, { applied_configurations: ["recipient"] }, {
      apiVersion: CONNECT_API_VERSION,
    });
  }
}
let temporaryAccountId: string | undefined;
try {
  const { accountId, accountLink } = await openPayoutOnboarding(stripe, {
    id: "sandbox-onboarding-smoke",
    email: "sandbox-onboarding-smoke@example.com",
    stripeConnectAccountId: null,
  }, `connect-smoke-${randomUUID()}`, `https://${domain}`, async (id) => {
    temporaryAccountId = id;
  });
  assert.equal(accountLink.livemode, false);
  const onboardingUrl = new URL(accountLink.url);
  assert.equal(onboardingUrl.protocol, "https:");
  assert.ok(["accounts.stripe.com", "connect.stripe.com"].includes(onboardingUrl.hostname));
  // Bank-status reads and payout APIs continue to use v1 with the same account ID.
  const account = await stripe.accounts.retrieve(accountId);
  assert.equal(account.id, accountId);
  assert.equal(typeof account.payouts_enabled, "boolean");
  assert.equal(account.payouts_enabled, false, "Unonboarded accounts must not allow payouts.");
  console.log("PASS: v2 sandbox account creation, hosted onboarding link, and v1 bank-status read.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Sandbox onboarding check failed.");
  process.exitCode = 1;
} finally {
  if (temporaryAccountId) {
    await stripe.v2.core.accounts.close(temporaryAccountId, { applied_configurations: ["recipient"] }, {
      apiVersion: CONNECT_API_VERSION,
    });
    console.log("Temporary sandbox recipient closed. No funds moved.");
  }
}
