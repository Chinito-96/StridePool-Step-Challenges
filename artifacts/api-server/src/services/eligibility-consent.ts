import { hasCurrentPaidPlayTermsAcceptance, PAID_PLAY_TERMS_VERSION, type User } from "@workspace/db";

// The version lives with the other Paid Play Terms rules in @workspace/db.
// Bumping it there requires every user to accept the updated terms again.
export const PAID_CHALLENGE_TERMS_VERSION = PAID_PLAY_TERMS_VERSION;

export function hasCurrentPaidTermsAcceptance(user: Pick<
  User,
  | "eligibilityAcceptedTerms"
  | "eligibilityAcceptedTermsAt"
  | "eligibilityAcceptedTermsVersion"
>): boolean {
  return hasCurrentPaidPlayTermsAcceptance(user);
}
