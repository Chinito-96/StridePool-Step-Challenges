export type StripeWebhookHealthStatus =
  | "healthy"
  | "idle"
  | "missing"
  | "disabled"
  | "delivery_delayed"
  | "repeated_failure"
  | "unknown";

export const STRIPE_WEBHOOK_ALERT_PERSISTENCE_CHECKS = 3;
export const STRIPE_WEBHOOK_ALERT_MINIMUM_DURATION_MS = 2 * 60_000;

export function isStripeWebhookHealthAlertable(
  status: StripeWebhookHealthStatus,
): status is "missing" | "disabled" | "delivery_delayed" | "repeated_failure" {
  return status === "missing"
    || status === "disabled"
    || status === "delivery_delayed"
    || status === "repeated_failure";
}

export function hasPersistentStripeWebhookHealthIssue(
  status: StripeWebhookHealthStatus,
  consecutiveChecks: number,
  observedSince: Date | null,
  now: Date,
): boolean {
  return isStripeWebhookHealthAlertable(status)
    && consecutiveChecks >= STRIPE_WEBHOOK_ALERT_PERSISTENCE_CHECKS
    && observedSince !== null
    && now.getTime() - observedSince.getTime() >= STRIPE_WEBHOOK_ALERT_MINIMUM_DURATION_MS;
}

export function isStripeWebhookHealthRecovery(
  status: StripeWebhookHealthStatus,
  evidenceComplete: boolean,
): boolean {
  return evidenceComplete && (status === "healthy" || status === "idle");
}

export function stripeWebhookReceiptKey(
  endpointId: string | null,
  endpointUrl: string | null,
  eventId: string,
): string {
  return JSON.stringify([endpointId, endpointUrl, eventId]);
}

export async function processWebhookWithReceipt<T, E>(
  event: E,
  process: () => Promise<T>,
  persistReceipt: (event: E, succeeded: boolean) => Promise<void>,
): Promise<T> {
  try {
    const result = await process();
    await persistReceipt(event, true);
    return result;
  } catch (processingError) {
    try {
      await persistReceipt(event, false);
    } catch (receiptError) {
      throw new AggregateError(
        [processingError, receiptError],
        "Stripe webhook processing failed and its health receipt could not be persisted.",
      );
    }
    throw processingError;
  }
}

export type StripeWebhookHealthPolicyInput = {
  endpointStatus: "enabled" | "disabled" | "missing" | "unknown";
  providerError?: boolean;
  evidenceComplete: boolean;
  providerEventCount: number;
  receivedEventCount: number;
  overdueEventCount: number;
  failedEventCount: number;
  connectedAccountCoverageIncomplete?: boolean;
  incompleteReason?: string;
};

export type StripeWebhookHealthPolicyResult = {
  status: StripeWebhookHealthStatus;
  message: string;
};

export function evaluateStripeWebhookHealth(
  input: StripeWebhookHealthPolicyInput,
): StripeWebhookHealthPolicyResult {
  const evidenceIsIncomplete = input.endpointStatus === "unknown"
    || input.providerError
    || input.connectedAccountCoverageIncomplete
    || !input.evidenceComplete;
  const incompleteMessage = input.incompleteReason
    ?? (input.connectedAccountCoverageIncomplete
      ? "Connected-account event evidence is incomplete."
      : "Stripe webhook delivery evidence could not be verified completely.");
  const withIncompleteContext = (message: string) =>
    evidenceIsIncomplete ? `${message} ${incompleteMessage}` : message;

  if (input.endpointStatus === "missing") {
    return { status: "missing", message: "The managed Stripe webhook is missing." };
  }
  if (input.endpointStatus === "disabled") {
    return { status: "disabled", message: "The managed Stripe webhook is disabled." };
  }
  if (input.failedEventCount >= 3 || input.overdueEventCount >= 3) {
    return {
      status: "repeated_failure",
      message: withIncompleteContext(
        "Repeated Stripe webhook processing failures or overdue deliveries were found.",
      ),
    };
  }
  if (input.overdueEventCount > 0 || input.failedEventCount > 0) {
    return {
      status: "delivery_delayed",
      message: withIncompleteContext(
        "Stripe events have unresolved processing failures or have not been processed within the delivery grace period.",
      ),
    };
  }
  if (evidenceIsIncomplete) {
    return { status: "unknown", message: incompleteMessage };
  }
  if (input.providerEventCount === 0 && input.receivedEventCount === 0) {
    return { status: "idle", message: "No eligible Stripe events were observed in the review window." };
  }
  return { status: "healthy", message: "Eligible Stripe events are being received and processed." };
}

export type ManagedWebhookLike = {
  id?: string;
  url?: string;
  status?: string;
  connect?: boolean;
};

export type ResolvedManagedWebhook<T extends ManagedWebhookLike> = {
  endpointStatus: "enabled" | "disabled" | "missing" | "unknown";
  endpointId: string | null;
  endpointUrl: string | null;
  endpoint: T | null;
};

function isMissingProviderResource(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const providerError = error as { statusCode?: unknown; code?: unknown };
  return providerError.statusCode === 404 || providerError.code === "resource_missing";
}

/**
 * Resolve only the endpoint that is both persisted by stripe-replit-sync and
 * has the exact expected URL. This intentionally never creates or searches for
 * a replacement endpoint.
 */
export async function resolveExactManagedWebhook<T extends ManagedWebhookLike>(
  expectedUrl: string,
  managedWebhooks: readonly ManagedWebhookLike[],
  retrieve: (id: string) => Promise<T>,
): Promise<ResolvedManagedWebhook<T>> {
  const exact = managedWebhooks.filter((webhook) => webhook.url === expectedUrl);
  if (exact.length === 0) {
    return {
      endpointStatus: "missing",
      endpointId: null,
      endpointUrl: expectedUrl,
      endpoint: null,
    };
  }
  if (exact.length !== 1 || !exact[0]?.id) {
    return {
      endpointStatus: "unknown",
      endpointId: null,
      endpointUrl: expectedUrl,
      endpoint: null,
    };
  }

  const endpointId = exact[0].id;
  try {
    const endpoint = await retrieve(endpointId);
    if (endpoint.id !== endpointId || endpoint.url !== expectedUrl) {
      return {
        endpointStatus: "unknown",
        endpointId,
        endpointUrl: expectedUrl,
        endpoint: null,
      };
    }
    if (endpoint.status === "disabled") {
      return { endpointStatus: "disabled", endpointId, endpointUrl: expectedUrl, endpoint };
    }
    if (endpoint.status !== "enabled") {
      return {
        endpointStatus: "unknown",
        endpointId,
        endpointUrl: expectedUrl,
        endpoint: null,
      };
    }
    return { endpointStatus: "enabled", endpointId, endpointUrl: expectedUrl, endpoint };
  } catch (error) {
    return {
      endpointStatus: isMissingProviderResource(error) ? "missing" : "unknown",
      endpointId,
      endpointUrl: expectedUrl,
      endpoint: null,
    };
  }
}

export type StripeHealthEvent = {
  id: string;
  created: number;
  type: string;
  livemode: boolean;
  account?: string;
};

export type StripeHealthEventPage = {
  data: StripeHealthEvent[];
  has_more: boolean;
};

export type StripeHealthEventListParams = {
  created: { gte: number };
  limit: number;
  starting_after?: string;
};

export type StripeHealthAccountPage = {
  data: Array<{ id: string }>;
  has_more: boolean;
};

export type StripeHealthAccountListParams = {
  limit: number;
  starting_after?: string;
};

export type StripeHealthEvidence = {
  events: StripeHealthEvent[];
  evidenceComplete: boolean;
  connectedAccountCoverageIncomplete: boolean;
  incompleteReason: string | null;
};

export function countOverdueStripeEvents(
  events: readonly StripeHealthEvent[],
  successfulEventIds: ReadonlySet<string>,
  nowEpochSeconds: number,
  graceSeconds = 15 * 60,
): number {
  return events.filter((event) =>
    event.created <= nowEpochSeconds - graceSeconds
    && !successfulEventIds.has(event.id),
  ).length;
}

export function countUnresolvedStripeWebhookFailures(
  receipts: readonly { failedAttemptCount: number; processingSucceeded: boolean }[],
): number {
  return receipts.reduce(
    (total, receipt) => total + (receipt.processingSucceeded ? 0 : receipt.failedAttemptCount),
    0,
  );
}

export async function collectStripeWebhookEvidence(input: {
  listEvents: (
    params: StripeHealthEventListParams,
    connectedAccountId?: string,
  ) => Promise<StripeHealthEventPage>;
  listConnectedAccounts?: (
    params: StripeHealthAccountListParams,
  ) => Promise<StripeHealthAccountPage>;
  nowEpochSeconds: number;
  endpointCreatedEpochSeconds: number;
  monitoringStartedEpochSeconds?: number;
  enabledEvents: readonly string[];
  livemode: boolean;
  connectEndpoint: boolean;
  pageSize?: number;
  maxPages?: number;
  maxAccountPages?: number;
  maxConnectedAccounts?: number;
  maxTotalEventPages?: number;
  maxTotalEvents?: number;
}): Promise<StripeHealthEvidence> {
  const pageSize = input.pageSize ?? 100;
  const maxPagesPerScope = input.maxPages ?? 10;
  const maxAccountPages = input.maxAccountPages ?? 10;
  const maxConnectedAccounts = input.maxConnectedAccounts ?? 1_000;
  const maxTotalEventPages = input.maxTotalEventPages ?? 100;
  const maxTotalEvents = input.maxTotalEvents ?? 10_000;
  const timeWindowStart = Math.max(
    input.endpointCreatedEpochSeconds,
    input.nowEpochSeconds - 24 * 60 * 60,
  );
  const evidenceStart = Math.max(
    timeWindowStart,
    input.monitoringStartedEpochSeconds ?? Number.NEGATIVE_INFINITY,
  );
  const requestStart = Math.ceil(evidenceStart);
  const eventsById = new Map<string, StripeHealthEvent>();
  let eventPagesFetched = 0;
  let eventRecordsFetched = 0;
  let evidenceComplete = true;
  let connectedAccountCoverageIncomplete = false;
  let incompleteReason: string | null = null;

  const addEvents = (page: StripeHealthEventPage, connectedAccountId?: string): void => {
    for (const event of page.data) {
      const eventIsInScope = connectedAccountId
        ? !event.account || event.account === connectedAccountId
        : !event.account;
      if (
        event.created >= timeWindowStart
        && (input.monitoringStartedEpochSeconds === undefined
          || event.created > input.monitoringStartedEpochSeconds)
        && event.created <= input.nowEpochSeconds
        && event.livemode === input.livemode
        && (input.enabledEvents.includes("*") || input.enabledEvents.includes(event.type))
        && eventIsInScope
      ) {
        eventsById.set(event.id, event);
      }
    }
  };

  const collectAccountEvents = async (connectedAccountId?: string): Promise<boolean> => {
    let cursor: string | undefined;
    let hasMore = false;
    for (let pageNumber = 0; pageNumber < maxPagesPerScope; pageNumber += 1) {
      if (eventPagesFetched >= maxTotalEventPages || eventRecordsFetched >= maxTotalEvents) {
        return false;
      }
      let page: StripeHealthEventPage;
      try {
        page = await input.listEvents({
          created: { gte: requestStart },
          limit: Math.min(pageSize, maxTotalEvents - eventRecordsFetched),
          ...(cursor ? { starting_after: cursor } : {}),
        }, connectedAccountId);
      } catch {
        evidenceComplete = false;
        if (connectedAccountId) connectedAccountCoverageIncomplete = true;
        incompleteReason = connectedAccountId
          ? `Stripe Events API evidence could not be loaded for connected account ${connectedAccountId}.`
          : "Stripe platform Events API evidence could not be loaded.";
        return false;
      }
      eventPagesFetched += 1;
      eventRecordsFetched += page.data.length;
      addEvents(page, connectedAccountId);
      hasMore = page.has_more;
      if (!hasMore) return true;
      const lastEvent = page.data.at(-1);
      if (!lastEvent) {
        evidenceComplete = false;
        if (connectedAccountId) connectedAccountCoverageIncomplete = true;
        incompleteReason = "Stripe Events API pagination returned an incomplete page.";
        return false;
      }
      cursor = lastEvent.id;
    }
    if (hasMore) {
      evidenceComplete = false;
      if (connectedAccountId) connectedAccountCoverageIncomplete = true;
      incompleteReason = connectedAccountId
        ? "Connected-account event pagination reached its configured bound."
        : "Platform event pagination reached its configured bound.";
      return false;
    }
    return true;
  };

  // Stripe's connect:true endpoint receives connected-account events only.
  // Platform events belong to connect:false endpoints and must not become
  // expected deliveries for a Connect endpoint.
  if (!input.connectEndpoint) {
    const platformEventsComplete = await collectAccountEvents();
    if (!platformEventsComplete) evidenceComplete = false;
  }

  if (input.connectEndpoint) {
    if (!input.listConnectedAccounts) {
      evidenceComplete = false;
      connectedAccountCoverageIncomplete = true;
      incompleteReason = "Connected-account evidence is unavailable because connected accounts could not be listed.";
    } else {
      const accounts: Array<{ id: string }> = [];
      let accountCursor: string | undefined;
      let accountHasMore = false;
      for (let pageNumber = 0; pageNumber < maxAccountPages; pageNumber += 1) {
        if (accounts.length >= maxConnectedAccounts) {
          accountHasMore = true;
          break;
        }
        let page: StripeHealthAccountPage;
        try {
          page = await input.listConnectedAccounts({
            limit: Math.min(100, maxConnectedAccounts - accounts.length),
            ...(accountCursor ? { starting_after: accountCursor } : {}),
          });
        } catch {
          evidenceComplete = false;
          connectedAccountCoverageIncomplete = true;
          incompleteReason = "Connected accounts could not be listed from Stripe.";
          break;
        }
        accounts.push(...page.data.slice(0, maxConnectedAccounts - accounts.length));
        accountHasMore = page.has_more;
        if (!accountHasMore) break;
        const lastAccount = page.data.at(-1);
        if (!lastAccount) {
          evidenceComplete = false;
          connectedAccountCoverageIncomplete = true;
          incompleteReason = "Connected-account listing pagination returned an incomplete page.";
          break;
        }
        accountCursor = lastAccount.id;
      }
      if (accountHasMore) {
        evidenceComplete = false;
        connectedAccountCoverageIncomplete = true;
        incompleteReason = "Connected-account listing reached its configured bound.";
      }

      for (const account of accounts) {
        if (eventPagesFetched >= maxTotalEventPages || eventRecordsFetched >= maxTotalEvents) {
          evidenceComplete = false;
          connectedAccountCoverageIncomplete = true;
          incompleteReason = "Connected-account event evidence reached its configured total bound.";
          break;
        }
        if (!(await collectAccountEvents(account.id))) {
          evidenceComplete = false;
          connectedAccountCoverageIncomplete = true;
          if (eventPagesFetched >= maxTotalEventPages || eventRecordsFetched >= maxTotalEvents) {
            incompleteReason = "Connected-account event evidence reached its configured total bound.";
            break;
          }
        }
      }
    }
  }

  return {
    events: [...eventsById.values()],
    evidenceComplete,
    connectedAccountCoverageIncomplete,
    incompleteReason,
  };
}