import Stripe from "stripe";
import { StripeSync } from "stripe-replit-sync";

type StripeCredentials = {
  secretKey: string;
  webhookSecret?: string;
};

let runtimeWebhookSecret: string | undefined;

async function getStripeCredentials(): Promise<StripeCredentials> {
  const sandboxSecretKey = process.env.STRIPE_SANDBOX_SECRET_KEY;

  if (process.env.NODE_ENV === "development" && sandboxSecretKey) {
    if (!sandboxSecretKey.startsWith("sk_test_")) {
      throw new Error("STRIPE_SANDBOX_SECRET_KEY must be a Stripe test-mode secret key.");
    }

    return {
      secretKey: sandboxSecretKey,
      ...(runtimeWebhookSecret ? { webhookSecret: runtimeWebhookSecret } : {}),
    };
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? `repl ${process.env.REPL_IDENTITY}`
    : process.env.WEB_REPL_RENEWAL
      ? `depl ${process.env.WEB_REPL_RENEWAL}`
      : null;

  if (!hostname || !xReplitToken) {
    throw new Error("The Replit-managed Stripe connection is unavailable.");
  }

  const response = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=stripe`,
    {
      headers: {
        Accept: "application/json",
        X_REPLIT_TOKEN: xReplitToken,
      },
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!response.ok) {
    throw new Error(`Unable to load the Stripe connection (${response.status}).`);
  }

  const data = await response.json() as {
    items?: Array<{
      settings?: {
        secret_key?: string;
        secret?: string;
        webhook_secret?: string;
      };
    }>;
  };
  const settings = data.items?.[0]?.settings;
  const secretKey = settings?.secret_key ?? settings?.secret;
  if (!secretKey) {
    throw new Error("The Replit-managed Stripe connection has no secret key.");
  }

  return {
    secretKey,
    webhookSecret:
      process.env.STRIPE_WEBHOOK_SECRET
      ?? settings?.webhook_secret
      ?? runtimeWebhookSecret,
  };
}

export async function getUncachableStripeClient(): Promise<Stripe> {
  const { secretKey } = await getStripeCredentials();
  return new Stripe(secretKey);
}

export async function getStripeWebhookSecret(): Promise<string> {
  const credentials = await getStripeCredentials();
  if (credentials.webhookSecret) return credentials.webhookSecret;

  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    const stripeSync = new StripeSync({
      poolConfig: { connectionString: databaseUrl },
      stripeSecretKey: credentials.secretKey,
      stripeWebhookSecret: "",
    });
    const managedWebhooks = await stripeSync.listManagedWebhooks();
    const domain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
    const expectedUrl = domain
      ? `https://${domain}/api/stripe/webhook`
      : undefined;
    const webhook = expectedUrl
      ? managedWebhooks.find((candidate) =>
        candidate.url === expectedUrl
        && typeof (candidate as Stripe.WebhookEndpoint & { secret?: unknown }).secret === "string",
      )
      : undefined;
    const persistedSecret = (webhook as (Stripe.WebhookEndpoint & { secret?: unknown }) | undefined)?.secret;
    if (typeof persistedSecret === "string" && persistedSecret.length > 0) {
      return persistedSecret;
    }
  }

  throw new Error("The managed Stripe webhook signing secret is unavailable.");
}

export function setRuntimeStripeWebhookSecret(secret: string): void {
  runtimeWebhookSecret = secret;
}

export async function hasStripeWebhookSecret(): Promise<boolean> {
  try {
    await getStripeWebhookSecret();
    return true;
  } catch {
    return false;
  }
}

export async function getStripeSync(): Promise<StripeSync> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for Stripe sync.");

  const { secretKey, webhookSecret } = await getStripeCredentials();
  return new StripeSync({
    poolConfig: { connectionString: databaseUrl },
    stripeSecretKey: secretKey,
    stripeWebhookSecret: webhookSecret ?? "",
  });
}