---
name: Membership pricing
description: The durable Free and Pro pricing and entitlement rules for challenge participation.
---

Challenge creators choose the challenge entry fee, which is added to the prize pool for each paid participant. Free members pay a separate $2 platform fee on top of that entry fee and may have one active challenge. Pro costs $5/month, charges a separate $1 platform fee on top of the creator-set entry fee, allows five active challenges, and allows one active challenge created by that member. A Pro creator pays their own challenge entry fee plus the $1 platform fee and occupies one of the five participation slots.

**Why:** The user corrected the earlier fixed-entry model: the creator’s fee funds the challenge prize pool, while the plan-based $2/$1 amount is revenue paid to the app owner.

**How to apply:** Keep challenge and platform amounts separate in checkout metadata and fulfillment. Add only the creator-set amount to the prize pool. Enforce both amounts and plan limits on the server, and activate participation only after signed payment success.