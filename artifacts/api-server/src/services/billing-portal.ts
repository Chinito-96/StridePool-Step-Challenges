import type Stripe from "stripe";

type BillingMember = {
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus: string;
};

export function canManageBilling(user: BillingMember): boolean {
  return Boolean(user.stripeCustomerId && user.stripeSubscriptionId
    && ["active", "trialing", "past_due", "unpaid", "paused"].includes(user.subscriptionStatus));
}

// Dedicated configuration: no plan changes, cancellation preserves the paid period.
export async function openBillingPortal(stripe: Stripe, user: BillingMember, returnUrl: string) {
  if (!canManageBilling(user)) throw new Error("This account has no subscription to manage.");
  const configurations = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
  const configuration = configurations.data.find((item) =>
    item.metadata?.stridepool_portal === "membership_v1")
    ?? await stripe.billingPortal.configurations.create({
      business_profile: { headline: "Manage your StridePool membership" },
      features: {
        payment_method_update: { enabled: true },
        subscription_cancel: { enabled: true, mode: "at_period_end" },
        subscription_update: { enabled: false },
      },
      metadata: { stridepool_portal: "membership_v1" },
    });
  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId!,
    configuration: configuration.id,
    return_url: returnUrl,
  });
  if (!session.url) throw new Error("Stripe did not return a billing portal URL.");
  return { portalUrl: session.url };
}