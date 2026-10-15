# Stripe Checkout Integration TODO

StridePool already created Stripe Checkout Sessions, so this change only updated the parameters of the two existing calls to match the Checkout Studio configuration. No new files, routes, or infrastructure were added besides this document.

## Values to Replace

None. Both existing Checkout Session calls already use real values for every `sample_only` parameter, and those values were kept as-is:

**Files containing these values:**
- [artifacts/api-server/src/services/stripe-provider.ts](artifacts/api-server/src/services/stripe-provider.ts)

| Field | Challenge entry (`createStripeCheckout`) | Pro membership (`createStripeProCheckout`) |
|-------|------------------------------------------|---------------------------------------------|
| mode | `payment` | `subscription` |
| success_url | `${publicBaseUrl()}/challenge/<id>?checkout=success` | `${publicBaseUrl()}/profile?subscription=success` |
| cancel_url | `${publicBaseUrl()}/challenge/<id>?checkout=cancelled` | `${publicBaseUrl()}/profile?subscription=cancelled` |
| line_items[].price | Created per challenge by `getOrCreatePrice` | Created by `getOrCreateProPrice` |

## Configured Parameters

These parameters were configured in Checkout Studio and are now set on both Checkout Session calls.

**Files containing these parameters:**
- [artifacts/api-server/src/services/stripe-provider.ts](artifacts/api-server/src/services/stripe-provider.ts)

| Parameter | Value |
|-----------|-------|
| ui_mode | `hosted_page` (installed `stripe` SDK is 22.6.0, which is ≥ 21.0.0) |
| billing_address_collection | `auto` |
| phone_number_collection | `{ enabled: true }` |
| automatic_tax | `{ enabled: false }` |
| allow_promotion_codes | `true` |
| submit_type | `auto` |
| consent_collection | `{ terms_of_service: "required", promotions: "auto" }` |
| name_collection | `{ individual: { enabled: true } }` |
| saved_payment_method_options | `{ payment_method_save: "enabled" }` |
| integration_identifier | `hosted_mobile_app_0001` |
| origin_context | `mobile_app` |
| payment_method_collection | `always` (Pro subscription call only; omitted for one-time challenge entry) |

### Parameters removed

- `payment_method_types: ["card"]` was removed from both calls because Checkout Studio no longer configures it. Checkout now offers the payment methods enabled in the Stripe Dashboard (Settings → Payment methods). If you want challenge entries to stay card-only, turn the other methods off there.

### Parameters intentionally kept

These are not Checkout Studio settings, but StridePool's ledger and webhooks depend on them, so removing them would break settlement:

- `customer`, `client_reference_id` — link the session to the StridePool user (also required for saving payment methods).
- `metadata`, `payment_intent_data.metadata` — carry `stridepool_user_id`, `stridepool_challenge_id`, `stridepool_idempotency_key` and fee splits that the `payment_intent.succeeded` webhook reconciles against.
- `subscription_data.metadata` — lets `customer.subscription.*` webhooks flip the user to Pro.
- The `idempotencyKey` request option.

## Setup and Next Steps

### Required Dashboard settings

- **Terms of service URL:** `consent_collection.terms_of_service: "required"` fails unless a Terms of service URL is set in the Dashboard under Settings → Public details. Point it at the StridePool / Paid Play Terms page on stridepool.com. Session creation will error until this is set.
- **Promotion codes:** `allow_promotion_codes: true` only shows a field; create coupons and promotion codes under Product catalog → Coupons if you want to use them.
- **Promotional email consent:** `promotions: "auto"` shows the opt-in checkbox only where required by law. The result is on `session.consent.promotions`; the webhook does not yet listen for `checkout.session.completed`, so nothing stores it today.

### Environment variables (unchanged)

- Development: `STRIPE_SANDBOX_SECRET_KEY` (must start with `sk_test_`), used when `NODE_ENV=development`.
- Production: keys come from the Replit-managed Stripe connection (`REPLIT_CONNECTORS_HOSTNAME`, `REPL_IDENTITY` / `WEB_REPL_RENEWAL`). Never put keys in code.
- The webhook endpoint and secret are created automatically at `${publicBaseUrl()}/api/stripe/webhook`.

### How the flow works

1. The user joins a paid challenge (or upgrades to Pro) in the app.
2. The API calls `createStripeCheckout` / `createStripeProCheckout`, which creates a Stripe-hosted Checkout Session and returns its URL.
3. The user pays on Stripe's page, accepting the terms of service, and is redirected to the success or cancel URL.
4. Stripe sends `payment_intent.succeeded` / `customer.subscription.*` webhooks; StridePool reconciles them into the ledger using the session metadata.

### Testing

Use test mode (`sk_test_` key) and these cards with any future expiry, any CVC and any ZIP:

- `4242 4242 4242 4242` — succeeds
- `4000 0025 0000 3155` — requires 3D Secure authentication
- `4000 0000 0000 9995` — declined (insufficient funds)

Check that the hosted page shows the name, phone, billing address, terms checkbox and promo code field, and that a returning customer sees their saved card.

### Reminders

- Paid play remains gated behind counsel-approved states and compliance checks; these parameter changes do not activate live payments.
- Retest the full join → pay → webhook → ledger flow in the sandbox before going live, since the new consent and collection fields add steps to the hosted page.

## Resources

- https://support.stripe.com
- https://docs.stripe.com/mcp
