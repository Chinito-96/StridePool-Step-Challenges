# StridePool real-money launch gate

This is a launch-control memo, not legal advice. Paid pooled challenges remain disabled by default. A qualified attorney must review and sign off before `PAID_PLAY_ENABLED=true` or any state is added to `PAID_PLAY_APPROVED_STATES`. Stripe can be connected and exercised in sandbox mode without opening paid play.

## Counsel sign-off required

- Confirm whether the fixed-stake, shared-pool challenge model is lawful in each target jurisdiction, including contest, gambling, sweepstakes, prize, money-transmission, and consumer-protection rules.
- Confirm the published no-finisher refund policy, grace-day and injury-review rules, fee disclosures, terms, age threshold, and required notices.
- Produce the state-by-state allow/deny matrix and document the reason and effective date for every change.
- Confirm identity, age, geolocation, sanctions, tax reporting, responsible-play, complaints, and record-retention obligations.

Until those items are complete, the server returns `paidPlayEnabled=false`, has no approved states, and the UI must not offer a paid checkout.

## Published state availability matrix

**Effective date:** 2026-09-15
**Matrix status:** interim deny-all pending written qualified-counsel approval
**Approval record:** none received; do not set `PAID_PLAY_COUNSEL_APPROVED=true`
**Next review trigger:** before enabling any state, and whenever the challenge rules, fee, refund policy, payout flow, or applicable law changes

The application must keep `PAID_PLAY_APPROVED_STATES` empty while this matrix is in force. Every listed jurisdiction is denied because the fixed-stake shared-pool model and no-finisher refund policy have not received written counsel approval for that jurisdiction.

| Jurisdiction | Status | Effective date | Reason |
| --- | --- | --- | --- |
| AL, AK, AZ, AR, CA, CO, CT, DE, FL, GA, HI, ID, IL, IN, IA, KS, KY, LA, ME, MD, MA, MI, MN, MS, MO, MT, NE, NV, NH, NJ, NM, NY, NC, ND, OH, OK, OR, PA, RI, SC, SD, TN, TX, UT, VT, VA, WA, WV, WI, WY, DC | DENY | 2026-09-15 | `NO_COUNSEL_APPROVAL` |
| AS, GU, MP, PR, VI | DENY | 2026-09-15 | `NO_COUNSEL_APPROVAL` |

After written approval, replace this interim matrix with one row per approved or denied jurisdiction, including the approving counsel or opinion reference, scope of the approval, effective date, and reason for every denial. A state must not be added to the environment variable based on product judgment alone.

## Required participant notices to confirm with counsel

Counsel must approve the final copy, placement, and acknowledgement/recording method for each notice before paid play opens:

- **Age:** participant must be at least 18; explain how age is collected, verified, and rechecked.
- **Identity and sanctions:** explain provider identity verification, beneficial-owner/sanctions screening where applicable, and what happens when verification is pending or fails.
- **Geolocation:** explain that eligibility is jurisdiction-specific, how location is checked, and that location spoofing is prohibited.
- **Fees and tax:** disclose the entry amount, any platform or processing fee, pool calculation, payout timing, tax forms/reporting, and participant responsibility for taxes.
- **Settlement and no-finisher refund:** explain the fixed-stake shared pool, finisher calculation, grace/injury review rules, and that every entry is refunded when there are no finishers.
- **Disputes and complaints:** explain provider disputes, chargebacks, support escalation, response timelines, and that disputes remain separate from settlement and refund events.
- **Responsible play:** state that participation is voluntary, set expectations for spending limits and self-exclusion or pause options, and provide a support contact or process for concerns.
- **Records and privacy:** state what eligibility, identity, location, payment, dispute, source, and settlement records are retained, for how long, why they are retained, and how access/deletion requests are handled where applicable.

## Provider and ledger controls

- The payment provider is the source of truth for authorization, capture, payout, refund, dispute, and failure events.
- The server records provider events in an append-only PostgreSQL ledger and stores a provider receipt in the same transaction. Provider event ids are unique, so duplicate webhook delivery is acknowledged without creating another money event.
- Stripe is connected through Replit-managed configuration; application code does not store or expose API keys. This connection enables hosted checkout, signed webhook reconciliation, and payout onboarding, but never overrides the counsel or reconciliation gates.
- Checkout uses Stripe-hosted Checkout Sessions and real Stripe Price ids. Payout onboarding uses Stripe-hosted Express Account Links.
- Webhooks are accepted only at `/api/stripe/webhook` with a valid Stripe `stripe-signature` over the unparsed request body.
- **Support delivery-health review:** `/admin` shows a separate Stripe webhook delivery panel, refreshed every 60 seconds while open and on “Refresh evidence.” `GET /api/admin/stripe-webhook-health` requires an authenticated database user with the `admin` role. It is not exposed by the public compliance status or participant ledger.
- Review resolves the exact expected URL from the app's persisted managed-webhook record and retrieves that exact endpoint ID from Stripe. Missing and disabled endpoints are distinct alerts. Review does not create, re-enable, rotate, or replace endpoints.
- After signature verification, all webhook event types (including subscription and ignored events) receive durable processing receipts keyed by endpoint, URL, and event ID. Duplicate delivery updates the same receipt; a successful retry resolves active processing failures, and a late failed attempt cannot erase success. No payloads, signing secrets, or API keys are stored in health receipts or returned to support.
- Provider evidence covers eligible Events API records in the last 24 hours, matching endpoint creation time, enabled event types, and live/test mode. Account endpoints (`connect: false`) review platform events only; Connect endpoints (`connect: true`) review connected-account events only. Unrelated platform activity must not be classified as missing Connect deliveries. Compare event IDs with successful signed processing receipts; `pending_webhooks` is not endpoint-specific and is not used as proof of delivery failure. A successfully processed `payment_intent.payment_failed` is an ordinary payment failure, not a webhook outage.
- The 15-minute delivery grace period avoids warning on newly created events. One unresolved processing failure or overdue event produces `delivery_delayed`; three unresolved failed attempts or overdue events produce `repeated_failure`. Failures remain active until that event is successfully processed. `idle` means no eligible recent events, not evidence of an outage.
- A stable monitoring-start baseline is stored once per exact endpoint and URL during provider initialization. Events created before monitoring began are not treated as missed deliveries. Missing baselines, provider/storage errors, unknown Connect scope, and truncated provider results produce `unknown` rather than a healthy result; known delivery failures remain visible even when other evidence is incomplete. Reviews are bounded to 1,000 connected accounts, 100 total event pages, and 10,000 examined events.
- **Informational only:** webhook health never changes provider readiness, the reconciliation approval flag, or paid-play launch controls. Support must inspect the exact endpoint's delivery history in Stripe and reconcile affected records before operational action. A healthy review is not reconciliation approval. Apply the additive health-receipt and monitoring-baseline database schema with the normal schema deployment process before deploying this code.
- Payment success/failure, refunds, disputes, and payout success/failure are normalized from signed Stripe events before they are recorded.
- All money is integer USD cents. Pool allocation uses deterministic largest-remainder rounding so allocated cents reconcile exactly to the pool.
- A no-finisher refund is an explicit `refund_issued` event, not a balance edit. Disputes remain separate events and must not be silently netted.
- Failed payouts remain pending with an auditable retry count until a provider success event is received. A late failure cannot move a payout that is already paid back to retry-pending.
- Checkout, payout onboarding, challenge entry/refund, settlement, provider-event, payout-state, and reconciliation writes use database transactions. Checkout and onboarding idempotency keys are stored in dedicated columns with user-scoped unique constraints rather than inferred from JSON metadata.
- Reconciliation stores an immutable provider report snapshot, signed ledger total, event counts, discrepancy, and matched/mismatch status in PostgreSQL. Replaying a provider report is idempotent and preserves the original audit record.

## Verification evidence

The Safety screen collects age, state, provider identity status, and terms consent, then sends them to the server-side eligibility decision. A successful form response is not sufficient by itself: provider onboarding, signed events, counsel approval, `PAID_PLAY_ENABLED=true`, and `STRIPE_SANDBOX_RECONCILIATION_PASSED=true` are all required.

The reconciliation flag is deliberately manual. Set it only after Stripe test-mode evidence confirms signed capture, duplicate/out-of-order recovery, and a matched persisted reconciliation run for `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`, `payout.paid`, and `payout.failed`. Connecting Stripe alone never enables paid play.

### Provider-backed sandbox reconciliation — 2026-10-01

- In standalone Stripe test account `acct_1ULZZUH12DVa3iB6` and connected account `acct_1ULZwUH12DTsS9se`, genuine test events covered `payment_intent.succeeded` (3), `payment_intent.payment_failed` (2), `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`, `payout.paid` (2), and `payout.failed`. The existing managed webhook remained in place; its exact original event list was restored after a brief test-only filter change.
- For a controlled out-of-order delivery, the newer failure event `evt_3ULaDNH12DTsS9se1SuDHeS8` was delivered before the older success event `evt_3ULaDLH12DTsS9se1nvdXB1D`; persisted receipt timestamps confirm that order. Duplicate resends left exactly one provider receipt and one wallet ledger row for each of the 11 unique Stripe event IDs.
- An independent Stripe test-mode Events API report for `2026-10-01 02:48–03:01 UTC` recorded 11 events and 10,200 cents. Persisted run `reconciliation_6739426f-9629-4e1f-952b-4c1bb82d8f04` (`stripe-sandbox-events-20261001-024800-030100-v1`) is `matched`: provider and ledger totals are both 10,200 cents, discrepancy is zero, and both event counts are 11. The local fixture run was not used.
- `STRIPE_SANDBOX_RECONCILIATION_PASSED=true` is set in the **development environment only**, after the matched run was persisted. `PAID_PLAY_ENABLED` and counsel approval remain unset; no production settings or live Stripe account were changed.
- **Payout follow-up before paid play:** event `evt_1ULa9XH12DTsS9seEAKJlNDG` was named `payout.paid`, but its payout object had `status=failed` and `failure_code=no_account`. The app records payout ledger type from the event name, so the failed payout's projection currently reads `paid`. This does not change the raw event-count reconciliation, but the payout-state behavior must be corrected and retested before enabling paid play.

The final production launch requires all of these controls together:

1. Written counsel approval is recorded and `PAID_PLAY_COUNSEL_APPROVED=true`.
2. `PAID_PLAY_APPROVED_STATES` contains only jurisdictions covered by that approval.
3. `PAID_PLAY_ENABLED=true`.
4. Stripe provider and managed webhook readiness are true.
5. `STRIPE_SANDBOX_RECONCILIATION_PASSED=true` is set after the required evidence is reviewed.