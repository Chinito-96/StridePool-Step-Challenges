---
name: Nullable daily-record upserts
description: Persistence rule for personal daily step records whose challenge reference is nullable
---

Personal daily step records use a nullable challenge reference, so a composite PostgreSQL unique constraint does not treat repeated `NULL` challenge values as duplicates.

**Why:** Repeated source syncs can otherwise insert multiple personal rows for one account and date, causing bootstrap totals to add the same account’s rebuilt total more than once.

**How to apply:** When updating a daily record with no challenge, find it with `IS NULL` and update by its concrete row ID before inserting; do not rely on a composite `ON CONFLICT` target containing the nullable column.