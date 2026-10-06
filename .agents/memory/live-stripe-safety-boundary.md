---
name: Live Stripe safety boundary
description: Separate live account preparation from permission to move funds, and keep payout approval independent of new paid entries.
---

Live Stripe connection preparation is not permission to create live charges,
transfers, payouts, or approve the paid-play launch gates. Keep the separate
development sandbox.

**Why:** The user chose live-connection preparation explicitly with no live
transactions and paid play remaining locked.

**How to apply:** Treat authorization, production verification, reconciliation,
and enabling live money movement as separate steps. Report unverified controls
as blockers rather than approving them to make setup appear complete.

Keep production withdrawal approval separate from the new-paid-entry launch
switch.

**Why:** Initial setup must not expose demo funds to live transfers, but a later
pause of new paid entries should not automatically freeze legitimate earned
withdrawals.

**How to apply:** Require explicit payout-readiness approval for live
withdrawals; do not infer it from the presence of live Stripe credentials.
