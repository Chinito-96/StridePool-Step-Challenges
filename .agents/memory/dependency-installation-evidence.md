---
name: Dependency installation evidence
description: Distinguish lockfile security results from the dependencies actually used by local checks.
---

After dependency remediation, verify the versions resolved by the actual consumers before trusting builds or runtime tests.

**Why:** The managed package installer reported success and updated the pnpm lockfile while local package links still resolved vulnerable versions. The dependency audit inspected the lockfile, so its clean results did not prove local processes were using the patches.

**How to apply:** Treat lockfile auditing and installed-version verification as separate evidence. If they disagree, materialize the updated lockfile before running acceptance checks and restarting services.

The managed language-package installer is an add-package interface, not an install-only operation: it rejects empty package arrays and invokes pnpm at the workspace root without a workspace selector.

**Why:** Applying manifest-only native package updates hit both the empty-array validation and pnpm's root guard; a successful subsequent add still updated the lockfile without refreshing the local runtime packages.

**How to apply:** Keep package ownership in the correct manifests, preserve the workspace-root safety check, and use the project's established setup flow to materialize the resulting lockfile when necessary. Inspect that setup's schema responsibilities first rather than assuming it only installs dependencies.