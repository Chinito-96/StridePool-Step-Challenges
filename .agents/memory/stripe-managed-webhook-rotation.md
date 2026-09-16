---
name: Managed Stripe webhook rotation
description: Operational constraints around rotating the app-managed Stripe webhook and retaining its signing secret.
---

The installed `stripe-replit-sync` runtime persists the signing secret in its managed-webhook record when `findOrCreateManagedWebhook` creates an endpoint. The separately documented `createManagedWebhook` method may be present in type declarations but unavailable at runtime, so rotation must use the supported find-or-create path after deleting the verified target record.

**Why:** Stripe does not return an existing endpoint's signing secret on retrieval, and an app that only checks process memory or connection settings loses verification after restart.

**How to apply:** Before rotation, confirm the exact app-managed URL and isolate it from unrelated endpoints. After rotation, resolve the persisted secret for that exact URL, verify a signed event and duplicate delivery, and keep the manual reconciliation flag false until the complete evidence set is reviewed.