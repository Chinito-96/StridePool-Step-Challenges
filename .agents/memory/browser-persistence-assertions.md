---
name: Browser persistence assertions
description: Reliable browser-level checks for StridePool state after navigation and reload.
---

Browser regression checks must wait for the expected persisted text or state, not merely for its container to exist. StridePool pages render placeholder wallet and step values before the authenticated bootstrap completes, so element-presence assertions can pass while the test still observes default state.

**Why:** A full-reload browser test intermittently observed the wallet's initial zero balance even though the API had returned the saved account data shortly afterward.

**How to apply:** Use value-aware polling for wallet, steps, profile, membership, and activity assertions after `goto` or `reload`; keep test records isolated and clean them up after the browser and service processes close.

Browser persistence validation should serve the real HTTP app without running the production API startup sequence.

**Why:** Normal API startup initializes the payment provider and immediately discovers finished challenges for payout closeout. Unique browser fixtures alone do not protect unrelated records from those background jobs.

**How to apply:** Keep operational initialization and payout scheduling out of isolated browser test servers; test those operations separately with controlled data and clocks.

Anonymous browser regressions should check membership and challenge-scoped leaderboard progress, not enable anonymous native uploads or personal activity history to satisfy a test.

**Why:** Anonymous free participation and account-bound health/history deliberately have different permissions. Persistence coverage must not weaken that product boundary.

**How to apply:** Join through the real browser, then apply verified updates only to isolated fixture records and confirm the visible community totals after reload.

Nested `node --test` subprocesses launched from a test worker must not inherit `NODE_TEST_CONTEXT`; otherwise Node can skip the child test files. Stop detached process groups even when the package-manager wrapper already exited, since its server child may remain alive.

**Why:** Failure-path checks need the child test runner's real nonzero status, and package-manager wrappers can outlive or exit before server processes in the same group.

**How to apply:** Remove `NODE_TEST_CONTEXT` from test-child environments and verify process-group cleanup for both live wrappers and wrappers with surviving children.