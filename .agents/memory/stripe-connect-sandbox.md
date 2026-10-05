---
name: Stripe Connect sandbox prerequisite
description: Separate account-level Connect enrollment from the managed payments connection before testing payouts.
---

The Replit-managed Stripe sandbox can process test payments and webhooks but does not support Connect or connected accounts. An owner-created standalone sandbox can be Connect-enabled through Stripe MCP's `EnableConnect` operation, but only when the selected account is confirmed as a standalone test sandbox. Replacing the app's development credentials leaves old test objects behind. A separately authorized Stripe tool can expose a different account and mode; do not assume it manages the app's Stripe account. Do not count locally signed payout fixtures as Stripe-issued payout evidence.

**Why:** The provider rejected connected-account creation because Connect enrollment was not completed, and Replit documents that its managed sandbox does not support Connect. A separate standalone sandbox and explicit test-mode Connect enablement are required to create payout evidence; switching credentials does not migrate existing events.

**How to apply:** Compare account IDs and test/live mode across every Stripe connection before acting. Never run `EnableConnect` against live or Replit-managed accounts. Verify that the app and Stripe tooling share the same Connect-capable sandbox before creating provider events. Keep the paid-play reconciliation flag off until genuine test payouts and independent report evidence are persisted.

Stripe test payouts can emit both `payout.paid` and `payout.failed` for one payout that ultimately has `status=failed` and `failure_code=no_account`. In a provider-backed test, even the `payout.paid` event carried the final failed status; the app's event-name mapping left its payout projection as paid.

**Why:** Event type and the payout object's current status can disagree in sandbox delivery. Counting one append-only ledger row per event can still pass while the user-facing payout projection is wrong.

**How to apply:** Preserve each raw event type and ID in the append-only receipt, but derive the payout-state projection from `data.object.status` when it is `paid` or `failed`. Verify persisted payout state separately from event receipt counts, including both delivery orders and duplicate IDs. Do not treat reconciliation success alone as permission to enable paid play.