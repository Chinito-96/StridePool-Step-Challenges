---
name: Stripe delivery evidence boundary
description: How to avoid false webhook outage claims from account-wide events or newly installed monitoring.
---

Compare endpoint-specific signed delivery receipts with provider events only after a durable monitoring-start baseline. Treat missing coverage as unknown; Stripe's pending_webhooks count is account-wide, not proof that this endpoint failed.

**Why:** Previously created provider events can predate receipt instrumentation, and unrelated endpoints can keep an event pending even when this app processed it. Either shortcut creates false outage alerts.

**How to apply:** Keep the monitoring baseline stable across restarts and scoped to the exact managed endpoint and URL. Connect endpoints receive connected-account events only, not platform events; account endpoints receive platform events only. Query exactly that delivery scope or explicitly report incomplete coverage. A healthy check must never serve as permission to enable paid play.