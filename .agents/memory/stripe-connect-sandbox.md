---
name: Stripe Connect sandbox prerequisite
description: Separate account-level Connect enrollment from the managed payments connection before testing payouts.
---

The Replit-managed Stripe sandbox can process test payments and webhooks but does not support Connect or connected accounts. An owner-created standalone sandbox can be Connect-enabled through Stripe MCP's `EnableConnect` operation, but only when the selected account is confirmed as a standalone test sandbox. Replacing the app's development credentials leaves old test objects behind. A separately authorized Stripe tool can expose a different account and mode; do not assume it manages the app's Stripe account. Do not count locally signed payout fixtures as Stripe-issued payout evidence.

**Why:** The provider rejected connected-account creation because Connect enrollment was not completed, and Replit documents that its managed sandbox does not support Connect. A separate standalone sandbox and explicit test-mode Connect enablement are required to create payout evidence; switching credentials does not migrate existing events.

**How to apply:** Compare account IDs and test/live mode across every Stripe connection before acting. Never run `EnableConnect` against live or Replit-managed accounts. Verify that the app and Stripe tooling share the same Connect-capable sandbox before creating provider events. Keep the paid-play reconciliation flag off until genuine test payouts and independent report evidence are persisted.

Stripe test payouts can emit both `payout.paid` and `payout.failed` for one payout that ultimately has `status=failed` and `failure_code=no_account`. Both event snapshots can carry the final failed status, while Stripe separately records a negative `payout` balance transaction and a positive `payout_failure` reversal. Event names or counts alone therefore cannot establish the net payout movement.

**Why:** Event type and the payout object's current status can disagree in sandbox delivery; in addition, a failed payout has a debit and a separate reversal. Event-only reconciliation can match receipts while incorrectly counting returned funds as still paid.

**How to apply:** Preserve each raw event type and ID as a receipt, derive payout state from `data.object.status`, and append money movement per account-scoped balance-transaction ID. Reconcile those IDs against an independent Stripe Balance Transactions report; duplicate and out-of-order event delivery must not duplicate either movement, and an unresolved mismatch must keep the paid-play gate closed. Signed-webhook delivery, payout projection, and balance-transaction reconciliation are separate evidence.