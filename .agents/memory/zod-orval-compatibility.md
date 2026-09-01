---
name: Orval integer schema compatibility
description: Workspace guidance for generated Zod schemas from the OpenAPI contract.
---
OpenAPI integer fields are generated as `z.int()` by the current Orval configuration, so the workspace must use Zod 4’s default package API rather than Zod 3.

**Why:** The generated API validation package failed typechecking when the catalog used Zod 3, even though the project’s source imports remained otherwise compatible.

**How to apply:** If API codegen starts producing `z.int()` errors, check the workspace Zod catalog before editing generated output.