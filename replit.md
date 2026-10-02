# StridePool

StridePool is a responsive step-challenge web app where people build consistency together, join transparent prize pools, and earn a share when they complete every day of a challenge.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm test` — paid-play launch-gate regression suite (also registered as the standard `test` validation check)
- `pnpm run validate` — launch-gate tests, isolated authenticated browser persistence checks, then the full workspace typecheck; any failure stops validation
- Browser validation requires a schema-ready `DATABASE_URL` and Chromium. Replit's bundled Chromium is detected automatically; elsewhere run `pnpm --filter @workspace/scripts exec playwright install --with-deps chromium` or set `CHROMIUM_PATH`. The test creates unique fixtures, removes them afterward, and runs its own API/web servers without Stripe initialization or payout jobs.
- `pnpm --filter @workspace/api-server run test:launch-gate` — run only the API launch-gate suite, without inherited Stripe credentials or a running database
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/scripts run seed:stridepool` — reset and seed demo challenges, wallet, profile, entries, and steps
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/stridepool/src/App.tsx` — app routes, API-backed state, and product interactions
- `artifacts/api-server/src/routes/stridepool.ts` — authenticated StridePool mutations and bootstrap data
- `artifacts/api-server/src/routes/auth.ts` — Replit Auth browser/mobile session endpoints
- `lib/db/src/schema/auth.ts` and `lib/db/src/schema/stridepool.ts` — persisted users, sessions, challenges, entries, and daily steps
- `artifacts/stridepool/src/index.css` — StridePool visual system and responsive layout
- `docs/steppa-benchmark.md` — sourced competitor research and product opportunities
- `competitor-monitoring.md` — competitor bookmark bundle and monthly review ritual

## Architecture decisions

- The web client loads authenticated challenges, wallets, profiles, entries, and daily steps from the API; the API owns all Postgres access.
- Replit Auth identifies users and persists sessions in Postgres. Paid and personalized entries require login; free community participation remains limited to the anonymous browser until a user signs in.
- Demo state can be reset with the seed script. Web step data supports demo, manual daily totals, and CSV import; native Apple Health and Health Connect require a future mobile companion. Money balances remain zero until signed provider events are reconciled.
- Paid play is server-gated behind counsel-approved states, provider configuration, and eligibility checks.
- The API exposes provider-shaped checkout, payout onboarding, signed webhook, and append-only ledger routes backed by transactional PostgreSQL money tables with provider-event and idempotency constraints.
- The experience uses an original StridePool identity and copy; Steppa is treated as a mechanics benchmark, not a visual or content source.
- The product emphasizes transparent pool math, human recovery paths, and social accountability as the main opportunities over the benchmark.

## Product

- Dashboard for today’s movement, active challenges, upcoming challenges, and recent activity
- Searchable and filterable challenge discovery with challenge detail and join confirmation flow
- Payout math with entry fee, current pool, estimated share, and platform fee shown before confirmation
- Simulated step syncing that updates daily progress and activity
- Wallet balance, pending funds, provider ledger events, and payout onboarding readiness
- Profile editing, web step-source controls, source review visibility, notifications, and privacy controls
- Responsive desktop navigation and mobile bottom navigation

## User preferences

- Use this build as a starting point and differentiate it further before any finalization or publication.

## Gotchas

- Paid play is intentionally disabled until qualified counsel signs off on the challenge/refund model and state matrix, a payment/payout provider is connected, and the provider reconciliation launch evidence is complete.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
