import assert from "node:assert/strict";
import test from "node:test";
import {
  collectStripeWebhookEvidence,
  countOverdueStripeEvents,
  countUnresolvedStripeWebhookFailures,
  evaluateStripeWebhookHealth,
  hasPersistentStripeWebhookHealthIssue,
  isStripeWebhookHealthAlertable,
  isStripeWebhookHealthRecovery,
  processWebhookWithReceipt,
  resolveExactManagedWebhook,
  stripeWebhookReceiptKey,
  type StripeHealthEvent,
} from "./stripe-webhook-health-policy";

const expectedUrl = "https://stridepool.example/api/stripe/webhook";

test("health policy distinguishes idle, delayed, repeated failures, and unknown evidence", () => {
  assert.equal(evaluateStripeWebhookHealth({
    endpointStatus: "enabled",
    evidenceComplete: true,
    providerEventCount: 1,
    receivedEventCount: 0,
    overdueEventCount: 0,
    failedEventCount: 1,
  }).status, "delivery_delayed");
  assert.equal(evaluateStripeWebhookHealth({
    endpointStatus: "enabled",
    evidenceComplete: true,
    providerEventCount: 0,
    receivedEventCount: 0,
    overdueEventCount: 0,
    failedEventCount: 0,
  }).status, "idle");
  assert.equal(evaluateStripeWebhookHealth({
    endpointStatus: "enabled",
    evidenceComplete: true,
    providerEventCount: 3,
    receivedEventCount: 2,
    overdueEventCount: 1,
    failedEventCount: 0,
  }).status, "delivery_delayed");
  assert.equal(evaluateStripeWebhookHealth({
    endpointStatus: "enabled",
    evidenceComplete: true,
    providerEventCount: 3,
    receivedEventCount: 0,
    overdueEventCount: 3,
    failedEventCount: 0,
  }).status, "repeated_failure");
  assert.equal(evaluateStripeWebhookHealth({
    endpointStatus: "enabled",
    evidenceComplete: true,
    providerEventCount: 5,
    receivedEventCount: 3,
    overdueEventCount: 0,
    failedEventCount: 3,
  }).status, "repeated_failure");
  assert.equal(evaluateStripeWebhookHealth({
    endpointStatus: "enabled",
    evidenceComplete: false,
    providerEventCount: 0,
    receivedEventCount: 0,
    overdueEventCount: 0,
    failedEventCount: 0,
  }).status, "unknown");
  const incompleteButKnownFailures = evaluateStripeWebhookHealth({
    endpointStatus: "enabled",
    evidenceComplete: false,
    connectedAccountCoverageIncomplete: true,
    providerError: true,
    providerEventCount: 8,
    receivedEventCount: 2,
    overdueEventCount: 0,
    failedEventCount: 3,
  });
  assert.equal(incompleteButKnownFailures.status, "repeated_failure");
  assert.match(incompleteButKnownFailures.message, /Connected-account/i);
  assert.equal(evaluateStripeWebhookHealth({
    endpointStatus: "enabled",
    evidenceComplete: false,
    connectedAccountCoverageIncomplete: true,
    providerError: true,
    providerEventCount: 8,
    receivedEventCount: 2,
    overdueEventCount: 1,
    failedEventCount: 0,
  }).status, "delivery_delayed");
  assert.equal(evaluateStripeWebhookHealth({
    endpointStatus: "enabled",
    providerError: true,
    evidenceComplete: false,
    providerEventCount: 0,
    receivedEventCount: 0,
    overdueEventCount: 0,
    failedEventCount: 0,
  }).status, "unknown");
  assert.equal(evaluateStripeWebhookHealth({
    endpointStatus: "disabled",
    providerError: true,
    evidenceComplete: false,
    providerEventCount: 0,
    receivedEventCount: 0,
    overdueEventCount: 0,
    failedEventCount: 0,
  }).status, "disabled");
  assert.equal(evaluateStripeWebhookHealth({
    endpointStatus: "enabled",
    providerError: true,
    evidenceComplete: true,
    providerEventCount: 5,
    receivedEventCount: 5,
    overdueEventCount: 0,
    failedEventCount: 0,
  }).status, "unknown");
  assert.equal(evaluateStripeWebhookHealth({
    endpointStatus: "enabled",
    evidenceComplete: true,
    connectedAccountCoverageIncomplete: true,
    providerEventCount: 0,
    receivedEventCount: 0,
    overdueEventCount: 0,
    failedEventCount: 0,
  }).status, "unknown");
});

test("support alerts require repeated, sustained known failures and complete evidence for recovery", () => {
  const startedAt = new Date("2026-10-05T12:00:00.000Z");
  assert.equal(isStripeWebhookHealthAlertable("missing"), true);
  assert.equal(isStripeWebhookHealthAlertable("disabled"), true);
  assert.equal(isStripeWebhookHealthAlertable("delivery_delayed"), true);
  assert.equal(isStripeWebhookHealthAlertable("repeated_failure"), true);
  assert.equal(isStripeWebhookHealthAlertable("unknown"), false);
  assert.equal(hasPersistentStripeWebhookHealthIssue(
    "delivery_delayed",
    2,
    startedAt,
    new Date("2026-10-05T12:05:00.000Z"),
  ), false);
  assert.equal(hasPersistentStripeWebhookHealthIssue(
    "delivery_delayed",
    3,
    startedAt,
    new Date("2026-10-05T12:01:59.999Z"),
  ), false);
  assert.equal(hasPersistentStripeWebhookHealthIssue(
    "delivery_delayed",
    3,
    startedAt,
    new Date("2026-10-05T12:02:00.000Z"),
  ), true);
  assert.equal(hasPersistentStripeWebhookHealthIssue(
    "unknown",
    10,
    startedAt,
    new Date("2026-10-05T12:10:00.000Z"),
  ), false);
  assert.equal(isStripeWebhookHealthRecovery("healthy", true), true);
  assert.equal(isStripeWebhookHealthRecovery("idle", true), true);
  assert.equal(isStripeWebhookHealthRecovery("healthy", false), false);
  assert.equal(isStripeWebhookHealthRecovery("unknown", false), false);
});

test("managed endpoint resolution requires one exact persisted URL and a matching live retrieve", async () => {
  let retrievedId: string | undefined;
  const retrieve = async (id: string) => {
    retrievedId = id;
    return { id, url: expectedUrl, status: "enabled" };
  };
  const resolved = await resolveExactManagedWebhook(
    expectedUrl,
    [{ id: "we_123", url: expectedUrl }],
    retrieve,
  );
  assert.equal(resolved.endpointStatus, "enabled");
  assert.equal(resolved.endpointId, "we_123");
  assert.equal(retrievedId, "we_123");

  const missing = await resolveExactManagedWebhook(expectedUrl, [], retrieve);
  assert.equal(missing.endpointStatus, "missing");
  assert.equal(retrievedId, "we_123", "missing endpoints must not trigger a provider retrieve");

  const disabled = await resolveExactManagedWebhook(expectedUrl, [{ id: "we_123", url: expectedUrl }], async (id) => ({
    id,
    url: expectedUrl,
    status: "disabled",
  }));
  assert.equal(disabled.endpointStatus, "disabled");

  const duplicate = await resolveExactManagedWebhook(expectedUrl, [
    { id: "we_123", url: expectedUrl },
    { id: "we_456", url: expectedUrl },
  ], retrieve);
  assert.equal(duplicate.endpointStatus, "unknown");
  const wrongLiveUrl = await resolveExactManagedWebhook(
    expectedUrl,
    [{ id: "we_123", url: expectedUrl }],
    async (id) => ({ id, url: "https://other.example/webhook", status: "enabled" }),
  );
  assert.equal(wrongLiveUrl.endpointStatus, "unknown");

  const retrievalError = await resolveExactManagedWebhook(expectedUrl, [{ id: "we_123", url: expectedUrl }], async () => {
    throw new Error("provider unavailable");
  });
  assert.equal(retrievalError.endpointStatus, "unknown");
  const deletedEndpoint = await resolveExactManagedWebhook(
    expectedUrl,
    [{ id: "we_123", url: expectedUrl }],
    async () => {
      throw Object.assign(new Error("resource missing"), { statusCode: 404 });
    },
  );
  assert.equal(deletedEndpoint.endpointStatus, "missing");
  assert.equal(deletedEndpoint.endpointId, "we_123");
});

test("provider evidence paginates within bounds and filters by endpoint age, mode, event type, and account", async () => {
  const first: StripeHealthEvent[] = [
    { id: "evt_old", created: 100, type: "charge.refunded", livemode: false },
    { id: "evt_valid", created: 900, type: "payment_intent.payment_failed", livemode: false },
  ];
  const second: StripeHealthEvent[] = [
    { id: "evt_live", created: 950, type: "charge.refunded", livemode: true },
    { id: "evt_unenabled", created: 950, type: "customer.created", livemode: false },
    { id: "evt_connected", created: 950, type: "charge.refunded", livemode: false, account: "acct_1" },
  ];
  const params: Array<{ created: { gte: number }; limit: number; starting_after?: string }> = [];
  const evidence = await collectStripeWebhookEvidence({
    listEvents: async (request) => {
      params.push(request);
      return params.length === 1 ? { data: first, has_more: true } : { data: second, has_more: false };
    },
    nowEpochSeconds: 1_000,
    endpointCreatedEpochSeconds: 850,
    enabledEvents: ["charge.refunded", "payment_intent.payment_failed"],
    livemode: false,
    connectEndpoint: false,
    pageSize: 2,
  });

  assert.deepEqual(evidence.events.map((event) => event.id), ["evt_valid"]);
  assert.equal(evidence.evidenceComplete, true);
  assert.deepEqual(params.map((request) => request.created.gte), [850, 850]);
  assert.equal(params[1]?.starting_after, "evt_valid");
});

test("Connect evidence excludes overdue platform events but detects overdue connected-account events", async () => {
  const accountRequests: Array<{ limit: number; starting_after?: string }> = [];
  const eventScopes: Array<string | undefined> = [];
  const evidence = await collectStripeWebhookEvidence({
    listEvents: async (_params, connectedAccountId) => {
      eventScopes.push(connectedAccountId);
      const event = connectedAccountId
        ? {
          id: `evt_${connectedAccountId}`,
          created: 950,
          type: "charge.refunded",
          livemode: false,
          account: connectedAccountId,
        }
        : {
          id: "evt_platform",
          created: 950,
          type: "payment_intent.payment_failed",
          livemode: false,
        };
      return { data: [event], has_more: false };
    },
    listConnectedAccounts: async (params) => {
      accountRequests.push(params);
      return accountRequests.length === 1
        ? { data: [{ id: "acct_a" }], has_more: true }
        : { data: [{ id: "acct_b" }], has_more: false };
    },
    nowEpochSeconds: 2_000,
    endpointCreatedEpochSeconds: 800,
    monitoringStartedEpochSeconds: 900,
    enabledEvents: ["charge.refunded", "payment_intent.payment_failed"],
    livemode: false,
    connectEndpoint: true,
    pageSize: 10,
    maxAccountPages: 2,
    maxConnectedAccounts: 5,
    maxTotalEventPages: 10,
    maxTotalEvents: 100,
  });

  assert.deepEqual(evidence.events.map((event) => event.id).sort(), [
    "evt_acct_a",
    "evt_acct_b",
  ]);
  assert.equal(evidence.evidenceComplete, true);
  assert.equal(evidence.connectedAccountCoverageIncomplete, false);
  assert.deepEqual(accountRequests.map((request) => request.starting_after), [undefined, "acct_a"]);
  assert.deepEqual(eventScopes, ["acct_a", "acct_b"]);
  const delivered = new Set(["evt_acct_a", "evt_acct_b"]);
  const policyInput = {
    endpointStatus: "enabled" as const,
    evidenceComplete: evidence.evidenceComplete,
    providerEventCount: evidence.events.length,
    receivedEventCount: delivered.size,
    failedEventCount: 0,
  };
  assert.equal(evaluateStripeWebhookHealth({
    ...policyInput,
    overdueEventCount: countOverdueStripeEvents(evidence.events, delivered, 2_000),
  }).status, "healthy", "Unreceived overdue platform activity must not warn for a Connect endpoint");
  delivered.delete("evt_acct_b");
  assert.equal(evaluateStripeWebhookHealth({
    ...policyInput,
    receivedEventCount: delivered.size,
    overdueEventCount: countOverdueStripeEvents(evidence.events, delivered, 2_000),
  }).status, "delivery_delayed", "An overdue connected-account event must warn");
});

test("Connect listing and Events API errors leave explicit incomplete evidence", async () => {
  const accountError = await collectStripeWebhookEvidence({
    listEvents: async (_params, accountId) => {
      if (accountId) throw new Error("Events API denied");
      return {
        data: [{ id: "evt_platform_known", created: 950, type: "charge.refunded", livemode: false }],
        has_more: false,
      };
    },
    listConnectedAccounts: async () => ({ data: [{ id: "acct_1" }], has_more: false }),
    nowEpochSeconds: 1_000,
    endpointCreatedEpochSeconds: 800,
    enabledEvents: ["charge.refunded"],
    livemode: false,
    connectEndpoint: true,
    maxTotalEventPages: 10,
  });
  assert.deepEqual(accountError.events.map((event) => event.id), []);
  assert.equal(accountError.evidenceComplete, false);
  assert.equal(accountError.connectedAccountCoverageIncomplete, true);
  assert.match(accountError.incompleteReason ?? "", /acct_1/);

  const accountListError = await collectStripeWebhookEvidence({
    listEvents: async () => ({ data: [], has_more: false }),
    listConnectedAccounts: async () => {
      throw new Error("Account list denied");
    },
    nowEpochSeconds: 1_000,
    endpointCreatedEpochSeconds: 800,
    enabledEvents: ["charge.refunded"],
    livemode: false,
    connectEndpoint: true,
  });
  assert.equal(accountListError.evidenceComplete, false);
  assert.equal(accountListError.connectedAccountCoverageIncomplete, true);
  assert.match(accountListError.incompleteReason ?? "", /connected accounts could not be listed/i);
});

test("a successfully processed payment failure is not a delivery failure", () => {
  const event: StripeHealthEvent = {
    id: "evt_payment_failed",
    created: 900,
    type: "payment_intent.payment_failed",
    livemode: false,
  };
  assert.equal(countOverdueStripeEvents([event], new Set([event.id]), 2_000), 0);
  assert.equal(countOverdueStripeEvents([event], new Set(), 2_000), 1);
});

test("monitoring baseline excludes earlier events and recovered receipts clear active failures", async () => {
  const evidence = await collectStripeWebhookEvidence({
    listEvents: async () => ({
      data: [
        { id: "evt_before_baseline", created: 899, type: "charge.refunded", livemode: false },
        { id: "evt_at_baseline", created: 900, type: "charge.refunded", livemode: false },
        { id: "evt_after_baseline", created: 950, type: "charge.refunded", livemode: false },
      ],
      has_more: false,
    }),
    nowEpochSeconds: 1_000,
    endpointCreatedEpochSeconds: 800,
    monitoringStartedEpochSeconds: 900,
    enabledEvents: ["charge.refunded"],
    livemode: false,
    connectEndpoint: false,
  });
  assert.deepEqual(evidence.events.map((event) => event.id), ["evt_after_baseline"]);

  assert.equal(countUnresolvedStripeWebhookFailures([
    { failedAttemptCount: 2, processingSucceeded: false },
    { failedAttemptCount: 5, processingSucceeded: true },
  ]), 2);
  assert.equal(evaluateStripeWebhookHealth({
    endpointStatus: "enabled",
    evidenceComplete: true,
    providerEventCount: 1,
    receivedEventCount: 1,
    overdueEventCount: 0,
    failedEventCount: 0,
  }).status, "healthy");
});

test("signed receipt wrapper supports duplicate event IDs, recovery, and late failures", async () => {
  const receipts = new Map<string, {
    succeeded: boolean;
    failedAttemptCount: number;
  }>();
  const endpointId = "we_receipt_test";
  const eventUrl = expectedUrl;
  const writer = async (event: { id: string }, succeeded: boolean) => {
    const key = stripeWebhookReceiptKey(endpointId, eventUrl, event.id);
    const current = receipts.get(key) ?? { succeeded: false, failedAttemptCount: 0 };
    receipts.set(key, {
      succeeded: current.succeeded || succeeded,
      failedAttemptCount: current.failedAttemptCount + (succeeded ? 0 : 1),
    });
  };
  const duplicateEvent = { id: "evt_duplicate" };
  await processWebhookWithReceipt(duplicateEvent, async () => "accepted", writer);
  await processWebhookWithReceipt(duplicateEvent, async () => "accepted", writer);
  assert.equal(receipts.size, 1);
  assert.deepEqual(receipts.get(stripeWebhookReceiptKey(endpointId, eventUrl, duplicateEvent.id)), {
    succeeded: true,
    failedAttemptCount: 0,
  });
  await assert.rejects(processWebhookWithReceipt(
    duplicateEvent,
    async () => { throw new Error("late processing error"); },
    writer,
  ));
  assert.deepEqual(receipts.get(stripeWebhookReceiptKey(endpointId, eventUrl, duplicateEvent.id)), {
    succeeded: true,
    failedAttemptCount: 1,
  });

  const recoveredEvent = { id: "evt_recovered" };
  await assert.rejects(processWebhookWithReceipt(
    recoveredEvent,
    async () => { throw new Error("first attempt failed"); },
    writer,
  ));
  await processWebhookWithReceipt(recoveredEvent, async () => "accepted", writer);
  assert.deepEqual(receipts.get(stripeWebhookReceiptKey(endpointId, eventUrl, recoveredEvent.id)), {
    succeeded: true,
    failedAttemptCount: 1,
  });
  assert.notEqual(stripeWebhookReceiptKey(endpointId, eventUrl, duplicateEvent.id),
    stripeWebhookReceiptKey("we_other_endpoint", eventUrl, duplicateEvent.id));
});

test("bounded pagination or unconfigured Connect scope can never be reported complete", async () => {
  const evidence = await collectStripeWebhookEvidence({
    listEvents: async () => ({
      data: [{ id: "evt_platform", created: 950, type: "charge.refunded", livemode: false }],
      has_more: true,
    }),
    nowEpochSeconds: 1_000,
    endpointCreatedEpochSeconds: 800,
    enabledEvents: ["charge.refunded"],
    livemode: false,
    connectEndpoint: true,
    maxPages: 1,
  });
  assert.equal(evidence.evidenceComplete, false);
  assert.equal(evidence.connectedAccountCoverageIncomplete, true);
});

test("connected-account event and total pagination bounds return partial evidence as incomplete", async () => {
  const evidence = await collectStripeWebhookEvidence({
    listEvents: async (_params, accountId) => ({
      data: [{
        id: accountId ? `evt_${accountId}` : "evt_platform",
        created: 950,
        type: "charge.refunded",
        livemode: false,
        ...(accountId ? { account: accountId } : {}),
      }],
      has_more: false,
    }),
    listConnectedAccounts: async () => ({
      data: [{ id: "acct_1" }, { id: "acct_2" }],
      has_more: false,
    }),
    nowEpochSeconds: 1_000,
    endpointCreatedEpochSeconds: 800,
    enabledEvents: ["charge.refunded"],
    livemode: false,
    connectEndpoint: true,
    maxTotalEventPages: 1,
  });

  assert.deepEqual(evidence.events.map((event) => event.id), ["evt_acct_1"]);
  assert.equal(evidence.evidenceComplete, false);
  assert.equal(evidence.connectedAccountCoverageIncomplete, true);
  assert.match(evidence.incompleteReason ?? "", /configured total bound/);
});