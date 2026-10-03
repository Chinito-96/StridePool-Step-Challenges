# Threat Model

## Project Overview

StridePool is a step-challenge web app (pnpm monorepo, Node 24, TypeScript). The
backend is an Express 5 API (`artifacts/api-server`) backed by PostgreSQL via
Drizzle ORM. The web client is a React/Vite SPA (`artifacts/stridepool`). A mobile
companion (`artifacts/stridepool-companion`, Expo) ships a tiny zero-dependency
static server (`server/serve.js`). Authentication is Replit Auth (OIDC) with
server-side sessions persisted in Postgres. Money/payouts use Stripe behind a
launch gate that is intentionally disabled until counsel approval and provider
configuration are complete.

## Assets

- **User accounts and sessions** — Replit OIDC identities, Postgres-backed session
  records (`sid` cookie or `Bearer` token), emails and names.
- **Wallet / money state** — wallet balances, append-only `walletLedgerEntries`,
  payout states, provider money events. Compromise affects real funds once paid
  play launches.
- **Health/step data** — daily step records and raw source samples (Apple Health /
  Health Connect), which are personal data and drive payouts.
- **Application secrets** — Stripe keys, webhook signing secret, `DATABASE_URL`,
  `REPL_ID`. Server-side only.

## Trust Boundaries

- **Browser/mobile → API** — all requests cross this boundary; the API authenticates
  via session cookie (SameSite=lax, httpOnly) or `Authorization: Bearer <sid>`.
- **API → PostgreSQL** — all DB access via Drizzle parameterized queries.
- **API → Stripe** — outbound calls with secret keys; inbound webhook verified via
  `stripe.webhooks.constructEvent` (signature required) before any ledger write.
- **Public vs authenticated vs admin** — some reads (bootstrap, community challenges,
  leaderboards, invite preview, referral preview) are anonymous; most mutations
  require a session; admin routes require `usersTable.role === "admin"` enforced in
  `requireAdmin`.

## Scan Anchors

- Production entry points: `artifacts/api-server/src/app.ts` (webhook raw route, CORS,
  auth middleware), `artifacts/api-server/src/routes/*` (auth, stridepool, money,
  admin, compliance, health).
- Highest-risk areas: `routes/stridepool.ts` (largest surface; join/leave, invites,
  source ingestion, profile), `services/ledger.ts` + `services/stripe-provider.ts`
  (money), `routes/admin.ts` (privileged actions), `routes/auth.ts` (OIDC redirects).
- Access control: admin gated by `requireAdmin`; user routes scope every query by
  `req.user.id`; group challenges gated by `isGroupMember`. These are consistently
  applied — no IDOR found in this scan.
- Dev-only / lower-risk: `artifacts/mockup-sandbox` (design canvas), `*.test.ts`
  suites, `artifacts/stridepool-companion/server/serve.js` (static build server for
  the mobile artifact).

## Threat Categories

### Spoofing / Improper redirect
Login/logout redirect targets derive from a user-controlled `returnTo` value.
`getSafeReturnTo` only rejects `//`-prefixed values and does not account for
backslash normalization, allowing an open redirect after authentication. Redirect
targets must be validated against path-only patterns that also reject backslashes
and control characters.

### Information Disclosure
`publicUser()` includes `email`, and `/api/stridepool/users/search` returns it to any
authenticated user, enabling bulk email harvesting via `ilike` substring search. User
directory/search responses must not expose other users' email addresses.
CORS is configured with reflected origin + credentials (`origin: true`,
`credentials: true`); this is largely neutralized by SameSite=lax session cookies but
should be constrained to known origins.

### Tampering / Elevation of Privilege (latent, gated)
Eligibility identity status and terms acceptance are self-asserted via
`PATCH /api/stridepool/profile` yet `checkEligibility` trusts
`eligibilityIdentityStatus === "verified"`. This is currently unreachable because
paid play is fully disabled, but when launched identity must be provider-verified,
not self-asserted.

### Money integrity
Ledger is integer-cents and append-only; Stripe webhooks are signature-verified
before any state change; idempotency keys and DB locks guard races. No exploitable
money-integrity defect found in this scan.
