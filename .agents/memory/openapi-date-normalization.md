---
name: OpenAPI date normalization
description: Date-format request body behavior shared by the generated Zod server validators and PostgreSQL date columns.
---

OpenAPI `format: date` fields are coerced to JavaScript `Date` values by the generated server-side Zod validators, even when the generated browser client types them as strings.

**Why:** Passing those values directly to PostgreSQL date columns creates a type mismatch and concatenating them with date suffixes produces invalid dates.

**How to apply:** After parsing a date-format request body, use the `Date` value as a date, then serialize it explicitly with `toISOString().slice(0, 10)` before inserting into Drizzle `date(..., { mode: "string" })` columns.