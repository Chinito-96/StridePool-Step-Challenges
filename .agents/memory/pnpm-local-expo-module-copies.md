---
name: pnpm local Expo module copies
description: Stale `file:` dependency copies can hide edits to a local native module.
---

When an Expo native package is declared with a local `file:` dependency, verify that the installed package reflects the workspace source after making changes; pnpm may expose a copied store version rather than a live link.

**Why:** a typecheck continued resolving the old bridge shape after the source module had been updated.

**How to apply:** compare the installed package contents with the local module before diagnosing stale TypeScript or Metro behavior; refresh the local dependency before repeating checks.

Keep exactly one autolinked source for a local Expo native module. Expo discovers the app's local modules directory independently of package dependencies; also installing that same module as a copied `file:` package can produce duplicate native-module discovery.

**Why:** Expo Doctor reported two copies of the health bridge even though both had the same version. Using the local source directly removed the duplicate and avoids stale package-store copies.

**How to apply:** Prefer the local module source for JavaScript imports when Expo already discovers it locally. Verify autolinking still includes it once; do not silence the duplicate check or assume a JavaScript export proves native compilation.