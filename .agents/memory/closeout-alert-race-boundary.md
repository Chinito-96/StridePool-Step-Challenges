---
name: Closeout alert race boundary
description: Keep repeated automatic payout failure signals consistent with concurrent settlements.
---

Record a failed automatic closeout only while the challenge is still open. Claim outbound alerts atomically, and clear failure and notification state as part of the successful settlement transaction.

**Why:** Separate scheduler passes can overlap. A late failure write must not reopen an alert after settlement, and competing retries must not send duplicate messages for one blocked incident.

**How to apply:** Guard failure writes and notification claims by the challenge's current settlement state. Use a persisted claim lease and provider idempotency for delivery retries; successful settlement paths must clear failure and notification markers in the same transaction that commits the payout.