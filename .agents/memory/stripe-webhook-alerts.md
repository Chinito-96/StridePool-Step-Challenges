---
name: Stripe webhook support alerts
description: Durable thresholds and recovery rules for support notifications about managed webhook delivery.
---

Alert only after three consecutive known failing reviews spanning at least two minutes. Unknown or incomplete evidence does not start, advance, or clear an incident. Send recovery only after a complete healthy or idle review. Keep alert state scoped to the exact expected webhook URL, and never couple notifications to paid-play controls or endpoint changes.

Concurrent support checks may share in-flight provider reads only when endpoint ID, URL, and Connect scope match. Do not retain completed health reports: each later review must be able to detect endpoint disablement and recovery.

**Why:** Short provider or storage interruptions should not create false incident or recovery emails, and a webhook alert must never authorize a financial-control or endpoint mutation.

**How to apply:** Preserve the persistence threshold, incomplete-evidence boundary, one issue/recovery notification per incident, and in-flight-only review sharing when changing support or scheduled webhook checks.