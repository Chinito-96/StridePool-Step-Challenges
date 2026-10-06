import type Stripe from "stripe";

// Match the installed SDK's v2 schema and scope the version to Connect.
// Endive removes account-link configurations; upgrade schema and SDK together.
export const CONNECT_API_VERSION = "2026-08-26.dahlia";

type PayoutMember = {
  id: string;
  email: string | null;
  stripeConnectAccountId: string | null;
};

export async function openPayoutOnboarding(
  stripe: Pick<Stripe, "v2">,
  user: PayoutMember,
  idempotencyKey: string,
  baseUrl: string,
  saveAccountId: (accountId: string) => Promise<void>,
) {
  let accountId = user.stripeConnectAccountId;
  if (!accountId) {
    if (!user.email?.trim()) {
      throw new Error("An email address is required on your StridePool account before linking a bank account.");
    }
    const account = await stripe.v2.core.accounts.create({
      contact_email: user.email.trim(),
      identity: { country: "US" },
      dashboard: "express",
      defaults: {
        responsibilities: {
          fees_collector: "application",
          losses_collector: "application",
        },
      },
      configuration: {
        recipient: {
          capabilities: {
            stripe_balance: { stripe_transfers: { requested: true } },
          },
        },
      },
      metadata: { stridepool_user_id: user.id },
    }, {
      apiVersion: CONNECT_API_VERSION,
      idempotencyKey: `${idempotencyKey}-account-v2`,
    });
    accountId = account.id;
    // Persist before generating the link so a failed link can reuse the account.
    await saveAccountId(accountId);
  }

  const accountLink = await stripe.v2.core.accountLinks.create({
    account: accountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: {
        configurations: ["recipient"],
        collection_options: { fields: "eventually_due" },
        refresh_url: `${baseUrl}/wallet?onboarding=refresh`,
        return_url: `${baseUrl}/wallet?onboarding=return`,
      },
    },
  }, { apiVersion: CONNECT_API_VERSION });
  return { accountId, accountLink };
}
