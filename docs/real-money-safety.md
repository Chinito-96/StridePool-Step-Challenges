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
- The server records provider events in an append-only ledger with provider event ids for idempotent replay protection.
- Webhooks require an HMAC signature (`x-provider-signature`) and a configured provider secret.
- All money is integer USD cents. Pool allocation uses deterministic largest-remainder rounding so allocated cents reconcile exactly to the pool.
- A no-finisher refund is an explicit `refund_issued` event, not a balance edit. Disputes remain separate events and must not be silently netted.
- Failed payouts remain pending with an auditable retry count until a provider success or terminal failure event is received.
- The current file ledger is a development adapter. Production must use a transactional PostgreSQL ledger with unique constraints on provider event ids and idempotency keys before real money is enabled.

## Verification evidence

The Safety screen collects age, state, provider identity status, and terms consent, then sends them to the server-side eligibility decision. A successful form response is not sufficient by itself: provider onboarding, signed events, counsel approval, and the server launch flag are all required.