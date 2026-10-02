---
name: pnpm local Expo module copies
description: Stale `file:` dependency copies can hide edits to a local native module.
---

When an Expo native package is declared with a local `file:` dependency, verify that the installed package reflects the workspace source after making changes; pnpm may expose a copied store version rather than a live link.

**Why:** a typecheck continued resolving the old bridge shape after the source module had been updated.

**How to apply:** compare the installed package contents with the local module before diagnosing stale TypeScript or Metro behavior; refresh the local dependency before repeating checks.