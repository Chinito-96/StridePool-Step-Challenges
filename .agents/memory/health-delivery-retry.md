---
name: Health delivery retry boundary
description: Distinguishes companion delivery attempts from verified step accounting and native background scheduling.
---

Delivery attempt health and verified step accounting are separate. A companion retry should reread native samples with an overlap from the last successful delivery, send stable source sample IDs, and let the server deduplicate. Keep only failed-attempt metadata locally while offline, not copies of health samples.

**Why:** A failed upload may have partially reached the API, so a retry cannot infer which samples arrived; retries must be safe without incrementing verified totals twice. Local pending failures cannot be shown on other devices until the companion reconnects.

**How to apply:** Report failures and successful empty reads as delivery events. A native app opening or resuming can retry after the cooldown; this is not an OS-scheduled background task, and UI wording must not promise delivery while the app is closed.

When a companion reconnects with a locally saved failure, report that failure first and honor the returned `nextRetryAt`. Do not immediately reread and upload samples while the server's retry window is still active.

**Why:** Reporting an offline failure establishes the server's backoff window; retrying in the same foreground pass would otherwise bypass the schedule the user sees.

**How to apply:** After reporting saved failure metadata, stop the current sync when `nextRetryAt` is in the future. Resume/reopen the companion after the retry time to reread stable native sample IDs.