---
name: API preview refresh
description: How the StridePool API preview workflow reflects server-side source changes.
---
The API preview workflow runs a production-style build before starting the server; source edits do not hot-reload into the running API process.

**Why:** Runtime probes briefly served the previous response shape even though the newly built bundle contained the route and fields.

**How to apply:** After changing API routes, services, schemas, or generated server imports, restart the managed API workflow before checking preview behavior.