import type Stripe from "stripe";
import { and, eq, gte, inArray, max, sql } from "drizzle-orm";
import {
  db,
  stripeWebhookHealthBaselinesTable,
  stripeWebhookHealthReceiptsTable,
} from "@workspace/db";
import {
  collectStripeWebhookEvidence,
  countUnresolvedStripeWebhookFailures,
  countOverdueStripeEvents,
  evaluateStripeWebhookHealth,
  processWebhookWithReceipt,
  resolveExactManagedWebhook,
  stripeWebhookReceiptKey,
  type StripeWebhookHealthStatus,
} from "./stripe-webhook-health-policy";
import { getStripeSync, getUncachableStripeClient } from "../stripeClient";

const reviewWindowMs = 24 * 60 * 60 * 1_000;
const deliveryGraceSeconds = 15 * 60;

let runtimeEndpointIdentity: {
  endpointId: string;
  endpointUrl: string;
  connectEndpoint: boolean;
} | undefined;

export type StripeWebhookHealth = {
  status: StripeWebhookHealthStatus;
  message: string;
  checkedAt: string;
  endpointId: string | null;
  endpointUrl: string | null;
  providerEventCount: number;
  receivedEventCount: number;
  overdueEventCount: number;
  failedEventCount: number;
  lastReceivedAt: string | null;
  evidenceComplete: boolean;
};

function expectedWebhookUrl(): string | null {
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  return domain ? `https://${domain}/api/stripe/webhook` : null;
}

export function setStripeWebhookEndpointIdentity(
  endpointId: string,
  endpointUrl: string,
  connectEndpoint: boolean,
): void {
  runtimeEndpointIdentity = { endpointId, endpointUrl, connectEndpoint };
}

export async function initializeStripeWebhookHealthBaseline(
  endpointId: string,
  endpointUrl: string,
  monitoringStartedAt = new Date(),
): Promise<Date> {
  const table = stripeWebhookHealthBaselinesTable;
  await db.insert(table).values({
    endpointId,
    endpointUrl,
    monitoringStartedAt,
  }).onConflictDoNothing();
  const [baseline] = await db.select({ monitoringStartedAt: table.monitoringStartedAt })
    .from(table)
    .where(and(eq(table.endpointId, endpointId), eq(table.endpointUrl, endpointUrl)))
    .limit(1);
  if (!baseline) throw new Error("Stripe webhook monitoring baseline could not be loaded.");
  return baseline.monitoringStartedAt;
}

async function receiptEndpointId(endpointUrl: string | null): Promise<string | null> {
  if (!endpointUrl) return null;
  if (runtimeEndpointIdentity?.endpointUrl === endpointUrl) {
    return runtimeEndpointIdentity.endpointId;
  }
  try {
    const managedWebhooks = await (await getStripeSync()).listManagedWebhooks();
    const exact = managedWebhooks.filter((webhook) => webhook.url === endpointUrl);
    return exact.length === 1 && exact[0]?.id ? exact[0].id : null;
  } catch {
    // Persist the verified receipt even if endpoint lookup is temporarily
    // unavailable. It will not count as evidence for an endpoint until its ID
    // can be matched exactly on a later delivery.
    return null;
  }
}

async function persistSignedReceipt(
  event: Stripe.Event,
  succeeded: boolean,
): Promise<void> {
  const endpointUrl = expectedWebhookUrl();
  const endpointId = await receiptEndpointId(endpointUrl);
  const receivedAt = new Date();
  const table = stripeWebhookHealthReceiptsTable;
  const values = {
    receiptKey: stripeWebhookReceiptKey(endpointId, endpointUrl, event.id),
    eventId: event.id,
    endpointId,
    endpointUrl,
    eventType: event.type,
    eventCreatedAt: new Date(event.created * 1_000),
    livemode: event.livemode,
    receivedAt,
    ...(succeeded
      ? { successfulAt: receivedAt, processingSucceeded: true }
      : { lastFailedAt: receivedAt, failedAttemptCount: 1 }),
  };

  await db.insert(table).values(values).onConflictDoUpdate({
    target: table.receiptKey,
    set: {
      receivedAt,
      ...(succeeded
        ? { successfulAt: receivedAt, processingSucceeded: true }
        : {
          lastFailedAt: receivedAt,
          failedAttemptCount: sql`${table.failedAttemptCount} + 1`,
        }),
    },
  });
}

export async function processSignedStripeWebhook<T>(
  event: Stripe.Event,
  process: () => Promise<T>,
): Promise<T> {
  return processWebhookWithReceipt(event, process, persistSignedReceipt);
}

function unknownHealth(
  checkedAt: string,
  endpointUrl: string | null,
  message = "Stripe webhook delivery evidence could not be verified completely.",
  endpointId: string | null = null,
): StripeWebhookHealth {
  return {
    status: "unknown",
    message,
    checkedAt,
    endpointId,
    endpointUrl,
    providerEventCount: 0,
    receivedEventCount: 0,
    overdueEventCount: 0,
    failedEventCount: 0,
    lastReceivedAt: null,
    evidenceComplete: false,
  };
}

async function healthWithKnownFailures(
  checkedAt: string,
  endpointUrl: string,
  endpointId: string | null,
  message: string,
  now: Date,
): Promise<StripeWebhookHealth> {
  let failedEventCount = 0;
  if (endpointId) {
    try {
      const table = stripeWebhookHealthReceiptsTable;
      const baselineTable = stripeWebhookHealthBaselinesTable;
      const [baseline] = await db.select({ monitoringStartedAt: baselineTable.monitoringStartedAt })
        .from(baselineTable)
        .where(and(
          eq(baselineTable.endpointId, endpointId),
          eq(baselineTable.endpointUrl, endpointUrl),
        ))
        .limit(1);
      const lastKnownFailureSince = baseline?.monitoringStartedAt
        ?? new Date(now.getTime() - reviewWindowMs);
      const rows = await db.select({
        failedAttemptCount: table.failedAttemptCount,
        processingSucceeded: table.processingSucceeded,
      }).from(table).where(and(
        eq(table.endpointId, endpointId),
        eq(table.processingSucceeded, false),
        gte(table.lastFailedAt, lastKnownFailureSince),
      ));
      failedEventCount = countUnresolvedStripeWebhookFailures(rows);
    } catch {
      // The incomplete state below remains explicit if receipt storage is also
      // unavailable. Never turn a storage error into a healthy result.
    }
  }
  const policy = evaluateStripeWebhookHealth({
    endpointStatus: "unknown",
    evidenceComplete: false,
    providerError: true,
    providerEventCount: 0,
    receivedEventCount: 0,
    overdueEventCount: 0,
    failedEventCount,
    incompleteReason: message,
  });
  return {
    status: policy.status,
    message: policy.message,
    checkedAt,
    endpointId,
    endpointUrl,
    providerEventCount: 0,
    receivedEventCount: 0,
    overdueEventCount: 0,
    failedEventCount,
    lastReceivedAt: null,
    evidenceComplete: false,
  };
}

export async function getStripeWebhookHealth(): Promise<StripeWebhookHealth> {
  const checkedAtDate = new Date();
  const checkedAt = checkedAtDate.toISOString();
  const nowEpochSeconds = Math.floor(checkedAtDate.getTime() / 1_000);
  const endpointUrl = expectedWebhookUrl();
  if (!endpointUrl) {
    return unknownHealth(
      checkedAt,
      null,
      "The expected Stripe webhook URL is unavailable.",
    );
  }

  let stripe: Stripe;
  let sync: Awaited<ReturnType<typeof getStripeSync>>;
  let managedWebhooks: Awaited<ReturnType<Awaited<ReturnType<typeof getStripeSync>>["listManagedWebhooks"]>>;
  try {
    [stripe, sync] = await Promise.all([getUncachableStripeClient(), getStripeSync()]);
    managedWebhooks = await sync.listManagedWebhooks();
  } catch {
    return unknownHealth(checkedAt, endpointUrl);
  }

  const resolution = await resolveExactManagedWebhook(
    endpointUrl,
    managedWebhooks,
    async (id) => stripe.webhookEndpoints.retrieve(id),
  );
  if (resolution.endpointStatus === "missing") {
    return {
      status: "missing",
      message: "The managed Stripe webhook is missing.",
      checkedAt,
      endpointId: resolution.endpointId,
      endpointUrl,
      providerEventCount: 0,
      receivedEventCount: 0,
      overdueEventCount: 0,
      failedEventCount: 0,
      lastReceivedAt: null,
      evidenceComplete: false,
    };
  }
  if (resolution.endpointStatus === "disabled") {
    return {
      status: "disabled",
      message: "The managed Stripe webhook is disabled.",
      checkedAt,
      endpointId: resolution.endpointId,
      endpointUrl,
      providerEventCount: 0,
      receivedEventCount: 0,
      overdueEventCount: 0,
      failedEventCount: 0,
      lastReceivedAt: null,
      evidenceComplete: false,
    };
  }
  if (resolution.endpointStatus === "unknown" || !resolution.endpoint) {
    return healthWithKnownFailures(
      checkedAt,
      endpointUrl,
      resolution.endpointId,
      "Stripe endpoint identity could not be verified.",
      checkedAtDate,
    );
  }

  const endpoint = resolution.endpoint;
  const persistedEndpoint = managedWebhooks.find((webhook) => webhook.url === endpointUrl);
  const hasRuntimeScope = (
    runtimeEndpointIdentity?.endpointId === resolution.endpointId
      && runtimeEndpointIdentity.endpointUrl === endpointUrl
  );
  const endpointConnectScope = (hasRuntimeScope
    ? runtimeEndpointIdentity?.connectEndpoint
    : (endpoint as Stripe.WebhookEndpoint & { connect?: boolean }).connect
      ?? (persistedEndpoint as (Stripe.WebhookEndpoint & { connect?: boolean }) | undefined)?.connect
      ?? (process.env.NODE_ENV === "development"
        ? Boolean(process.env.STRIPE_SANDBOX_SECRET_KEY)
        : undefined));
  const endpointConnectScopeKnown = typeof endpointConnectScope === "boolean";
  const endpointConnect = endpointConnectScope ?? false;

  const table = stripeWebhookHealthReceiptsTable;
  const baselineTable = stripeWebhookHealthBaselinesTable;
  let baselineDate: Date;
  try {
    const [baseline] = await db.select({ monitoringStartedAt: baselineTable.monitoringStartedAt })
      .from(baselineTable)
      .where(and(
        eq(baselineTable.endpointId, resolution.endpointId!),
        eq(baselineTable.endpointUrl, endpointUrl),
      ))
      .limit(1);
    if (!baseline) {
      return healthWithKnownFailures(
        checkedAt,
        endpointUrl,
        resolution.endpointId,
        "Stripe webhook monitoring has no persisted start baseline yet.",
        checkedAtDate,
      );
    }
    baselineDate = baseline.monitoringStartedAt;
  } catch {
    return healthWithKnownFailures(
      checkedAt,
      endpointUrl,
      resolution.endpointId,
      "Stripe webhook monitoring baseline could not be loaded.",
      checkedAtDate,
    );
  }

  const endpointReceiptFilters = and(
    eq(table.endpointId, resolution.endpointId!),
    eq(table.livemode, endpoint.livemode),
  );
  const twentyFourHoursAgo = new Date(checkedAtDate.getTime() - reviewWindowMs);
  let receivedEventCount = 0;
  let failedEventCount = 0;
  let lastReceivedAt: string | null = null;
  let receiptDataError = false;
  try {
    const [recentSuccessRows, failureRows, lastSuccessRows] = await Promise.all([
      db.select({ eventId: table.eventId })
        .from(table)
        .where(and(
          endpointReceiptFilters,
          eq(table.processingSucceeded, true),
          gte(table.successfulAt, new Date(Math.max(
            twentyFourHoursAgo.getTime(),
            baselineDate.getTime(),
          ))),
        )),
      db.select({
        failedAttemptCount: table.failedAttemptCount,
        processingSucceeded: table.processingSucceeded,
      })
        .from(table)
        .where(and(
          endpointReceiptFilters,
          gte(table.lastFailedAt, baselineDate),
        )),
      db.select({ lastReceivedAt: max(table.successfulAt) })
        .from(table)
        .where(and(
          endpointReceiptFilters,
          eq(table.processingSucceeded, true),
          gte(table.successfulAt, baselineDate),
        )),
    ]);
    receivedEventCount = recentSuccessRows.length;
    failedEventCount = countUnresolvedStripeWebhookFailures(failureRows);
    const lastReceivedAtValue = lastSuccessRows[0]?.lastReceivedAt;
    lastReceivedAt = lastReceivedAtValue instanceof Date
      ? lastReceivedAtValue.toISOString()
      : null;
  } catch {
    receiptDataError = true;
  }

  const evidence = await collectStripeWebhookEvidence({
    listEvents: async (params, connectedAccountId) => {
      const page = await stripe.events.list(
        params,
        connectedAccountId ? { stripeAccount: connectedAccountId } : undefined,
      );
      return { data: page.data, has_more: page.has_more };
    },
    listConnectedAccounts: endpointConnect
      ? async (params) => {
        const page = await stripe.accounts.list(params);
        return {
          data: page.data.map((account) => ({ id: account.id })),
          has_more: page.has_more,
        };
      }
      : undefined,
    nowEpochSeconds,
    endpointCreatedEpochSeconds: endpoint.created,
    monitoringStartedEpochSeconds: baselineDate.getTime() / 1_000,
    enabledEvents: endpoint.enabled_events,
    livemode: endpoint.livemode,
    connectEndpoint: endpointConnect,
  });

  const providerEventIds = evidence.events.map((event) => event.id);
  let overdueEventCount = 0;
  if (!receiptDataError && providerEventIds.length > 0) {
    try {
      const successfulProviderEventIds = new Set((await db.select({ eventId: table.eventId })
        .from(table)
        .where(and(
          eq(table.endpointId, resolution.endpointId!),
          eq(table.processingSucceeded, true),
          gte(table.successfulAt, baselineDate),
          inArray(table.eventId, providerEventIds),
        ))).map((receipt) => receipt.eventId));
      overdueEventCount = countOverdueStripeEvents(
        evidence.events,
        successfulProviderEventIds,
        nowEpochSeconds,
        deliveryGraceSeconds,
      );
    } catch {
      receiptDataError = true;
    }
  }
  const connectedAccountCoverageIncomplete = evidence.connectedAccountCoverageIncomplete
    || !endpointConnectScopeKnown;
  const evidenceComplete = evidence.evidenceComplete
    && !receiptDataError
    && endpointConnectScopeKnown;
  const incompleteReason = [
    receiptDataError ? "Signed Stripe webhook receipts could not be read from storage." : null,
    evidence.incompleteReason,
    !endpointConnectScopeKnown
      ? "Managed webhook Connect scope has not been initialized from app configuration."
      : null,
  ].filter((reason): reason is string => Boolean(reason)).join(" ") || undefined;
  const policy = evaluateStripeWebhookHealth({
    endpointStatus: resolution.endpointStatus,
    evidenceComplete,
    providerError: receiptDataError,
    providerEventCount: evidence.events.length,
    receivedEventCount,
    overdueEventCount,
    failedEventCount,
    connectedAccountCoverageIncomplete,
    incompleteReason,
  });

  return {
    status: policy.status,
    message: policy.message,
    checkedAt,
    endpointId: resolution.endpointId,
    endpointUrl,
    providerEventCount: evidence.events.length,
    receivedEventCount,
    overdueEventCount,
    failedEventCount,
    lastReceivedAt,
    evidenceComplete,
  };
}