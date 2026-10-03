---
name: Automatic payout test isolation
description: A safety constraint for database-backed automatic challenge closeout tests.
---

Database-backed tests that invoke automatic closeout must use the production discovery query against an isolated disposable schema. Clone only the required table definitions into a uniquely named schema, redirect serial defaults to schema-local sequences, set that schema as the connection's only search path, and drop it in a `finally` cleanup. Keep the historical clock and fixture cleanup scoped to fixture IDs as additional safeguards.

**Why:** The real discovery query is global and cannot be scoped to test-created IDs without ceasing to test its production behavior. Search-path isolation keeps unrelated challenges invisible even when old fixtures exist; schema-local sequences avoid changing shared database counters.

**How to apply:** When testing automatic discovery or retry, run through the disposable-schema harness, assert that `public` is not on the test connection's search path, and retain the historical clock. Fail explicitly if the harness cannot create its schema; never fall back to running closeout against shared tables.