/**
 * Rules that the StridePool Paid Play Terms commit the product to. Section
 * numbers refer to the counsel-reviewed Paid Play Terms. Keep this module free
 * of database access so the API, settlement code, and tests share one source.
 */

/** Bump when the Paid Play Terms text changes; users must re-accept (§13.3). */
export const PAID_PLAY_TERMS_VERSION = "paid-play-terms-2026-10-06";

/** Bump when the biometric notice text changes; consent must be re-collected (§9.6). */
export const BIOMETRIC_CONSENT_VERSION = "biometric-notice-2026-10-06";

/**
 * Jurisdictions where Paid Challenges are never offered (§1.2). This list
 * overrides PAID_PLAY_APPROVED_STATES: a state here cannot be enabled by
 * configuration alone.
 */
export const RESTRICTED_PAID_PLAY_STATES = [
  "AZ", "AR", "CT", "DE", "IA", "LA", "MD", "MT", "SC", "SD", "TN", "VT", "WA",
] as const;

export function isRestrictedPaidPlayState(state: string | null | undefined): boolean {
  const normalized = (state ?? "").trim().toUpperCase();
  return (RESTRICTED_PAID_PLAY_STATES as readonly string[]).includes(normalized);
}

/** Challenge days run midnight to midnight in this zone unless a challenge sets another (§3.4). */
export const DEFAULT_CHALLENGE_TIME_ZONE = "America/Chicago";
/** Steps for a day must sync within this many hours after the day ends (§7.4). */
export const SYNC_WINDOW_HOURS = 24;
/** Review period after the final sync window closes, before settlement (§7.6). */
export const REVIEW_PERIOD_HOURS = 24;
/** Self-exclusion requests take effect no later than this (§12.3); we apply them immediately. */
export const SELF_EXCLUSION_MAX_DELAY_BUSINESS_DAYS = 2;
/** Minimum withdrawal, except refunds and account closure (§6.3, §6.4). */
export const MINIMUM_WITHDRAWAL_CENTS = 2_000;
/** Advance notice for material terms changes (§13.2). */
export const TERMS_CHANGE_NOTICE_DAYS = 14;

const HOUR_MS = 60 * 60 * 1000;

function shiftIsoDate(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Offset in minutes of `timeZone` from UTC at the given instant. */
function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** The UTC instant of 12:00:00 a.m. on `isoDate` in `timeZone`. */
export function zonedMidnightUtc(isoDate: string, timeZone: string = DEFAULT_CHALLENGE_TIME_ZONE): Date {
  const naiveUtc = new Date(`${isoDate}T00:00:00.000Z`);
  // Two passes settle the offset across daylight-saving transitions.
  let guess = new Date(naiveUtc.getTime() - zoneOffsetMinutes(naiveUtc, timeZone) * 60_000);
  guess = new Date(naiveUtc.getTime() - zoneOffsetMinutes(guess, timeZone) * 60_000);
  return guess;
}

/** The calendar date in `timeZone` at `instant`. */
export function zonedIsoDate(instant: Date, timeZone: string = DEFAULT_CHALLENGE_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

/** When challenge day `isoDate` ends (§3.4). */
export function challengeDayEndsAt(isoDate: string, timeZone: string = DEFAULT_CHALLENGE_TIME_ZONE): Date {
  return zonedMidnightUtc(shiftIsoDate(isoDate, 1), timeZone);
}

/** When late steps for challenge day `isoDate` stop counting (§7.4). */
export function syncWindowClosesAt(isoDate: string, timeZone: string = DEFAULT_CHALLENGE_TIME_ZONE): Date {
  return new Date(challengeDayEndsAt(isoDate, timeZone).getTime() + SYNC_WINDOW_HOURS * HOUR_MS);
}

/** Settlement may not begin before the final sync window and review period both close (§7.6). */
export function earliestSettlementAt(endDate: string, timeZone: string = DEFAULT_CHALLENGE_TIME_ZONE): Date {
  return new Date(syncWindowClosesAt(endDate, timeZone).getTime() + REVIEW_PERIOD_HOURS * HOUR_MS);
}

export function isSettlementHoldActive(endDate: string, timeZone: string | null | undefined, now: Date): boolean {
  return now < earliestSettlementAt(endDate, timeZone || DEFAULT_CHALLENGE_TIME_ZONE);
}

/**
 * Why an entry stopped participating. Each reason maps to a fixed treatment
 * of the entry fee and platform fee (§5.3 table).
 */
export type EntryExitReason =
  | "left_before_deadline"
  | "challenge_cancelled"
  | "challenge_under_filled"
  | "challenge_voided"
  | "no_finishers"
  | "did_not_finish"
  | "injury_withdrawal"
  | "disqualified_fraud"
  | "disqualified_technical";

export type FeeTreatment = {
  entryFee: "refund" | "stays_in_pool";
  platformFee: "refund" | "retained";
};

export const FEE_TREATMENT: Readonly<Record<EntryExitReason, FeeTreatment>> = {
  left_before_deadline: { entryFee: "refund", platformFee: "refund" },
  challenge_cancelled: { entryFee: "refund", platformFee: "refund" },
  challenge_under_filled: { entryFee: "refund", platformFee: "refund" },
  challenge_voided: { entryFee: "refund", platformFee: "refund" },
  no_finishers: { entryFee: "refund", platformFee: "retained" },
  did_not_finish: { entryFee: "stays_in_pool", platformFee: "retained" },
  injury_withdrawal: { entryFee: "stays_in_pool", platformFee: "retained" },
  disqualified_fraud: { entryFee: "stays_in_pool", platformFee: "retained" },
  disqualified_technical: { entryFee: "refund", platformFee: "refund" },
};

/** Whole-cent refund owed for an exit, per §5.3. */
export function refundCentsFor(reason: EntryExitReason, entryFeeCents: number, platformFeeCents: number): number {
  if (!Number.isInteger(entryFeeCents) || !Number.isInteger(platformFeeCents) || entryFeeCents < 0 || platformFeeCents < 0) {
    throw new Error("Fee amounts must be non-negative whole cents.");
  }
  const treatment = FEE_TREATMENT[reason];
  return (treatment.entryFee === "refund" ? entryFeeCents : 0)
    + (treatment.platformFee === "refund" ? platformFeeCents : 0);
}

/**
 * Leftover cents in an equal split go one cent at a time to finishers in
 * ascending entry-id order (§4.3). Entry ids are assigned at join, so the
 * order is fixed before the challenge starts and can be disclosed.
 */
export function allocateEqualSplit<T extends { id: number }>(poolCents: number, finishers: T[]): Array<{ entry: T; payoutCents: number }> {
  if (!Number.isInteger(poolCents) || poolCents < 0) throw new Error("Pool must be non-negative whole cents.");
  if (!finishers.length) return [];
  const ordered = [...finishers].sort((left, right) => left.id - right.id);
  const base = Math.floor(poolCents / ordered.length);
  const remainder = poolCents % ordered.length;
  return ordered.map((entry, index) => ({ entry, payoutCents: base + (index < remainder ? 1 : 0) }));
}

export const EQUAL_SPLIT_REMAINDER_DISCLOSURE =
  "Leftover cents from an equal split go one cent each to finishers in the order they joined.";

export type PaidPlayAccountState = {
  eligibilityState: string;
  paidPlaySelfExcludedUntil: Date | null;
  paidPlaySelfExcludedPermanently: boolean;
  biometricConsentAt: Date | null;
  biometricConsentVersion: string | null;
  eligibilityAcceptedTerms: boolean;
  eligibilityAcceptedTermsAt: Date | null;
  eligibilityAcceptedTermsVersion: string | null;
};

export function isSelfExcluded(user: Pick<PaidPlayAccountState, "paidPlaySelfExcludedUntil" | "paidPlaySelfExcludedPermanently">, now = new Date()): boolean {
  return user.paidPlaySelfExcludedPermanently
    || (user.paidPlaySelfExcludedUntil !== null && user.paidPlaySelfExcludedUntil > now);
}

export function hasCurrentBiometricConsent(user: Pick<PaidPlayAccountState, "biometricConsentAt" | "biometricConsentVersion">): boolean {
  return user.biometricConsentAt !== null && user.biometricConsentVersion === BIOMETRIC_CONSENT_VERSION;
}

export function hasCurrentPaidPlayTermsAcceptance(user: Pick<PaidPlayAccountState, "eligibilityAcceptedTerms" | "eligibilityAcceptedTermsAt" | "eligibilityAcceptedTermsVersion">): boolean {
  return user.eligibilityAcceptedTerms
    && user.eligibilityAcceptedTermsAt !== null
    && user.eligibilityAcceptedTermsVersion === PAID_PLAY_TERMS_VERSION;
}

/** Account-level reasons that block a new paid entry (§1.2, §9.6, §12.3, §13.3). */
export function paidEntryBlocks(user: PaidPlayAccountState, now = new Date()): string[] {
  const reasons: string[] = [];
  if (isRestrictedPaidPlayState(user.eligibilityState)) reasons.push("Paid Challenges are not available in your state.");
  if (isSelfExcluded(user, now)) reasons.push("Your account is excluded from Paid Challenges at your request.");
  if (!hasCurrentPaidPlayTermsAcceptance(user)) reasons.push("Accept the current Paid Play Terms before entering a Paid Challenge.");
  if (!hasCurrentBiometricConsent(user)) reasons.push("Review the biometric notice and give consent, or request another verification method, before identity verification.");
  return reasons;
}

/** Account-level reasons that block a withdrawal (§1.2 location at withdrawal). */
export function withdrawalBlocks(user: Pick<PaidPlayAccountState, "eligibilityState">): string[] {
  return isRestrictedPaidPlayState(user.eligibilityState)
    ? ["Withdrawals must be requested from a state where Paid Challenges are permitted."]
    : [];
}
