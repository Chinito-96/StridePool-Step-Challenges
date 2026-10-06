// Biometric Information Retention and Destruction Policy (Paid Play Terms §9.6).
// Drafted to address the Illinois Biometric Information Privacy Act (740 ILCS 14).
// The notice version must match BIOMETRIC_CONSENT_VERSION in
// lib/db/src/stridepool-paid-play-policy.ts; bumping it requires fresh consent.
// Pending counsel review before publication.
export const BIOMETRIC_NOTICE_VERSION = 'biometric-notice-2026-10-06';
export const BIOMETRIC_POLICY_UPDATED = 'October 6, 2026';
export const BIOMETRIC_POLICY_UPDATED_ISO = '2026-10-06';

export type BiometricPolicySection = { id: string; title: string; paragraphs: string[] };

export const biometricPolicySections: BiometricPolicySection[] = [
  {
    id: 'scope',
    title: 'What this policy covers',
    paragraphs: [
      'Wennekes Enterprises LLC, which operates StridePool, verifies the identity of people who enter Paid Challenges. Some verification methods compare a selfie with the photo on your government ID. That comparison can create a scan of face geometry, which is a "biometric identifier" or "biometric information" under the Illinois Biometric Information Privacy Act and similar laws.',
      'This policy explains what we collect, why, how long we keep it, and how it is destroyed. It applies to every StridePool user, wherever they live.',
    ],
  },
  {
    id: 'collected',
    title: 'What we collect and why',
    paragraphs: [
      'If you choose selfie-based verification, our identity verification provider may create a face-geometry template from your selfie and from the photo on your ID, and compare the two. We use the result only to confirm that you are the person named on the ID, as required for Paid Challenge eligibility, age verification, and payout compliance.',
      'We do not use biometric information for marketing, advertising, profiling, tracking, or any purpose other than verifying your identity.',
    ],
  },
  {
    id: 'consent',
    title: 'Written consent comes first',
    paragraphs: [
      'Before any biometric information is collected, we show you this notice and ask for your written consent in the app. We record the date and the version of the notice you agreed to. If this notice changes, we ask for consent again before any new collection.',
      'You do not have to consent. If you decline, you can ask for a verification method that does not use biometrics by emailing support@stridepool.com.',
    ],
  },
  {
    id: 'no-sale',
    title: 'No sale or profit',
    paragraphs: [
      'We never sell, lease, trade, or otherwise profit from biometric information.',
      'We disclose biometric information only to the identity verification provider that performs the check on our behalf under a written contract, or where required by law or a valid subpoena or warrant.',
    ],
  },
  {
    id: 'retention',
    title: 'Retention schedule and destruction',
    paragraphs: [
      'Biometric information is permanently destroyed within 30 days after the verification it was collected for is complete, whether the verification succeeded or failed.',
      'In no event is biometric information kept longer than 3 years after your last interaction with StridePool, or longer than any applicable law allows, whichever is sooner.',
      'Destruction means deletion from the verification provider\'s systems and from any StridePool system, using methods that make the data unrecoverable. We keep a record that destruction occurred, but not the biometric information itself.',
    ],
  },
  {
    id: 'security',
    title: 'How it is protected',
    paragraphs: [
      'We and our verification provider store, transmit, and protect biometric information using the reasonable standard of care in our industry, and in a manner at least as protective as the way we handle other confidential and sensitive information, including encryption in transit and at rest and restricted access.',
    ],
  },
  {
    id: 'contact',
    title: 'Questions',
    paragraphs: [
      'Contact support@stridepool.com or write to Wennekes Enterprises LLC, 4701 W 900 N, Michigan City, IN 46360.',
    ],
  },
];
