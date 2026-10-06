# Live Stripe preparation

Live-account preparation is not authorization to move money or to open paid play.
Keep the separate development sandbox; never copy its credentials or recipient
identities into live configuration.

## Read-only findings — 2026-10-06

- The currently accessible Stripe API connector returns `livemode=false`.
  Charges and payouts are both disabled on that account. This does not verify
  production-specific Stripe authorization.
- No active deployment or production URL exists. Production webhook delivery
  cannot yet be verified.
- Development reports its provider, signed webhook configuration, and backfill
  ready. Counsel approval, approved states, sandbox reconciliation, and paid play
  remain blocked. Development readiness is not production readiness.
- No charge, transfer, or payout was created during this readiness work.
- API startup succeeds, but development webhook monitoring reports delayed
  delivery and cannot send its support alert because no admin email recipients
  are configured. Signed-webhook configuration being ready is not proof of
  successful delivery or working alerts.

## Production safeguards

- Production refuses test credentials from the managed Stripe connection.
- Production withdrawals default to locked. Both the wallet service and Stripe
  transfer/payout boundary require `STRIPE_LIVE_PAYOUTS_ENABLED=true`.
- Keep that setting absent or false during preparation. Enabling it requires a
  separate payout-readiness review and explicit approval, not merely connecting
  a live account.
- The withdrawal switch is separate from the new-paid-entry launch switch, so
  a later pause of new entries need not automatically freeze legitimate earned
  withdrawals.
- Do not set counsel approval, approved states, reconciliation approval, or
  `PAID_PLAY_ENABLED` to true merely to make the readiness display pass.

## Owner setup and remaining checks

1. In Replit's Publishing tool, use **Manage** on the Stripe connection and
   complete the production/live authorization flow for the intended business
   account. Do not paste keys into chat. Do not replace the development sandbox.
2. Confirm business verification, live payment capability, and Connect
   enrollment/capabilities in that live account. Activation and approval must be
   completed by the owner/Stripe; no live test transaction is needed for this
   configuration review.
3. Review the production database before publishing. New-user sign-in inserts
   now explicitly use zero financial balances, and the schema declares zero
   defaults. Apply/verify the corresponding default changes through the
   publishing schema review; no database migration was run in this preparation.
   Existing
   demo balances, ledger fixtures, and sandbox customer/recipient/subscription
   references must never become spendable live funds. No balances or references
   were deleted during this review. Audit and authorize any cleanup separately.
4. The sandbox onboarding script now lives inside the API package, avoiding
   imports across the scripts package's TypeScript root. It was not executed
   during live preparation; no new sandbox recipients were created.
5. Review live webhook coverage before enabling money movement: current startup
   requests Connect-event delivery only when using the development sandbox
   override. Production must receive and independently verify both platform
   payment/subscription events and connected-account payout events. Do not
   assume adding event names alone subscribes to connected accounts.
6. Only after a separately approved publication, obtain the actual production
   URL from deployment metadata. Confirm it is externally reachable, verify
   managed signing-secret resolution and backfill there, and perform read-only
   checks of the live account and launch status. Configure owner-approved
   webhook-health alert recipients and confirm alert delivery; resolve any
   delayed-delivery evidence before treating webhook operations as ready.
7. Complete legal jurisdiction approval and genuine payment/payout
   reconciliation before opening paid play or approving the payout switch.
   Paid entry also deliberately requires server-verified identity evidence
   which is not yet integrated: checkout currently treats identity as
   `not_started`. Never replace that with client-editable profile claims just
   to open paid play.

No deployment, live account change, legal approval, wallet cleanup, or end-to-end
live payout verification is implied by this checklist.

Reference: https://docs.replit.com/features/monetization/stripe-payments
