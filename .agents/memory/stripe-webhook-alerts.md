---
name: Stripe webhook support alerts
description: Durable thresholds and recovery rules for support notifications about managed webhook delivery.
---

Alert only after three consecutive known failing reviews spanning at least two minutes. Unknown or incomplete evidence does not start, advance, or clear an incident. Send recovery only after a complete healthy or idle review. Keep alert state scoped to the exact expected webhook URL, and never couple notifications to paid-play controls or endpoint changes.

**Why:** Short provider or storage interruptions should not create false incident or recovery emails, and a webhook alert must never authorize a financial-control or endpoint mutation.

**How to apply:** Preserve the persistence threshold, incomplete-evidence boundary, and one issue/recovery notification per incident when changing the scheduled review or support email behavior.