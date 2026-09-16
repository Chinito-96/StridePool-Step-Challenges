---
name: Wallet withdrawal policy
description: The minimum-balance and provider-account rules for wallet withdrawals.
---

Users may withdraw only when available wallet funds reach at least $20 and Stripe confirms a linked, payout-enabled bank account. Pending challenge funds do not count toward the threshold.

**Why:** The user explicitly requires at least $20 in available wallet holdings before withdrawal and wants bank details handled through the existing Stripe Connect path.

**How to apply:** Reserve available funds atomically before provider payout creation, prevent concurrent duplicate withdrawals, restore funds after a fully reversed provider failure, and reconcile final status from signed payout events.