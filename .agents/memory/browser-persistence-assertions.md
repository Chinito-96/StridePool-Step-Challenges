---
name: Browser persistence assertions
description: Reliable browser-level checks for StridePool state after navigation and reload.
---

Browser regression checks must wait for the expected persisted text or state, not merely for its container to exist. StridePool pages render placeholder wallet and step values before the authenticated bootstrap completes, so element-presence assertions can pass while the test still observes default state.

**Why:** A full-reload browser test intermittently observed the wallet's initial zero balance even though the API had returned the saved account data shortly afterward.

**How to apply:** Use value-aware polling for wallet, steps, profile, membership, and activity assertions after `goto` or `reload`; keep test records isolated and clean them up after the browser and service processes close.