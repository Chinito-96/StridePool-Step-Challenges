# StridePool real-money launch gate

This is a launch-control memo, not legal advice. Paid pooled challenges remain disabled by default. A qualified attorney must review and sign off before `PAID_PLAY_ENABLED=true` or any state is added to `PAID_PLAY_APPROVED_STATES`.

## Counsel sign-off required

- Confirm whether the fixed-stake, shared-pool challenge model is lawful in each target jurisdiction, including contest, gambling, sweepstakes, prize, money-transmission, and consumer-protection rules.
- Confirm the published no-finisher refund policy, grace-day and injury-review rules, fee disclosures, terms, age threshold, and required notices.
- Produce the state-by-state allow/deny matrix and document the reason and effective date for every change.
- Confirm identity, age, geolocation, sanctions, tax reporting, responsible-play, complaints, and record-retention obligations.

Until those items are complete, the server returns `paidPlayEnabled=false`, has no approved states, and the UI must not offer a paid checkout.

## Provider and ledger controls

- The payment provider is the source of truth for authorization, capture, payout, refund, dispute, and failure events.
- The server records provider events in an append-only PostgreSQL ledger and stores a provider receipt in the same transaction. Provider event ids are unique, so duplicate webhook delivery is acknowledged without creating another money event.
- Stripe is connected through Replit-managed configuration; application code does not store or expose API keys.
- Checkout uses Stripe-hosted Checkout Sessions and real Stripe Price ids. Payout onboarding uses Stripe-hosted Express Account Links.
- Webhooks are accepted only at `/api/stripe/webhook` with a valid Stripe `stripe-signature` over the unparsed request body.
- Payment success/failure, refunds, disputes, and payout success/failure are normalized from signed Stripe events before they are recorded.
- All money is integer USD cents. Pool allocation uses deterministic largest-remainder rounding so allocated cents reconcile exactly to the pool.
- A no-finisher refund is an explicit `refund_issued` event, not a balance edit. Disputes remain separate events and must not be silently netted.
- Failed payouts remain pending with an auditable retry count until a provider success event is received. A late failure cannot move a payout that is already paid back to retry-pending.
- Checkout, payout onboarding, challenge entry/refund, settlement, provider-event, payout-state, and reconciliation writes use database transactions. Checkout and onboarding idempotency keys are stored in dedicated columns with user-scoped unique constraints rather than inferred from JSON metadata.
- Reconciliation stores an immutable provider report snapshot, signed ledger total, event counts, discrepancy, and matched/mismatch status in PostgreSQL. Replaying a provider report is idempotent and preserves the original audit record.

## Verification evidence

The Safety screen collects age, state, provider identity status, and terms consent, then sends them to the server-side eligibility decision. A successful form response is not sufficient by itself: provider onboarding, signed events, counsel approval, `PAID_PLAY_ENABLED=true`, and `STRIPE_SANDBOX_RECONCILIATION_PASSED=true` are all required.

The reconciliation flag is deliberately manual. Set it only after Stripe test-mode evidence confirms signed capture, duplicate/out-of-order recovery, and a matched persisted reconciliation run for `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`, `payout.paid`, and `payout.failed`. Connecting Stripe alone never enables paid play.