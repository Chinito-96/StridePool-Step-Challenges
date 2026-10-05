import { ReplitConnectors } from "@replit/connectors-sdk";
import { createHash, randomUUID } from "node:crypto";
import {
  and,
  eq,
  gte,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import {
  db,
  stripeWebhookHealthAlertStatesTable,
  usersTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import {
  hasPersistentStripeWebhookHealthIssue,
  isStripeWebhookHealthAlertable,
  isStripeWebhookHealthRecovery,
  type StripeWebhookHealthStatus,
} from "./stripe-webhook-health-policy";
import {
  getStripeWebhookHealth,
  type StripeWebhookHealth,
} from "./stripe-webhook-health";

const DEFAULT_REVIEW_INTERVAL_MS = 60_000;
const NOTIFICATION_CLAIM_LEASE_MS = 5 * 60_000;

type AlertStatus = Extract<
  StripeWebhookHealthStatus,
  "missing" | "disabled" | "delivery_delayed" | "repeated_failure"
>;

type NotificationClaim = {
  endpointUrl: string;
  endpointId: string | null;
  claimId: string;
  kind: "issue" | "recovery";
  status: AlertStatus;
  incidentId: string;
};

const alertStates = stripeWebhookHealthAlertStatesTable;

async function persistObservation(
  health: StripeWebhookHealth,
  now: Date,
) {
  const endpointUrl = health.endpointUrl;
  if (!endpointUrl || health.status === "unknown") return null;

  const alertable = isStripeWebhookHealthAlertable(health.status);
  const newIncidentId = alertable ? randomUUID() : null;
  const initialValues = {
    endpointUrl,
    endpointId: health.endpointId,
    observedStatus: health.status,
    consecutiveChecks: alertable ? 1 : 0,
    observedSince: now,
    candidateIncidentId: newIncidentId,
    updatedAt: now,
  };
  const [state] = await db.insert(alertStates)
    .values(initialValues)
    .onConflictDoUpdate({
      target: alertStates.endpointUrl,
      set: alertable
        ? {
          endpointId: sql`excluded.endpoint_id`,
          observedStatus: sql`excluded.observed_status`,
          consecutiveChecks: sql`
            CASE
              WHEN ${alertStates.observedStatus} = excluded.observed_status
                THEN ${alertStates.consecutiveChecks} + 1
              ELSE 1
            END
          `,
          observedSince: sql`
            CASE
              WHEN ${alertStates.observedStatus} = excluded.observed_status
                THEN ${alertStates.observedSince}
              ELSE excluded.observed_since
            END
          `,
          candidateIncidentId: sql`
            CASE
              WHEN ${alertStates.observedStatus} = excluded.observed_status
                THEN ${alertStates.candidateIncidentId}
              ELSE excluded.candidate_incident_id
            END
          `,
          updatedAt: now,
        }
        : {
          endpointId: sql`excluded.endpoint_id`,
          observedStatus: sql`excluded.observed_status`,
          consecutiveChecks: 0,
          observedSince: now,
          candidateIncidentId: null,
          updatedAt: now,
        },
    })
    .returning();
  return state ?? null;
}

function claimAvailability(now: Date) {
  return or(
    isNull(alertStates.notificationClaimId),
    isNull(alertStates.notificationClaimedAt),
    lt(
      alertStates.notificationClaimedAt,
      new Date(now.getTime() - NOTIFICATION_CLAIM_LEASE_MS),
    ),
  );
}

async function claimIssueNotification(
  health: StripeWebhookHealth,
  state: NonNullable<Awaited<ReturnType<typeof persistObservation>>>,
  now: Date,
): Promise<NotificationClaim | null> {
  if (!health.endpointUrl
    || !state.candidateIncidentId
    || !isStripeWebhookHealthAlertable(health.status)
    || !hasPersistentStripeWebhookHealthIssue(
      health.status,
      state.consecutiveChecks,
      state.observedSince,
      now,
    )) {
    return null;
  }

  const claimId = randomUUID();
  const [claimed] = await db.update(alertStates)
    .set({
      notificationClaimId: claimId,
      notificationClaimType: "issue",
      notificationClaimStatus: health.status,
      notificationClaimIncidentId: state.candidateIncidentId,
      notificationClaimedAt: now,
      updatedAt: now,
    })
    .where(and(
      eq(alertStates.endpointUrl, health.endpointUrl),
      eq(alertStates.observedStatus, health.status),
      gte(alertStates.consecutiveChecks, state.consecutiveChecks),
      eq(alertStates.candidateIncidentId, state.candidateIncidentId),
      isNull(alertStates.activeIncidentId),
      isNull(alertStates.activeStatus),
      claimAvailability(now),
    ))
    .returning({
      endpointUrl: alertStates.endpointUrl,
      endpointId: alertStates.endpointId,
      status: alertStates.notificationClaimStatus,
      incidentId: alertStates.notificationClaimIncidentId,
    });

  if (!claimed?.status || !claimed.incidentId) return null;
  return {
    ...claimed,
    claimId,
    kind: "issue",
    status: claimed.status as AlertStatus,
    incidentId: claimed.incidentId,
  };
}

async function claimRecoveryNotification(
  health: StripeWebhookHealth,
  state: NonNullable<Awaited<ReturnType<typeof persistObservation>>>,
  now: Date,
): Promise<NotificationClaim | null> {
  if (!health.endpointUrl
    || !state.activeStatus
    || !state.activeIncidentId
    || !isStripeWebhookHealthRecovery(health.status, health.evidenceComplete)) {
    return null;
  }

  const claimId = randomUUID();
  const [claimed] = await db.update(alertStates)
    .set({
      notificationClaimId: claimId,
      notificationClaimType: "recovery",
      notificationClaimStatus: state.activeStatus,
      notificationClaimIncidentId: state.activeIncidentId,
      notificationClaimedAt: now,
      updatedAt: now,
    })
    .where(and(
      eq(alertStates.endpointUrl, health.endpointUrl),
      eq(alertStates.observedStatus, health.status),
      eq(alertStates.activeStatus, state.activeStatus),
      eq(alertStates.activeIncidentId, state.activeIncidentId),
      claimAvailability(now),
    ))
    .returning({
      endpointUrl: alertStates.endpointUrl,
      endpointId: alertStates.endpointId,
      status: alertStates.notificationClaimStatus,
      incidentId: alertStates.notificationClaimIncidentId,
    });

  if (!claimed?.status || !claimed.incidentId) return null;
  return {
    ...claimed,
    claimId,
    kind: "recovery",
    status: claimed.status as AlertStatus,
    incidentId: claimed.incidentId,
  };
}

async function sendSupportNotification(
  claim: NotificationClaim,
  health: StripeWebhookHealth,
): Promise<void> {
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!from) throw new Error("RESEND_FROM_EMAIL is required for webhook-health alerts.");

  const admins = await db.select({ email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.role, "admin"));
  const recipients = [...new Set(
    admins.map(({ email }) => email?.trim()).filter((email): email is string => Boolean(email)),
  )];
  if (recipients.length === 0) {
    throw new Error("No admin email recipients are configured for webhook-health alerts.");
  }

  const endpointKey = createHash("sha256").update(claim.endpointUrl).digest("hex");
  const notificationKind = claim.kind === "issue" ? "incident" : "recovery";
  const subject = claim.kind === "issue"
    ? `Stripe webhook delivery problem: ${claim.status}`
    : `Stripe webhook delivery recovered: ${claim.status}`;
  const text = claim.kind === "issue"
    ? [
      "A managed Stripe webhook delivery problem persisted across at least three health reviews.",
      "",
      `Status: ${claim.status}`,
      `Details: ${health.message}`,
      `Endpoint URL: ${claim.endpointUrl}`,
      `Endpoint ID: ${claim.endpointId ?? "not available"}`,
      `Persistent issue confirmed at: ${health.checkedAt}`,
      `Provider events in review window: ${health.providerEventCount}`,
      `Successfully received events: ${health.receivedEventCount}`,
      `Overdue events: ${health.overdueEventCount}`,
      `Unresolved failed events: ${health.failedEventCount}`,
      "",
      "This alert is informational. It does not change paid-play controls or modify the endpoint.",
    ].join("\n")
    : [
      "A previously reported managed Stripe webhook delivery problem has recovered.",
      "",
      `Previous issue: ${claim.status}`,
      `Current status: ${health.status}`,
      `Details: ${health.message}`,
      `Endpoint URL: ${claim.endpointUrl}`,
      `Endpoint ID: ${claim.endpointId ?? "not available"}`,
      `Recovery checked at: ${health.checkedAt}`,
      "",
      "This recovery notice is informational. Support should verify Stripe delivery history before operational action.",
    ].join("\n");

  const response = await new ReplitConnectors().proxy("resend", "/emails", {
    method: "POST",
    headers: {
      "Idempotency-Key": `stripe-webhook-health:${endpointKey}:${claim.incidentId}:${notificationKind}`,
    },
    body: { from, to: recipients, subject, text },
  });
  if (!response.ok) {
    throw new Error(`Resend rejected the webhook-health notification (HTTP ${response.status}).`);
  }
}

async function finishNotificationClaim(
  claim: NotificationClaim,
  now: Date,
): Promise<void> {
  await db.update(alertStates)
    .set({
      activeStatus: claim.kind === "issue" ? claim.status : null,
      activeIncidentId: claim.kind === "issue" ? claim.incidentId : null,
      notificationClaimId: null,
      notificationClaimType: null,
      notificationClaimStatus: null,
      notificationClaimIncidentId: null,
      notificationClaimedAt: null,
      updatedAt: now,
    })
    .where(and(
      eq(alertStates.endpointUrl, claim.endpointUrl),
      eq(alertStates.notificationClaimId, claim.claimId),
    ));
}

async function releaseNotificationClaim(claim: NotificationClaim): Promise<void> {
  await db.update(alertStates)
    .set({
      notificationClaimId: null,
      notificationClaimType: null,
      notificationClaimStatus: null,
      notificationClaimIncidentId: null,
      notificationClaimedAt: null,
    })
    .where(and(
      eq(alertStates.endpointUrl, claim.endpointUrl),
      eq(alertStates.notificationClaimId, claim.claimId),
    ));
}

async function notifyForHealthReview(health: StripeWebhookHealth): Promise<void> {
  const now = new Date(health.checkedAt);
  const state = await persistObservation(health, now);
  if (!state) return;

  const claim = isStripeWebhookHealthAlertable(health.status)
    ? await claimIssueNotification(health, state, now)
    : await claimRecoveryNotification(health, state, now);
  if (!claim) return;

  try {
    await sendSupportNotification(claim, health);
    await finishNotificationClaim(claim, new Date());
    logger.warn({
      endpointId: claim.endpointId,
      endpointUrl: claim.endpointUrl,
      status: claim.status,
      kind: claim.kind,
    }, "Stripe webhook health support notification sent");
  } catch (error) {
    try {
      await releaseNotificationClaim(claim);
    } catch (releaseError) {
      logger.error({
        err: releaseError,
        endpointUrl: claim.endpointUrl,
        incidentId: claim.incidentId,
      }, "Could not release Stripe webhook health notification claim");
    }
    throw error;
  }
}

/**
 * Returns the usual admin health report and records a support-alert observation.
 * The alert state is informational and does not affect payment controls.
 */
export async function reviewStripeWebhookHealth(): Promise<StripeWebhookHealth> {
  const health = await getStripeWebhookHealth();
  try {
    await notifyForHealthReview(health);
  } catch (error) {
    logger.error({
      err: error,
      endpointId: health.endpointId,
      endpointUrl: health.endpointUrl,
      status: health.status,
    }, "Stripe webhook health notification review failed");
  }
  return health;
}

export function startStripeWebhookHealthScheduler(
  intervalMs = DEFAULT_REVIEW_INTERVAL_MS,
): NodeJS.Timeout {
  let running = false;

  const run = async () => {
    if (running) return;
    running = true;
    try {
      const health = await reviewStripeWebhookHealth();
      logger.info({
        endpointId: health.endpointId,
        status: health.status,
        evidenceComplete: health.evidenceComplete,
      }, "Scheduled Stripe webhook health review completed");
    } catch (error) {
      logger.error({ err: error }, "Scheduled Stripe webhook health review failed");
    } finally {
      running = false;
    }
  };

  void run();
  const timer = setInterval(() => void run(), intervalMs);
  timer.unref();
  return timer;
}