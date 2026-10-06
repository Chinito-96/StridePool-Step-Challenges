type StripeLiveEnvironment = {
  NODE_ENV?: string;
  STRIPE_LIVE_PAYOUTS_ENABLED?: string;
};

export function assertProductionStripeCredential(
  environment: StripeLiveEnvironment,
  secretKey: string,
): void {
  if (environment.NODE_ENV !== "production") return;
  if (!secretKey.startsWith("sk_live_") && !secretKey.startsWith("rk_live_")) {
    throw new Error("Production requires a live Stripe connection. Authorize it in Publishing; development sandbox credentials cannot be used in production.");
  }
}

// Keep withdrawals independently controllable: pausing new paid entries must
// not automatically prevent previously earned, reconciled funds being paid out.
export function assertProductionWithdrawalsEnabled(
  environment: StripeLiveEnvironment,
): void {
  if (environment.NODE_ENV === "production" && environment.STRIPE_LIVE_PAYOUTS_ENABLED !== "true") {
    throw new Error("Live withdrawals are locked until production payout readiness is reviewed and STRIPE_LIVE_PAYOUTS_ENABLED is explicitly enabled.");
  }
}
