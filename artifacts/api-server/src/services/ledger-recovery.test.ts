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

test("late payout failure cannot regress a payout already marked paid", () => {
  const failed = projectPayoutEvent(undefined, "payout_failed", "evt_failed");
  const paid = projectPayoutEvent(failed, "payout_succeeded", "evt_paid");
  const lateFailure = projectPayoutEvent(paid, "payout_failed", "evt_late_failed");

  assert.deepEqual(failed, {
    status: "retry_pending",
    retryCount: 1,
    lastProviderEventId: "evt_failed",
  });
  assert.equal(paid.status, "paid");
  assert.equal(paid.retryCount, 1);
  assert.deepEqual(lateFailure, paid);
});

test("provider report totals use signed money events", () => {
  assert.equal(signedLedgerAmountCents("payment_succeeded", 1000), 1000);
  assert.equal(signedLedgerAmountCents("refund_issued", 250), -250);
  assert.equal(signedLedgerAmountCents("dispute_opened", 300), -300);
  assert.equal(signedLedgerAmountCents("payout_succeeded", 500), -500);
  assert.equal(signedLedgerAmountCents("payout_failed", 500), 0);
});