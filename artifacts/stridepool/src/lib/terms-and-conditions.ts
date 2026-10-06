// Original StridePool draft. References informed topic coverage, not copied clauses:
// https://legal.playsteppa.com/terms
// https://bonterms.com/standard/online-cloud-terms/
// This draft is NOT the accepted paid-challenge terms version in the API.
export const TERMS_DRAFT_UPDATED = "October 5, 2026";
export const TERMS_DRAFT_UPDATED_ISO = "2026-10-05";

export type TermsSection = {
  id: string;
  title: string;
  paragraphs: string[];
};

export const termsReviewItems = [
  "Identify the legal operator, business address, and support/legal contact.",
  "Approve the paid-challenge model, permitted jurisdictions, minimum ages, and verification requirements.",
  "Finalize the privacy policy, health-data disclosures, retention, and account-deletion process.",
  "Approve the refund, cancellation, subscription, tax-reporting, and unclaimed-balance policies.",
  "Select governing law and an appropriate dispute process; review liability provisions and app-store obligations.",
];

export const termsSections: TermsSection[] = [
  {
    id: "document-status",
    title: "Document status and scope",
    paragraphs: [
      "These proposed Terms & Conditions describe the intended agreement for StridePool's website, companion app, account services, and walking challenges. They are a draft for review, have no effective date, and are not being presented as an adopted or enforceable agreement.",
      "Viewing this draft is not acceptance. The app's existing eligibility consent does not adopt this draft, and this page does not enable paid play or establish legal approval. Before adoption, the operator must finalize the items identified in the review checklist and present the approved agreement through an appropriate acceptance process.",
      "References to 'StridePool,' 'we,' and 'our' describe the service. They do not identify a legal company. The operator's legal identity and contact details must be supplied before these terms take effect.",
    ],
  },
  {
    id: "definitions",
    title: "Key terms",
    paragraphs: [
      "A challenge is a dated walking activity with a stated format and scoring criteria. A participant is the account holder enrolled in that challenge. A creator is an eligible user who sets the challenge's displayed details.",
      "An entry contribution is the amount allocated to the challenge pool. A platform fee is a separate charge for participation. The prize pool is the amount recorded for distribution under the applicable challenge format.",
      "Available wallet balance means funds recorded as available for withdrawal, subject to provider and account requirements. Pending funds are not available to withdraw. Verified steps are accepted health-source records, excluding duplicates and records rejected or held for review.",
    ],
  },
  {
    id: "eligibility",
    title: "Eligibility and location",
    paragraphs: [
      "Paid participation requires age 18 or above, or a higher age if applicable law requires it. Only jurisdictions approved for StridePool's actual challenge model may be enabled. The intended launch footprint is not an approved-state list.",
      "The current paid-entry controls also require provider-backed identity verification and acceptance of the paid-challenge terms and refund policy. These requirements have not been replaced by an age-only declaration. Required verification for withdrawals is a separate obligation.",
      "Provide accurate age, location, and identity information. Do not use another person's account or false information to evade restrictions. A stated location is not a guarantee that the service has independently verified your physical location.",
      "Paid play remains locked until counsel approval, approved jurisdictions, provider readiness, and reconciliation controls are complete. These terms do not represent that entry-fee challenges are permitted everywhere or legally exempt from gambling regulation.",
    ],
  },
  {
    id: "accounts",
    title: "Accounts and account security",
    paragraphs: [
      "Use your account for your own participation. Keep access credentials secure, maintain accurate profile information, and promptly report suspected unauthorized activity through the support channel once it is published.",
      "Account sharing, impersonation, duplicate accounts used to gain an advantage, and attempts to bypass membership or participation limits are prohibited under the proposed agreement. Do not access private records or internal support tools without authorization.",
      "Anonymous participation in existing free community challenges does not establish eligibility for paid entries, account-bound invitations, or withdrawals. Free challenge creation is no longer offered.",
    ],
  },
  {
    id: "challenge-entry",
    title: "Challenge entry and financial risk",
    paragraphs: [
      "Before entering, review the challenge's dates, format, daily target where applicable, participant information, contribution, platform fee, and total charge. Participation in one challenge does not entitle you to entry or payment from another.",
      "Payment-provider confirmation, not opening or returning from checkout, activates a paid entry. The current join window closes when the challenge starts. Backend challenge-date boundaries are evaluated in UTC rather than each participant's local midnight.",
      "An entry does not guarantee a prize or a positive return. Depending on the challenge outcome and applicable refund policy, you may lose the contribution and fees you paid. Do not commit money needed for essential expenses or activity that is unsafe for your health.",
      "The service measures participation against performance criteria. That description is not a legal finding that the challenge is a permitted skill contest in a particular state.",
    ],
  },
  {
    id: "fees-membership",
    title: "Fees, membership, and referrals",
    paragraphs: [
      "The creator-set contribution goes into the challenge pool. The platform fee is separate and depends on the membership shown in your account. Review the amounts disclosed before payment; Pro does not remove the contribution or guarantee winnings.",
      "Current account limits allow one active challenge on Free and up to five on Pro. Paid challenge creation requires Pro, with one active creator challenge at a time. The app displays the applicable limits and provider-confirmed membership status.",
      "Where a recurring Pro subscription is offered, checkout must disclose the amount and renewal interval. The current self-service cancellation flow ends the subscription at the end of the paid period. Returning from a billing page is not proof that cancellation or an entitlement change has completed.",
      "Referral benefits currently provide Pro trial access when the qualifying signup and challenge join complete. They are not cash, a transferable balance, or a promise of free paid entry. Already-earned referral access is handled separately from paid subscription status.",
    ],
  },
  {
    id: "scoring",
    title: "Scoring and settlement",
    paragraphs: [
      "Daily-goal challenges require the assigned target on every challenge day to qualify as a finisher. Elimination challenges remove a participant from the running after a missed completed day. No automatic grace-day allowance applies.",
      "Ranking challenges use total verified steps within the challenge dates and do not apply daily-goal elimination. Their current podium shares are 60%, 25%, and 15%. Ties divide the combined shares for the occupied positions; short fields redistribute the pool among the available places.",
      "Qualifying daily-goal finishers split the pool equally. Whole-cent remainders are allocated deterministically rather than retained as an undisclosed platform fee. Current daily-goal settlement returns entry contributions when there are no finishers; this does not automatically refund separate fees.",
      "Projected payouts are estimates until settlement. Source review, support decisions, provider incidents, and reconciliation can delay results. No guaranteed settlement deadline or payout arrival time is proposed.",
    ],
  },
  {
    id: "health-data",
    title: "Health-source records and device responsibilities",
    paragraphs: [
      "Challenge scoring uses accepted records from Apple Health or Health Connect through the installed StridePool companion. Browsers cannot request native health permissions. Wearable activity must reach a supported source before it can be considered.",
      "Manually entered steps, imported CSV totals, fabricated activity, and duplicate samples do not receive verified challenge credit. Suspicious samples can be held for review; held samples do not contribute to verified totals until accepted.",
      "Keep required permissions enabled, check sync status, and allow your device to upload records. Device power, network availability, health-source behavior, and operating-system scheduling can affect delivery. Background uploads are not guaranteed after force-quit or force-stop.",
      "Alternative screenshots or estimates alone do not establish verified step totals. Retain original source evidence if a day is disputed. Technical problems do not automatically create a refund, but this draft does not waive legal rights or prevent review of a verified service error.",
    ],
  },
  {
    id: "wallet-payouts",
    title: "Wallet records, bank withdrawals, and taxes",
    paragraphs: [
      "The wallet separates available balance from pending funds and records confirmed financial events. A pending amount is not withdrawable. The current minimum available balance for a withdrawal is $20.",
      "Bank withdrawals use Stripe and require a linked, payout-enabled account. Complete the identity, banking, or tax requirements the provider requests. An age confirmation does not replace required provider verification.",
      "Provider processing, bank restrictions, disputed payments, and compliance reviews can delay or prevent a payout. A failed or reversed payout is handled according to its confirmed provider status and corresponding ledger records, not merely a success screen.",
      "Winnings may be taxable, and reporting or withholding may be required under applicable law. The final agreement must specify the operator's reporting process. This draft sets no assumed reporting threshold and provides no tax advice.",
      "Wallet records do not promise interest, investment returns, or deposit insurance. Treatment of dormant or unclaimed balances must be finalized under applicable law before adoption; inactivity does not itself authorize confiscation.",
    ],
  },
  {
    id: "refunds",
    title: "Leaving, cancellation, and refunds",
    paragraphs: [
      "The current self-service leave flow is available before a challenge starts. It returns a paid entry's challenge contribution to the available wallet balance and removes that contribution from the pool. It does not automatically reverse the original card charge or refund the separate platform fee.",
      "After the start, self-service leaving is closed. Missing a target does not automatically entitle a participant to a refund. Medical circumstances, scoring errors, and service incidents require review against the applicable approved policy.",
      "Challenge cancellation, fee refunds, and exceptional remedies must be finalized before this draft is adopted. No automatic cancellation refund, card-refund method, or processing time should be inferred from this page.",
      "Confirmed refunds and reversals must appear in the provider and wallet records. Nothing in the proposed agreement removes non-waivable refund, payment-dispute, or consumer-protection rights.",
    ],
  },
  {
    id: "fair-play",
    title: "Fair play, reviews, and community conduct",
    paragraphs: [
      "Do not fabricate steps, manipulate source records, share an account to generate activity, coordinate fraudulent outcomes, exploit payment or scoring errors, or evade jurisdiction controls. Do not use the service to move funds between coordinated accounts or obscure the source of money.",
      "Harassment, threats, discrimination, spam, impersonation, and disclosure of another person's private information are prohibited under the proposed agreement. Challenge participation is not permission to copy or publish another user's health records.",
      "A review may require source records or other relevant evidence and may hold affected steps or funds while facts are assessed. Review decisions should identify the affected records and outcome. This draft does not impose a blanket 24-hour evidence deadline or automatic forfeiture of unrelated balances.",
      "Sanctions and financial corrections must be proportionate, evidence-based, consistent with the approved agreement, and lawful. A legitimate chargeback or complaint is not itself permission to confiscate all funds or eliminate statutory rights.",
    ],
  },
  {
    id: "privacy-content",
    title: "Privacy, user content, and service rights",
    paragraphs: [
      "A separate privacy policy must explain the information collected, purposes of use, providers receiving it, retention, sharing controls, deletion requests, and applicable rights. This draft is not a substitute for that policy and does not create blanket consent to health-data sharing or marketing.",
      "You retain rights in content you submit and must have permission to submit it. The proposed operational permission is limited to storing, displaying, and processing that content as needed to provide the service, review activity, and protect accounts. It does not authorize unrelated advertising use of identifiable health records.",
      "StridePool's software, interface, and branding remain subject to their owners' intellectual-property rights. Use of the service does not transfer ownership or permit copying protected content, unauthorized resale, or disruption of other users' access.",
      "The copyright-notice contact, any required designated agent, and the procedure for privacy requests must be supplied before the final policy is adopted.",
    ],
  },
  {
    id: "health-safety",
    title: "Physical safety and professional advice",
    paragraphs: [
      "StridePool is not a medical service. Challenge targets, activity summaries, and incentives are not diagnosis, treatment, or personalized exercise advice. Consult a qualified professional when needed, particularly if you have an injury or health concern.",
      "Do not walk through pain, dizziness, dangerous conditions, or medical restrictions to protect a contribution or qualify for a prize. Stop unsafe activity. Financial participation does not oblige you to ignore your health.",
      "Step totals depend on device and source records and may differ from other trackers. The service does not guarantee a particular health benefit, fitness improvement, financial outcome, or measurement accuracy.",
    ],
  },
  {
    id: "third-parties",
    title: "Third-party services and app stores",
    paragraphs: [
      "Stripe provides payment and payout services; Apple Health and Health Connect provide health-source access. Relevant provider terms may apply to your use of those services. Their availability and requirements can change independently of StridePool.",
      "Apple and Google do not sponsor StridePool challenges, administer their results, or provide challenge prizes. Downloading a companion app does not make an app store responsible for StridePool's operations.",
      "Distribution-specific license terms, support duties, required app-store acknowledgments, and beneficiary provisions must be reviewed for the actual release channel before adoption. This draft does not claim that a native app has been approved for distribution.",
    ],
  },
  {
    id: "availability-termination",
    title: "Availability, restrictions, and ending access",
    paragraphs: [
      "Maintenance, network failures, provider outages, and security incidents may interrupt the service. There is no promise of uninterrupted access, guaranteed background delivery, or immediate settlement. Material incidents should be assessed before affected results or financial records are finalized.",
      "Access may need to be restricted to protect accounts, comply with law, or investigate suspected misuse. Suspension or closure does not automatically erase a legitimate balance, a refund obligation, an existing dispute, or a non-waivable right.",
      "An account-closure and deletion process, lawful record-retention schedule, and treatment of outstanding entries and balances must be established before the final agreement is adopted. Deleting an app is not a request to cancel a subscription or a challenge entry.",
    ],
  },
  {
    id: "disputes-liability",
    title: "Complaints, liability, and governing law",
    paragraphs: [
      "For a scoring or billing concern, keep the challenge ID, affected dates, transaction references, and source evidence. A published support/legal contact and a clear complaint process are required before this draft is adopted.",
      "This draft does not impose a short dispute cutoff, mandatory arbitration, a class-action waiver, a jury-trial waiver, a damages cap, or broad indemnification. Those provisions must not be copied from another operator's agreement without an informed decision and qualified review.",
      "No governing state, court venue, or exclusive forum has been selected. Applicable mandatory law and non-waivable consumer rights remain unaffected. No provision should be read as releasing fraud, unlawful conduct, or other liability that cannot legally be excluded.",
    ],
  },
  {
    id: "changes-adoption",
    title: "Changes and final adoption",
    paragraphs: [
      "Revisions to this draft should be dated and reviewed before adoption. Final material changes should receive appropriate notice and any legally required acceptance. Publishing text alone is not proof that a participant accepted it.",
      "Challenge-specific amounts and rules must be disclosed before entry. Versioned acceptance and preservation of the terms applicable to each entry require separate implementation and review; this draft does not claim that immutable entry snapshots are already in place.",
      "Before launch, finalize the operator and contact details, privacy disclosures, jurisdiction policy, financial terms, and dispute process; then connect the approved agreement to the acceptance flow. Until then, existing launch and eligibility restrictions remain unchanged.",
    ],
  },
];
