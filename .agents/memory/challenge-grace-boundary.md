---
name: Challenge grace boundary
description: StridePool challenge qualification has no grace-day allowance; support recovery and Stripe delivery grace remain separate.
---

Challenge daily-goal qualification has no grace-day allowance or grace-day recovery request. Injury-pause and support-review paths remain available, and Stripe webhook delivery timing keeps its separate delivery grace.

**Why:** The product explicitly removed challenge grace days while preserving support recovery and webhook delivery timing.

**How to apply:** Do not reintroduce per-challenge grace settings, eligibility allowances, or grace-day requests. Keep injury/support recovery and Stripe event-delivery policies independent.