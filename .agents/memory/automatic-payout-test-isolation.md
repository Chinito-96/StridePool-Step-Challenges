---
name: Automatic payout test isolation
description: A safety constraint for database-backed automatic challenge closeout tests.
---

Database-backed tests that invoke automatic closeout use the production discovery query against the shared test database. Choose a historical clock and fixture dates outside seeded and normal challenge ranges, and ensure cleanup is scoped to fixture IDs. A dedicated disposable database would be safer if the test environment supports it.

**Why:** The real discovery query is global and cannot be scoped to test-created IDs without ceasing to test its production behavior. A current-date pass could settle unrelated open paid challenges in a shared development database.

**How to apply:** When testing automatic discovery or retry, keep the real query and transaction, but use an isolated historical date with unique fixtures; never run a current-date closeout pass as a test in a shared database.