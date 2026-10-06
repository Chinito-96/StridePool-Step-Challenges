import type { User } from "@workspace/db";

// Bump this whenever the paid-challenge terms or refund policy wording changes.
export const PAID_CHALLENGE_TERMS_VERSION = "paid-challenge-v1";

export function hasCurrentPaidTermsAcceptance(user: Pick<
  User,
  | "eligibilityAcceptedTerms"
  | "eligibilityAcceptedTermsAt"
  | "eligibilityAcceptedTermsVersion"
>): boolean {
  return user.eligibilityAcceptedTerms
    && user.eligibilityAcceptedTermsAt !== null
    && user.eligibilityAcceptedTermsVersion === PAID_CHALLENGE_TERMS_VERSION;
}
