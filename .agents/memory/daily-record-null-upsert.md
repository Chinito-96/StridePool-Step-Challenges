---
name: Nullable daily-record upserts
description: Persistence rule for personal daily step records whose challenge reference is nullable
---

Personal daily step records use a nullable challenge reference, so a composite PostgreSQL unique constraint does not treat repeated `NULL` challenge values as duplicates.

**Why:** Repeated source syncs can otherwise insert multiple personal rows for one account and date, causing bootstrap totals to add the same account’s rebuilt total more than once.

**How to apply:** When updating a daily record with no challenge, find it with `IS NULL` and update by its concrete row ID before inserting; do not rely on a composite `ON CONFLICT` target containing the nullable column.

Serialize native ingestion per account across both sources, and keep duplicate detection, daily-limit checks, sample insertion, and total rebuilding in the same transaction.

**Why:** Finding a personal daily row before inserting only protects sequential calls. Concurrent calls can both find no row, and locking only existing daily rows cannot protect that absence. Both native sources contribute to the same daily total, so a source-specific lock is insufficient.

**How to apply:** Use the account as the serialization boundary before any ingestion reads, and pass the transaction through all total-rebuilding writes. Other writers of sample verification or rebuilt totals must participate in that same boundary if made concurrency-safe.