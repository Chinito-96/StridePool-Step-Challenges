import assert from "node:assert/strict";
import test from "node:test";
import {
  allocateEqualSplit,
  BIOMETRIC_CONSENT_VERSION,
  challengeDayEndsAt,
  earliestSettlementAt,
  FEE_TREATMENT,
  isRestrictedPaidPlayState,
  isSelfExcluded,
  isSettlementHoldActive,
  PAID_PLAY_TERMS_VERSION,
  paidEntryBlocks,
  refundCentsFor,
  RESTRICTED_PAID_PLAY_STATES,
  syncWindowClosesAt,
  withdrawalBlocks,
  zonedIsoDate,
  zonedMidnightUtc,
  type PaidPlayAccountState,
} from "@workspace/db/paid-play-policy";

test("§1.2: the thirteen restricted states are blocked, case-insensitively", () => {
  assert.equal(RESTRICTED_PAID_PLAY_STATES.length, 13);
  for (const state of ["AZ", "ar", " ct ", "DE", "IA", "LA", "MD", "MT", "SC", "SD", "TN", "VT", "WA"]) {
    assert.equal(isRestrictedPaidPlayState(state), true, state);
  }
  for (const state of ["IL", "IN", "CA", "NY", "", null, undefined]) {
    assert.equal(isRestrictedPaidPlayState(state), false, String(state));
  }
});

test("§3.4: challenge days follow the challenge time zone across daylight saving", () => {
  assert.equal(zonedMidnightUtc("2026-09-01", "America/Chicago").toISOString(), "2026-09-01T05:00:00.000Z");
  assert.equal(zonedMidnightUtc("2026-11-01", "America/Chicago").toISOString(), "2026-11-01T05:00:00.000Z");
  assert.equal(zonedMidnightUtc("2026-11-02", "America/Chicago").toISOString(), "2026-11-02T06:00:00.000Z");
  assert.equal(zonedMidnightUtc("2026-03-08", "America/Chicago").toISOString(), "2026-03-08T06:00:00.000Z");
  assert.equal(zonedMidnightUtc("2026-03-09", "America/Chicago").toISOString(), "2026-03-09T05:00:00.000Z");
  assert.equal(zonedMidnightUtc("2026-09-01", "America/Los_Angeles").toISOString(), "2026-09-01T07:00:00.000Z");
  assert.equal(zonedIsoDate(new Date("2026-09-02T04:59:59Z"), "America/Chicago"), "2026-09-01");
  assert.equal(zonedIsoDate(new Date("2026-09-02T05:00:00Z"), "America/Chicago"), "2026-09-02");
  // A traveller's own time zone never changes the boundary.
  assert.equal(challengeDayEndsAt("2026-09-01", "America/Chicago").toISOString(), "2026-09-02T05:00:00.000Z");
});

test("§7.4 and §7.6: sync window is 24h after the day; settlement waits 24h more", () => {
  assert.equal(syncWindowClosesAt("2026-09-05", "America/Chicago").toISOString(), "2026-09-07T05:00:00.000Z");
  assert.equal(earliestSettlementAt("2026-09-05", "America/Chicago").toISOString(), "2026-09-08T05:00:00.000Z");
  assert.equal(isSettlementHoldActive("2026-09-05", "America/Chicago", new Date("2026-09-08T04:59:59Z")), true);
  assert.equal(isSettlementHoldActive("2026-09-05", "America/Chicago", new Date("2026-09-08T05:00:00Z")), false);
  assert.equal(isSettlementHoldActive("2026-09-05", null, new Date("2026-09-08T05:00:00Z")), false, "defaults to America/Chicago");
});

test("§5.3: refunds follow the fee table exactly", () => {
  const expected: Record<keyof typeof FEE_TREATMENT, number> = {
    left_before_deadline: 1200,
    challenge_cancelled: 1200,
    challenge_under_filled: 1200,
    challenge_voided: 1200,
    no_finishers: 1000,
    did_not_finish: 0,
    injury_withdrawal: 0,
    disqualified_fraud: 0,
    disqualified_technical: 1200,
  };
  for (const [reason, cents] of Object.entries(expected)) {
    assert.equal(refundCentsFor(reason as keyof typeof FEE_TREATMENT, 1000, 200), cents, reason);
  }
  assert.throws(() => refundCentsFor("no_finishers", 10.5, 200));
});

test("§4.3: equal split hands leftover cents out in join (entry id) order and totals the pool", () => {
  const finishers = [{ id: 42 }, { id: 7 }, { id: 19 }];
  const allocation = allocateEqualSplit(1000, finishers);
  assert.deepEqual(allocation.map((row) => [row.entry.id, row.payoutCents]), [[7, 334], [19, 333], [42, 333]]);
  assert.equal(allocation.reduce((sum, row) => sum + row.payoutCents, 0), 1000);
  assert.deepEqual(allocateEqualSplit(500, []), []);
  for (const pool of [1, 2, 99, 100, 101, 12_345]) {
    const rows = allocateEqualSplit(pool, [{ id: 3 }, { id: 1 }, { id: 2 }, { id: 9 }]);
    assert.equal(rows.reduce((sum, row) => sum + row.payoutCents, 0), pool, `pool ${pool}`);
  }
});

const readyAccount: PaidPlayAccountState = {
  eligibilityState: "IL",
  paidPlaySelfExcludedUntil: null,
  paidPlaySelfExcludedPermanently: false,
  biometricConsentAt: new Date("2026-10-06T00:00:00Z"),
  biometricConsentVersion: BIOMETRIC_CONSENT_VERSION,
  eligibilityAcceptedTerms: true,
  eligibilityAcceptedTermsAt: new Date("2026-10-06T00:00:00Z"),
  eligibilityAcceptedTermsVersion: PAID_PLAY_TERMS_VERSION,
};

test("account blocks: restricted state, self-exclusion, stale terms, missing biometric consent", () => {
  const now = new Date("2026-10-07T00:00:00Z");
  assert.deepEqual(paidEntryBlocks(readyAccount, now), []);
  assert.equal(paidEntryBlocks({ ...readyAccount, eligibilityState: "WA" }, now).length, 1);
  assert.equal(paidEntryBlocks({ ...readyAccount, paidPlaySelfExcludedUntil: new Date("2026-10-08T00:00:00Z") }, now).length, 1);
  assert.equal(paidEntryBlocks({ ...readyAccount, paidPlaySelfExcludedUntil: new Date("2026-10-06T00:00:00Z") }, now).length, 0, "an expired exclusion no longer blocks");
  assert.equal(paidEntryBlocks({ ...readyAccount, paidPlaySelfExcludedPermanently: true }, now).length, 1);
  assert.equal(paidEntryBlocks({ ...readyAccount, eligibilityAcceptedTermsVersion: "paid-challenge-v1" }, now).length, 1, "§13.3 re-acceptance");
  assert.equal(paidEntryBlocks({ ...readyAccount, biometricConsentVersion: null, biometricConsentAt: null }, now).length, 1);
  assert.equal(isSelfExcluded({ paidPlaySelfExcludedUntil: null, paidPlaySelfExcludedPermanently: false }, now), false);
  assert.deepEqual(withdrawalBlocks({ eligibilityState: "IL" }), []);
  assert.equal(withdrawalBlocks({ eligibilityState: "AZ" }).length, 1);
});
