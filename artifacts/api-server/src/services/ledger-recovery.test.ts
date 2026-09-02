import assert from "node:assert/strict";
import test from "node:test";
import { projectPayoutEvent, signedLedgerAmountCents } from "./ledger-policy";

test("late payout failure cannot regress a payout already marked paid", () => {
  const failed = projectPayoutEvent(undefined, "payout_failed", "evt_failed");
  const paid = projectPayoutEvent(failed, "payout_succeeded", "evt_paid");
  const lateFailure = projectPayoutEvent(paid, "payout_failed", "evt_late_failed");

  assert.deepEqual(failed, {
    status: "retry_pending",
    retryCount: 1,
    lastProviderEventId: "evt_failed",
  });
  assert.equal(paid.status, "paid");
  assert.equal(paid.retryCount, 1);
  assert.deepEqual(lateFailure, paid);
});

test("provider report totals use signed money events", () => {
  assert.equal(signedLedgerAmountCents("payment_succeeded", 1000), 1000);
  assert.equal(signedLedgerAmountCents("refund_issued", 250), -250);
  assert.equal(signedLedgerAmountCents("dispute_opened", 300), -300);
  assert.equal(signedLedgerAmountCents("payout_succeeded", 500), -500);
  assert.equal(signedLedgerAmountCents("payout_failed", 500), 0);
});