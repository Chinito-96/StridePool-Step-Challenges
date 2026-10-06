# Paid Play Terms: where each commitment lives in code

The StridePool Paid Play Terms (version `paid-play-terms-2026-10-06`) promise specific product behavior. This table maps each commitment to the code and test that enforce it. Rules shared by the API, settlement, and tests live in `lib/db/src/stridepool-paid-play-policy.ts` (importable without a database as `@workspace/db/paid-play-policy`).

| Section | Commitment | Enforced in | Tested in |
| --- | --- | --- | --- |
| 1.2 | 13 restricted states, checked at entry and at withdrawal; config cannot re-enable them | `RESTRICTED_PAID_PLAY_STATES`, `ledger-launch-policy.ts`, `ledger.ts` (`withdrawalBlocks`) | `ledger-recovery.test.ts`, `paid-play-policy.test.ts`, `paid-play-refunds.test.ts` |
| 3.4 | Challenge days run midnight to midnight in the challenge time zone (default America/Chicago), regardless of travel | `challenges.time_zone`, `zonedMidnightUtc`, `stridepool-status.ts` | `paid-play-policy.test.ts` (DST), `stridepool-status.test.ts` |
| 3.7 | No grace days in paid challenges | Settlement requires every day verified (`stridepool-money.ts`); no grace logic exists | `stridepool-money.test.ts` |
| 3.8, 7.4 | "At Risk" until a day's 24-hour sync window closes; elimination only after | `getParticipantStatus` | `stridepool-status.test.ts` |
| 4.3 | Leftover cents go to finishers in join (entry id) order | `allocateEqualSplit` used by `settleChallenge` | `paid-play-policy.test.ts`, `stridepool-money.test.ts` |
| 4.4, 5.3 | No-finisher refunds the entry fee only, to the card | `requestOriginalMethodRefund` in `settleChallenge` | `paid-play-refunds.test.ts` |
| 4.5, 5.3 | Cancelled or under-filled challenges refund entry and platform fee | `cancelChallengeWithRefunds`, `findUnderFilledPaidChallenges`, refund scheduler | `paid-play-refunds.test.ts` |
| 5.3 | Leaving before the deadline refunds both fees | `leaveChallenge` | `paid-play-refunds.test.ts` |
| 5.4 | Refunds go to the original card; wallet credit only as a fallback | `services/entry-refunds.ts` (payment intent stored at activation) | `paid-play-refunds.test.ts` |
| 6.3 | $20 minimum, except wallet refund credits and closure | `withdrawAvailableBalance` (`purpose`) | `paid-play-refunds.test.ts` |
| 6.4 | Closure pays the full balance regardless of minimum | `POST /api/paid-play/account-closure` | `paid-play-refunds.test.ts` |
| 7.6 | Settlement no earlier than 48h after the final day ends | `isSettlementHoldActive` in `settleChallenge` and closeout selection | `stridepool-money.test.ts`, `paid-play-policy.test.ts`, closeout DB test |
| 9.6 | Written biometric consent before identity verification | `POST /api/paid-play/biometric-consent`, `paidEntryBlocks` | `paid-play-policy.test.ts` |
| 12.3 | Self-exclusion (immediate) and weekly entry limits | `POST /api/paid-play/self-exclusion`, `PUT /api/paid-play/entry-limit`, `assertWithinWeeklyEntryLimit` | `paid-play-policy.test.ts` |
| 13.3 | Material changes require re-acceptance | `PAID_PLAY_TERMS_VERSION`; bump it with any material change | `paid-play-policy.test.ts` |
| 14 | Official rules in the app at all times; Apple/Google not sponsors | `/paid-play-terms` page | Manual |
| Launch | Paid play closed until the terms' effective date | `terms_effective` launch control, `PAID_PLAY_TERMS_EFFECTIVE_DATE` | `ledger-recovery.test.ts`, `compliance.test.ts` |

## Not yet implemented

- **Device geolocation (1.3).** Eligibility uses the profile state today. A geolocation or IP check at entry and withdrawal is still needed before launch.
- **Identity verification (9.1).** Checkout still treats identity as unverified, so paid entry stays closed. When a KYC provider is added, call it only after `hasCurrentBiometricConsent` is true or a non-biometric method is chosen.
- **Tax forms (6.6).** W-9 collection and 1099 filing should come from Stripe Connect's tax reporting; confirm it is enabled for the connected-account configuration.
- **Automatic settlement for goal and elimination challenges.** The existing closeout job settles ranking challenges only. Daily-goal and elimination pools still need a scheduled settlement pass.
- **Admin cancel, disqualify, and injury-withdrawal tools (3.7, 8.2, 11.2).** `cancelChallengeWithRefunds` and the fee table are ready; admin routes and UI are not.
- **Terms-change notices (13.2).** Version bumps force re-acceptance; a 14-day advance email or in-app notice still needs a sender.
