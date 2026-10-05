import assert from "node:assert/strict";
import test from "node:test";
import { checkEligibility, getComplianceStatus, isPaidPlayLaunchEnabled } from "./ledger";
import { projectPayoutEvent, signedLedgerAmountCents } from "./ledger-policy";

const readyProvider = {
  providerName: "Stripe",
  providerReady: true,
  webhookReady: true,
  backfillReady: true,
  sandboxReconciliationPassed: true,
};

const launchEnvironment = {
  PAID_PLAY_ENABLED: "true",
  PAID_PLAY_COUNSEL_APPROVED: "true",
  PAID_PLAY_APPROVED_STATES: "CA, NY",
};

const eligibleParticipant = {
  age: 18,
  state: "CA",
  identityStatus: "verified" as const,
  acceptedTerms: true,
};

test("paid play denies by default without counsel approval or approved states", () => {
  const status = getComplianceStatus(readyProvider, {});

  assert.equal(status.paidPlayEnabled, false);
  assert.equal(status.counselReviewRequired, true);
  assert.deepEqual(status.approvedStates, []);
  assert.equal(
    checkEligibility(eligibleParticipant, readyProvider, {}).eligible,
    false,
  );
});

test("paid play opens only when every launch control is true", () => {
  assert.equal(
    isPaidPlayLaunchEnabled({
      enabled: true,
      counselApproved: true,
      approvedStates: ["CA"],
      ...readyProvider,
    }),
    true,
  );

  for (const missingControl of [
    "enabled",
    "counselApproved",
    "providerReady",
    "webhookReady",
    "backfillReady",
    "sandboxReconciliationPassed",
  ] as const) {
    const controls = {
      enabled: true,
      counselApproved: true,
      approvedStates: ["CA"],
      ...readyProvider,
      [missingControl]: false,
    };
    assert.equal(isPaidPlayLaunchEnabled(controls), false, `missing ${missingControl}`);
  }

  assert.equal(
    isPaidPlayLaunchEnabled({
      enabled: true,
      counselApproved: true,
      approvedStates: [],
      ...readyProvider,
    }),
    false,
    "an empty approved-state list must remain deny-by-default",
  );

  const status = getComplianceStatus(readyProvider, launchEnvironment);
  assert.equal(status.paidPlayEnabled, true);
  assert.equal(checkEligibility(eligibleParticipant, readyProvider, launchEnvironment).eligible, true);
});

test("compliance explains all seven launch controls and each independent blocker", () => {
  const ready = getComplianceStatus(readyProvider, launchEnvironment);
  const ids = [
    "launch_enabled", "counsel_approval", "approved_states", "stripe_provider",
    "managed_webhook", "provider_backfill", "sandbox_reconciliation",
  ];
  assert.deepEqual(ready.launchControls.map((control) => control.id), ids);
  assert.ok(ready.launchControls.every((control) => control.status === "ready"));

  const cases = [
    { id: "launch_enabled", environment: { ...launchEnvironment, PAID_PLAY_ENABLED: "false" } },
    { id: "counsel_approval", environment: { ...launchEnvironment, PAID_PLAY_COUNSEL_APPROVED: "TRUE" } },
    { id: "approved_states", environment: { ...launchEnvironment, PAID_PLAY_APPROVED_STATES: " , " } },
    { id: "stripe_provider", provider: { ...readyProvider, providerReady: false } },
    { id: "managed_webhook", provider: { ...readyProvider, webhookReady: false } },
    { id: "provider_backfill", provider: { ...readyProvider, backfillReady: false } },
    { id: "sandbox_reconciliation", provider: { ...readyProvider, sandboxReconciliationPassed: false } },
  ];
  for (const example of cases) {
    const status = getComplianceStatus(
      example.provider ?? readyProvider,
      example.environment ?? launchEnvironment,
    );
    assert.equal(status.paidPlayEnabled, false);
    const blockers = status.launchControls.filter((control) => control.status === "blocking");
    assert.deepEqual(blockers.map((control) => control.id), [example.id]);
    assert.ok(blockers[0].explanation.length > 20, "blockers must explain corrective action");
    assert.equal(status.launchControls.length, 7);
  }

  const closed = getComplianceStatus({
    ...readyProvider,
    providerReady: false,
    webhookReady: false,
    backfillReady: false,
    sandboxReconciliationPassed: false,
  }, {});
  assert.deepEqual(closed.launchControls.map((control) => control.id), ids);
  assert.ok(closed.launchControls.every((control) => control.status === "blocking"));
  assert.equal(closed.paidPlayEnabled, false);
});

test("compliance never serializes credentials, signing secrets, or raw provider errors", () => {
  // Synthetic markers only; do not read actual credentials in this regression.
  const marker = "synthetic-sensitive-value-do-not-return";
  const provider = {
    ...readyProvider,
    providerReady: false,
    error: marker,
    secretKey: marker,
    webhookSecret: marker,
  };
  const environment = {
    ...launchEnvironment,
    PAID_PLAY_ENABLED: marker,
    PAID_PLAY_COUNSEL_APPROVED: marker,
    STRIPE_SECRET_KEY: marker,
    STRIPE_SANDBOX_SECRET_KEY: marker,
    STRIPE_WEBHOOK_SECRET: marker,
    DATABASE_URL: marker,
  };
  const serialized = JSON.stringify(getComplianceStatus(provider, environment));
  assert.ok(!serialized.includes(marker));
  for (const key of ["secretKey", "webhookSecret", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "DATABASE_URL"]) {
    assert.ok(!serialized.includes(key), `must not expose ${key}`);
  }
});

test("eligibility allows approved states and denies unapproved states", () => {
  const allowed = checkEligibility(eligibleParticipant, readyProvider, launchEnvironment);
  const denied = checkEligibility(
    { ...eligibleParticipant, state: "TX" },
    readyProvider,
    launchEnvironment,
  );

  assert.equal(allowed.eligible, true);
  assert.equal(denied.eligible, false);
  assert.match(denied.reasons.join(" "), /not available in this state/);
});

test("eligibility enforces minimum age, identity, and terms", () => {
  const cases = [
    {
      input: { ...eligibleParticipant, age: 17 },
      reason: "18+",
    },
    {
      input: { ...eligibleParticipant, identityStatus: "pending" as const },
      reason: "identity verification",
    },
    {
      input: { ...eligibleParticipant, acceptedTerms: false },
      reason: "terms and refund policy",
    },
  ];

  for (const { input, reason } of cases) {
    const decision = checkEligibility(input, readyProvider, launchEnvironment);
    assert.equal(decision.eligible, false);
    assert.match(decision.reasons.join(" "), new RegExp(reason, "i"));
  }
});

test("eligibility stays closed until Stripe provider and reconciliation readiness are complete", () => {
  const missingReadiness = [
    { ...readyProvider, providerReady: false },
    { ...readyProvider, webhookReady: false },
    { ...readyProvider, backfillReady: false },
    { ...readyProvider, sandboxReconciliationPassed: false },
  ];

  for (const provider of missingReadiness) {
    const decision = checkEligibility(eligibleParticipant, provider, launchEnvironment);
    assert.equal(decision.eligible, false);
    assert.match(decision.reasons.join(" "), /not enabled for this launch/);
  }

  const noCounsel = checkEligibility(
    eligibleParticipant,
    readyProvider,
    { ...launchEnvironment, PAID_PLAY_COUNSEL_APPROVED: "false" },
  );
  const noApprovedStates = checkEligibility(
    eligibleParticipant,
    readyProvider,
    { ...launchEnvironment, PAID_PLAY_APPROVED_STATES: "" },
  );
  assert.equal(noCounsel.eligible, false);
  assert.equal(noApprovedStates.eligible, false);
});

test("a final failed payout stays pending across both webhook orders and duplicate events", () => {
  const deliveries = [
    { eventType: "payout_succeeded" as const, id: "evt_paid", status: "failed" },
    { eventType: "payout_failed" as const, id: "evt_failed", status: "failed" },
  ];

  for (const order of [deliveries, [...deliveries].reverse()]) {
    let projection: ReturnType<typeof projectPayoutEvent> | undefined;
    for (const event of [...order, ...order]) {
      projection = projectPayoutEvent(
        projection,
        event.eventType,
        event.id,
        event.status,
      );
      assert.equal(projection.status, "retry_pending");
    }
    assert.ok(projection);
    assert.equal(projection.lastProviderEventId, order[1].id);
  }

  // A paid event with a failed payout snapshot keeps its raw event identity;
  // only the materialized payout status is projected from the snapshot.
  const failedSnapshot = projectPayoutEvent(undefined, "payout_succeeded", "evt_paid", "failed");
  assert.deepEqual(failedSnapshot, {
    status: "retry_pending",
    retryCount: 1,
    lastProviderEventId: "evt_paid",
    providerStatus: "failed",
  });

  const previouslyMisprojected = {
    status: "paid" as const,
    retryCount: 0,
    lastProviderEventId: "evt_paid",
    providerStatus: "failed",
  };
  assert.equal(
    projectPayoutEvent(previouslyMisprojected, "payout_failed", "evt_failed", "failed").status,
    "retry_pending",
  );
});

test("a genuinely paid payout remains paid after a late failure notification", () => {
  const paid = projectPayoutEvent(undefined, "payout_succeeded", "evt_paid", "paid");
  const lateFailure = projectPayoutEvent(paid, "payout_failed", "evt_late_failed", "failed");

  assert.equal(paid.status, "paid");
  assert.equal(paid.retryCount, 0);
  assert.deepEqual(lateFailure, paid);
});

test("provider report totals use signed money events", () => {
  assert.equal(signedLedgerAmountCents("payment_succeeded", 1000), 1000);
  assert.equal(signedLedgerAmountCents("refund_issued", 250), -250);
  assert.equal(signedLedgerAmountCents("dispute_opened", 300), -300);
  assert.equal(signedLedgerAmountCents("payout_succeeded", 500), -500);
  assert.equal(signedLedgerAmountCents("payout_failed", 500), 0);
});