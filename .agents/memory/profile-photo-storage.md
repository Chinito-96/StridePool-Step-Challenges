---
name: Profile photo storage
description: Storage boundary for user-uploaded profile photos.
---

Uploaded profile photos must use App Storage. PostgreSQL may keep an object path and queryable metadata, but not image bytes or base64 payloads.

**Why:** The user explicitly required persistent photo uploads without putting image data in PostgreSQL.

**How to apply:** Provision App Storage and use authenticated presigned uploads before enabling a custom photo upload flow. Do not silently fall back to storing bytes in the database.
