import assert from "node:assert/strict";
import { test } from "node:test";
import type Stripe from "stripe";
import { CONNECT_API_VERSION, openPayoutOnboarding } from "./stripe-connect";

function fixture(linkFails = false) {
  const calls: { operation: string; input: unknown; options?: unknown }[] = [];
  const stripe = { v2: { core: {
    accounts: { create: async (input: unknown, options: unknown) => {
      calls.push({ operation: "create", input, options });
      return { id: "acct_test" };
    } },
    accountLinks: { create: async (input: unknown, options: unknown) => {
      calls.push({ operation: "link", input, options });
      if (linkFails) throw new Error("Link unavailable");
      return { url: "https://accounts.stripe.com/test" };
    } },
  } } } as unknown as Pick<Stripe, "v2">;
  const save = async (id: string) => { calls.push({ operation: "save", input: id }); };
  return { stripe, calls, save };
}

test("creates a v2 Express recipient and persists it before linking", async () => {
  const { stripe, calls, save } = fixture();
  const result = await openPayoutOnboarding(stripe, {
    id: "test-walker", email: "walker@example.com", stripeConnectAccountId: null,
  }, "attempt", "https://example.com", save);
  assert.deepEqual(calls.map((call) => call.operation), ["create", "save", "link"]);
  assert.deepEqual(calls[0].input, {
    contact_email: "walker@example.com",
    identity: { country: "US" },
    dashboard: "express",
    defaults: { responsibilities: { fees_collector: "application", losses_collector: "application" } },
    configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } },
    metadata: { stridepool_user_id: "test-walker" },
  });
  assert.deepEqual(calls[0].options, {
    apiVersion: CONNECT_API_VERSION, idempotencyKey: "attempt-account-v2",
  });
  assert.deepEqual(calls[2].input, {
    account: "acct_test",
    use_case: { type: "account_onboarding", account_onboarding: {
      configurations: ["recipient"],
      collection_options: { fields: "eventually_due" },
      refresh_url: "https://example.com/wallet?onboarding=refresh",
      return_url: "https://example.com/wallet?onboarding=return",
    } },
  });
  assert.equal(result.accountId, "acct_test");
  assert.equal(result.accountLink.url, "https://accounts.stripe.com/test");
});

test("existing account IDs are reused without creating or replacing accounts", async () => {
  const { stripe, calls, save } = fixture();
  await openPayoutOnboarding(stripe, {
    id: "test-walker", email: null, stripeConnectAccountId: "acct_existing",
  }, "retry", "https://example.com", save);
  assert.deepEqual(calls.map((call) => call.operation), ["link"]);
  assert.equal((calls[0].input as { account: string }).account, "acct_existing");
});

test("link failures preserve the created account for a retry", async () => {
  const { stripe, calls, save } = fixture(true);
  await assert.rejects(openPayoutOnboarding(stripe, {
    id: "test-walker", email: "walker@example.com", stripeConnectAccountId: null,
  }, "attempt", "https://example.com", save), /Link unavailable/);
  assert.deepEqual(calls.map((call) => call.operation), ["create", "save", "link"]);
});

test("missing email stops new recipient creation before contacting Stripe", async () => {
  const { stripe, calls, save } = fixture();
  await assert.rejects(openPayoutOnboarding(stripe, {
    id: "test-walker", email: null, stripeConnectAccountId: null,
  }, "attempt", "https://example.com", save), /email address is required/);
  assert.equal(calls.length, 0);
});
