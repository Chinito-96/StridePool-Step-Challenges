# StridePool

StridePool is a responsive step-challenge web app where people build consistency together, join transparent prize pools, and earn a share when they complete every day of a challenge.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/stridepool/src/App.tsx` — app routes, demo data, local persistence, and product interactions
- `artifacts/stridepool/src/index.css` — StridePool visual system and responsive layout
- `docs/steppa-benchmark.md` — sourced competitor research and product opportunities
- `competitor-monitoring.md` — competitor bookmark bundle and monthly review ritual

## Architecture decisions

- The first build is frontend-only so the product loop can be explored without committing to payment, health-data, or account infrastructure.
- Demo state is persisted in localStorage to make join, step sync, wallet, and profile interactions survive navigation and reloads.
- The experience uses an original StridePool identity and copy; Steppa is treated as a mechanics benchmark, not a visual or content source.
- The product emphasizes transparent pool math, human recovery paths, and social accountability as the main opportunities over the benchmark.

## Product

- Dashboard for today’s movement, active challenges, upcoming challenges, and recent activity
- Searchable and filterable challenge discovery with challenge detail and join confirmation flow
- Payout math with entry fee, current pool, estimated share, and platform fee shown before confirmation
- Simulated step syncing that updates daily progress and activity
- Wallet balance, pending funds, earnings history, and payout method demo
- Profile editing, health-source connection demo, notifications, and privacy controls
- Responsive desktop navigation and mobile bottom navigation

## User preferences

- Use this build as a starting point and differentiate it further before any finalization or publication.

## Gotchas

- This is currently a browser prototype; production payment rails, health integrations, authentication, and compliance review are intentionally not wired up.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
