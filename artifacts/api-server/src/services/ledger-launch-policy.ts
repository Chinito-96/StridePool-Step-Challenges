import type {
  ComplianceStatus,
  EligibilityDecision,
  EligibilityInput,
  PaidPlayLaunchControl,
} from "@workspace/api-zod";

export type LaunchEnvironment = Readonly<Record<string, string | undefined>>;

export type LaunchProviderStatus = {
  providerReady: boolean;
  webhookReady: boolean;
  backfillReady: boolean;
  sandboxReconciliationPassed: boolean;
};

const providerName = "Stripe";

type PaidPlayLaunchInput = {
  enabled: boolean;
  counselApproved: boolean;
  approvedStates: string[];
  providerReady: boolean;
  webhookReady: boolean;
  backfillReady: boolean;
  sandboxReconciliationPassed: boolean;
};

function readApprovedStates(environment: LaunchEnvironment): string[] {
  return (environment.PAID_PLAY_APPROVED_STATES ?? "")
    .split(",")
    .map((state) => state.trim().toUpperCase())
    .filter(Boolean);
}

function getPaidPlayLaunchControls(input: PaidPlayLaunchInput): PaidPlayLaunchControl[] {
  const control = (
    id: PaidPlayLaunchControl["id"],
    ready: boolean,
    readyExplanation: string,
    blockingExplanation: string,
  ): PaidPlayLaunchControl => ({
    id,
    status: ready ? "ready" : "blocking",
    explanation: ready ? readyExplanation : blockingExplanation,
  });
  // Only fixed messages and readiness booleans belong in this public response.
  return [
    control("launch_enabled", input.enabled,
      "The paid-play launch switch is enabled.",
      "Keep paid play disabled until all other controls are ready, then set PAID_PLAY_ENABLED=true."),
    control("counsel_approval", input.counselApproved,
      "Written counsel approval is marked as recorded.",
      "Obtain and record written qualified-counsel approval before setting PAID_PLAY_COUNSEL_APPROVED=true."),
    control("approved_states", input.approvedStates.length > 0,
      "An approved-jurisdiction list is configured.",
      "After written counsel approval, add only covered jurisdictions to PAID_PLAY_APPROVED_STATES."),
    control("stripe_provider", input.providerReady,
      "Stripe provider initialization is complete.",
      "Confirm the managed Stripe connection is authorized and resolve provider initialization failures in server logs."),
    control("managed_webhook", input.webhookReady,
      "Managed webhook signature-verification configuration is ready.",
      "Complete managed webhook initialization and confirm signature verification is configured for /api/stripe/webhook."),
    control("provider_backfill", input.backfillReady,
      "Stripe provider backfill is complete.",
      "Resolve Stripe sync backfill failures in server logs and rerun provider initialization until backfill completes."),
    control("sandbox_reconciliation", input.sandboxReconciliationPassed,
      "Sandbox reconciliation is marked as approved.",
      "Review signed sandbox payment, refund, dispute, and payout evidence plus a matched persisted reconciliation run before setting STRIPE_SANDBOX_RECONCILIATION_PASSED=true."),
  ];
}

export function isPaidPlayLaunchEnabled(input: PaidPlayLaunchInput): boolean {
  return getPaidPlayLaunchControls(input).every((control) => control.status === "ready");
}

function eligibilityReasons(input: EligibilityInput, status: ComplianceStatus): string[] {
  const reasons: string[] = [];
  if (!Number.isInteger(input.age)) reasons.push("Age must be a whole number.");
  if (input.age < status.minAge) reasons.push(`Paid play is available only to people ${status.minAge}+.`);
  if (!status.approvedStates.length) {
    reasons.push("Paid play is paused while state-by-state counsel review is pending.");
  } else if (status.counselReviewRequired) {
    reasons.push("Paid play is paused until written qualified-counsel approval is recorded.");
  } else if (!status.approvedStates.includes(input.state.toUpperCase())) {
    reasons.push("Paid play is not available in this state.");
  }
  if (input.identityStatus !== "verified") reasons.push("Complete identity verification before a paid entry.");
  if (!input.acceptedTerms) reasons.push("Accept the paid-challenge terms and refund policy.");
  if (!status.providerConfigured) reasons.push("Payment and payout providers are not connected yet.");
  return reasons;
}

export function getComplianceStatus(
  provider: LaunchProviderStatus,
  environment: LaunchEnvironment,
): ComplianceStatus {
  const approvedStates = readApprovedStates(environment);
  const counselApproved = environment.PAID_PLAY_COUNSEL_APPROVED === "true";
  const providerConfigured = provider.providerReady && provider.webhookReady;
  const launchControls = getPaidPlayLaunchControls({
    enabled: environment.PAID_PLAY_ENABLED === "true",
    counselApproved,
    approvedStates,
    providerReady: provider.providerReady,
    webhookReady: provider.webhookReady,
    backfillReady: provider.backfillReady,
    sandboxReconciliationPassed: provider.sandboxReconciliationPassed,
  });
  return {
    paidPlayEnabled: launchControls.every((control) => control.status === "ready"),
    launchControls,
    providerConfigured,
    providerName,
    webhookReady: provider.webhookReady,
    sandboxReconciliationPassed: provider.sandboxReconciliationPassed,
    counselReviewRequired: !counselApproved || approvedStates.length === 0,
    minAge: 18,
    approvedStates,
    requirements: [
      "18 or older",
      "Identity verified by the payment provider",
      "State eligibility confirmed after counsel review",
      "Paid-challenge terms and refund policy accepted",
      "Geolocation, tax, dispute, responsible-play, and record-retention notices acknowledged",
      "Settlement, refund, dispute, and payout-retry events reconciled from the provider",
    ],
    settlementPolicy: [
      "All amounts are stored as integer USD cents; no floating-point balance math",
      "Winner shares use deterministic largest-remainder rounding and must reconcile to the pool",
      "No-finisher refunds and provider disputes are separate immutable events",
      "Failed payouts remain pending and carry a retry count until reconciled by the provider",
    ],
  };
}

export function checkEligibility(
  input: EligibilityInput,
  provider: LaunchProviderStatus,
  environment: LaunchEnvironment,
): EligibilityDecision {
  const status = getComplianceStatus(provider, environment);
  const reasons = eligibilityReasons(input, status);
  return {
    eligible: reasons.length === 0 && status.paidPlayEnabled,
    reasons: status.paidPlayEnabled ? reasons : [...reasons, "Paid play is not enabled for this launch."],
    checkedAt: new Date(),
  };
}