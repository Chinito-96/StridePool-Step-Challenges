---
name: Referral entitlement behavior
description: Server-side referral rewards qualify after challenge joins and remain usable after a paid Pro subscription ends.
---

Referral rewards are server-side Pro entitlements. A referred account qualifies only after a successful challenge join, qualification is idempotent, and both users receive a 30-day grant. If a referrer already has an active paid Pro subscription, still record the earned trial end so the reward remains available if that subscription later ends.

**Why:** Referral rewards must not depend on frontend state, must not be granted before the required join, and should not disappear merely because the referrer was already paying.

**How to apply:** Keep claim and qualification transactional, extend an existing unexpired grant, and let current/future trial entitlements take precedence when calculating membership.