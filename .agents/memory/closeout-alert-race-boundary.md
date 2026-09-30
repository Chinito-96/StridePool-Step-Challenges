---
name: Closeout alert race boundary
description: Keep repeated automatic payout failure signals consistent with concurrent settlements.
---

Record a failed automatic closeout only while the challenge is still open, and clear its failure signal as part of the successful settlement transaction.

**Why:** Separate scheduler passes can overlap. A failing pass may report its failure after another pass has settled the same challenge; an unconditional failure write would reopen a support alert for a paid challenge.

**How to apply:** Keep failure writes guarded by the challenge's current settlement state. Any new settlement path should clear the signal in the same transaction that commits the payout, not in a later background operation.