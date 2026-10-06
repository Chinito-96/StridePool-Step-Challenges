import assert from "node:assert/strict";
import { test } from "node:test";
import { getSafeReturnTo, getTrustedCorsOrigins, isTrustedCorsOrigin } from "./request-security";
import { hasCurrentPaidTermsAcceptance, PAID_CHALLENGE_TERMS_VERSION } from "../services/eligibility-consent";

test("auth redirects preserve internal paths, queries, and fragments", () => {
  for (const path of ["/", "/profile", "/mobile/?tab=health#delivery", "/challenges?next=https%3A%2F%2Fexample.test"]) {
    assert.equal(getSafeReturnTo(path), path);
  }
});

test("auth redirects reject external, backslash, encoded, and control-character destinations", () => {
  for (const value of [undefined, ["//evil.test"], "https://evil.test", "//evil.test", "/\\evil.test", "/%5cevil.test", "/%255cevil.test", "/%2fevil.test", "/\tevil.test", "/%0devil.test", "/foo/..//evil.test", "/%bad"]) {
    assert.equal(getSafeReturnTo(value), "/", String(value));
  }
});

test("CORS permits only exact trusted origins and non-browser requests", () => {
  const trusted = getTrustedCorsOrigins({
    NODE_ENV: "development",
    REPLIT_DOMAINS: "public.example.test,second.example.test",
    REPLIT_DEV_DOMAIN: "preview.example.test",
    REPLIT_EXPO_DEV_DOMAIN: "expo.example.test",
    STRIDEPOOL_ALLOWED_ORIGINS: "https://custom.example.test,https://bad.test/path,http://insecure.test",
  });
  for (const origin of ["https://public.example.test", "https://second.example.test", "https://preview.example.test", "https://expo.example.test", "https://custom.example.test", undefined]) {
    assert.equal(isTrustedCorsOrigin(origin, trusted), true);
  }
  for (const origin of ["https://evil.test", "https://public.example.test.evil.test", "http://public.example.test", "null", "https://bad.test", "http://insecure.test"]) {
    assert.equal(isTrustedCorsOrigin(origin, trusted), false);
  }
  const production = getTrustedCorsOrigins({ NODE_ENV: "production", REPLIT_DEV_DOMAIN: "preview.example.test" });
  assert.equal(isTrustedCorsOrigin("https://preview.example.test", production), false);
});

test("paid terms require a server-recorded timestamp and the current version", () => {
  const recordedAt = new Date("2026-10-05T12:00:00.000Z");
  assert.equal(hasCurrentPaidTermsAcceptance({
    eligibilityAcceptedTerms: true,
    eligibilityAcceptedTermsAt: recordedAt,
    eligibilityAcceptedTermsVersion: PAID_CHALLENGE_TERMS_VERSION,
  }), true);
  assert.equal(hasCurrentPaidTermsAcceptance({
    eligibilityAcceptedTerms: true,
    eligibilityAcceptedTermsAt: null,
    eligibilityAcceptedTermsVersion: PAID_CHALLENGE_TERMS_VERSION,
  }), false);
  assert.equal(hasCurrentPaidTermsAcceptance({
    eligibilityAcceptedTerms: true,
    eligibilityAcceptedTermsAt: recordedAt,
    eligibilityAcceptedTermsVersion: "outdated",
  }), false);
  assert.equal(hasCurrentPaidTermsAcceptance({
    eligibilityAcceptedTerms: false,
    eligibilityAcceptedTermsAt: recordedAt,
    eligibilityAcceptedTermsVersion: PAID_CHALLENGE_TERMS_VERSION,
  }), false);
});