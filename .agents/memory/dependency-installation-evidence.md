---
name: Dependency installation evidence
description: Distinguish lockfile security results from the dependencies actually used by local checks.
---

After dependency remediation, verify the versions resolved by the actual consumers before trusting builds or runtime tests.

**Why:** The managed package installer reported success and updated the pnpm lockfile while local package links still resolved vulnerable versions. The dependency audit inspected the lockfile, so its clean results did not prove local processes were using the patches.

**How to apply:** Treat lockfile auditing and installed-version verification as separate evidence. If they disagree, materialize the updated lockfile before running acceptance checks and restarting services.