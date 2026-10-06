import assert from "node:assert/strict";
import test from "node:test";
import {
  assertProductionStripeCredential,
  assertProductionWithdrawalsEnabled,
} from "./stripe-live-policy";

test("production rejects sandbox, missing, and publishable credentials without exposing them", () => {
  for (const key of ["sk_test_fixture", "rk_test_fixture", "pk_live_fixture", ""]) {
    assert.throws(
      () => assertProductionStripeCredential({ NODE_ENV: "production" }, key),
      (error: unknown) => error instanceof Error
        && error.message.includes("Production requires a live Stripe connection")
        && (!key || !error.message.includes(key)),
    );
  }
});

test("production accepts live secret and restricted credentials", () => {
  for (const key of ["sk_live_fixture", "rk_live_fixture"]) {
    assert.doesNotThrow(() => assertProductionStripeCredential({ NODE_ENV: "production" }, key));
  }
});

test("development can keep its separate sandbox", () => {
  assert.doesNotThrow(() => assertProductionStripeCredential({ NODE_ENV: "development" }, "sk_test_fixture"));
});

test("production payouts default closed and only an explicit true unlocks them", () => {
  for (const flag of [undefined, "", "false", "TRUE", "1"]) {
    assert.throws(() => assertProductionWithdrawalsEnabled({
      NODE_ENV: "production",
      STRIPE_LIVE_PAYOUTS_ENABLED: flag,
    }), /Live withdrawals are locked/);
  }
  assert.doesNotThrow(() => assertProductionWithdrawalsEnabled({
    NODE_ENV: "production",
    STRIPE_LIVE_PAYOUTS_ENABLED: "true",
  }));
});

test("development and isolated tests do not require the live payout switch", () => {
  for (const environment of ["development", "test"]) {
    assert.doesNotThrow(() => assertProductionWithdrawalsEnabled({ NODE_ENV: environment }));
  }
});

test("both production withdrawal boundaries reject before database or Stripe access", async () => {
  const previousEnvironment = process.env.NODE_ENV;
  const previousFlag = process.env.STRIPE_LIVE_PAYOUTS_ENABLED;
  process.env.NODE_ENV = "production";
  delete process.env.STRIPE_LIVE_PAYOUTS_ENABLED;
  try {
    const { withdrawAvailableBalance } = await import("./ledger");
    const { createStripeWithdrawal } = await import("./stripe-provider");
    await assert.rejects(
      withdrawAvailableBalance("nonexistent-user", {
        amountCents: 2_000,
        idempotencyKey: "live-lock-test",
      }),
      /Live withdrawals are locked/,
    );
    await assert.rejects(
      createStripeWithdrawal(
        {} as Parameters<typeof createStripeWithdrawal>[0],
        2_000,
        "live-lock-test",
      ),
      /Live withdrawals are locked/,
    );
  } finally {
    if (previousEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnvironment;
    if (previousFlag === undefined) delete process.env.STRIPE_LIVE_PAYOUTS_ENABLED;
    else process.env.STRIPE_LIVE_PAYOUTS_ENABLED = previousFlag;
  }
});

test("new-account schema defaults never create demo money", async () => {
  const { usersTable } = await import("@workspace/db");
  assert.equal(usersTable.walletBalance.default, "0.00");
  assert.equal(usersTable.walletPending.default, "0.00");
  assert.equal(usersTable.totalEarned.default, "0.00");
});
