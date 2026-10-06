---
name: Challenge chat access
description: Durable access rules for per-challenge chat.
---

Only an active participant may read or send challenge chat, and only while the current UTC calendar date is within the challenge's start and end dates, inclusive. Anonymous participation uses the existing browser identity only for free community challenges. Render message content as text, never HTML.

**Why:** The user asked for challenge chat restricted to participants, with access closing when a participant leaves or the challenge ends; anonymous free-community membership already has a browser-scoped identity boundary.

**How to apply:** Enforce membership and date checks on every server read and write, not only in the UI. Keep polling or other refresh paths subject to the same authorization.
