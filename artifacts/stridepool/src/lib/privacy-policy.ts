// Original StridePool privacy-policy draft, based on data flows verified in the
// application. The requested reference could not be retrieved (HTTP 402).
// Confirm the review checklist and obtain legal approval before adopting.
export const PRIVACY_DRAFT_UPDATED = "October 5, 2026";
export const PRIVACY_DRAFT_UPDATED_ISO = "2026-10-05";

export type PrivacySection = {
  id: string;
  title: string;
  paragraphs: string[];
};

export const privacyReviewItems = [
  "Confirm the operator's legal name, address, privacy contact, and controller/processor roles.",
  "Confirm infrastructure and identity-provider configurations, subprocessors, hosting regions, access, and cross-border transfers.",
  "Set actual retention schedules for raw health-source payloads, challenge results, billing, support, security, and backup records.",
  "Document the legal bases, consent flow, withdrawal effect, and applicable state, federal, and international privacy rights.",
  "Provide working access, correction, export, deletion, and privacy-request routes before publishing an operative notice.",
  "Review the treatment of children's data, sensitive health data, public progress, notifications, and app-store disclosures with counsel.",
];

export const privacySections: PrivacySection[] = [
  {
    id: "privacy-status",
    title: "Status of this notice",
    paragraphs: [
      "This proposed StridePool Privacy Policy is a draft for review. It has no effective date and is not an operative privacy notice or a new consent request. Reading it does not opt you in to any additional collection or change your existing settings.",
      "Before adoption, StridePool must identify the legal operator, verify every provider and storage location, establish retention and privacy-request procedures, and obtain qualified legal review. Where this draft describes an intended practice that has not been verified, the issue is called out rather than presented as a completed safeguard.",
      "This notice is separate from the proposed Terms & Conditions and current operating Rules. Neither proposed document becomes binding merely because it is available in the app.",
    ],
  },
  {
    id: "operator",
    title: "Who is responsible for your information",
    paragraphs: [
      "StridePool is the name of the service, not a verified legal-entity name. The operator's legal name, address, privacy contact, and role under applicable privacy laws must be confirmed before this notice is adopted.",
      "Do not send sensitive identity documents, health records, or account credentials to an unpublished contact address. A functioning privacy-request contact and response process must be established before this notice is used.",
    ],
  },
  {
    id: "information",
    title: "Information the service handles",
    paragraphs: [
      "Account details may include your account identifier, email address, name, display name, profile image, account role, account creation and update times, and sign-in session data. Authentication may provide some profile details to StridePool.",
      "Profile and preference data may include your step-goal baseline, reminder and digest settings, public-progress setting, health-source connection status, eligibility age and state, paid-term acceptance timestamp and version, and identity-verification status. A verification status is not the same as a stored identity document.",
      "If you use challenges, community groups, invitations, or referrals, the service handles related challenge and group details, participant membership, join and leave times, invitations, referral relationships, completion status, and challenge results.",
      "Health-source records can include the source platform, source sample identifier, calendar day, step count, sample start and end times, recording time when available, review status and flags, and health-source payload metadata received with the sample. Daily challenge totals, verification decisions, source-sync attempts, and connection status may also be recorded. These are sensitive activity and health-related data.",
      "Wallet and transaction records may include balances, amounts, transaction types, challenge entry, settlement and refund status, payout status, and payment-provider references. Stripe account, customer, or subscription identifiers may be associated with an account. StridePool's app database schema does not store raw card numbers; Stripe-hosted payment forms and banking flows may collect payment details directly.",
      "Required sign-in uses a server-side session store and an authentication cookie. The browser also holds limited app state in local storage, including pending health-delivery retry metadata and referral information. A broader browser/device telemetry or advertising profile is not described as an implemented feature in this draft.",
    ],
  },
  {
    id: "sources",
    title: "Where information comes from",
    paragraphs: [
      "You or your account provider provide account and profile details, preferences, eligibility declarations, and information you submit to the service.",
      "When you connect and sync a health source, the StridePool companion reads step samples with your device permission and sends samples for challenge scoring, duplicate handling, and review. Apple Health or Health Connect is the source integration; a general website browser cannot request native health permissions.",
      "The service also creates account, membership, challenge, wallet, support, security, and system records as you use its features. Payment-provider events and account status may be used to keep a transaction or payout's recorded status consistent.",
      "The final notice must identify any additional data provided by hosting, authentication, fraud prevention, messaging, or payment vendors, including whether those vendors collect information directly from your device.",
    ],
  },
  {
    id: "purposes",
    title: "How information is used",
    paragraphs: [
      "StridePool uses account and profile data to sign you in, provide the features you request, display your profile, remember preferences, and respond to account issues.",
      "Health-source records and challenge membership are used to synchronize step activity, remove duplicate records, verify challenge progress, calculate results, resolve disputes, identify suspicious submissions, and support fair settlement.",
      "Wallet, membership, payment, and payout records are used to process a checkout, reflect confirmed provider events, calculate amounts, reconcile financial records, facilitate payouts, prevent unauthorized or fraudulent use, and respond to billing disputes.",
      "Contact and notification preferences may be used to show account, invitation, challenge, security, and service messages. An enabled reminder or digest setting does not by itself establish consent for unrelated marketing.",
      "Information may be used to secure and maintain the service, diagnose errors, meet applicable legal obligations, and protect participants, the service, or others. The operator must document the applicable legal basis and any required consent for each use before this policy takes effect.",
    ],
  },
  {
    id: "health",
    title: "Health and step information",
    paragraphs: [
      "Step samples and derived challenge totals can reveal physical activity and are treated as sensitive information in this draft. Access is requested through the companion app and the device's Apple Health or Health Connect permission. You can change those permissions in device settings.",
      "The app uses accepted step records to deliver and verify walking challenges, review disputed or suspicious samples, and calculate outcomes. A permission change stops future reads after the source or operating system applies the change; it does not automatically remove samples already sent to StridePool.",
      "The service's step-sample record may retain a source payload alongside sample timing and review data. The operator must inspect actual stored payloads, restrict them to necessary fields, document any use, and set a deletion period before adopting this policy.",
      "StridePool must confirm whether each applicable privacy law requires express consent, access, deletion, or other special handling for health information. This draft is not a substitute for an in-app permission notice or required consent.",
      "Do not use challenge scores or step totals for medical diagnosis or treatment. Data shown by the service may differ from the health source or another tracker.",
    ],
  },
  {
    id: "sharing",
    title: "When information is shared",
    paragraphs: [
      "StridePool's database records are associated with individual accounts for operation of the service. The intended design is to share only the information needed for the feature you use; account security must prevent one participant from opening another participant's private account or health records.",
      "Other participants may see challenge details, participant displays, standings, or activity that the challenge feature presents to them. A public-progress preference also exists. Before this notice is adopted, the operator must verify exactly which name, avatar, step totals, placement, or progress is visible to other participants or the public, and accurately describe each visibility choice.",
      "Stripe may receive information necessary for checkout, identity verification, linked payout accounts, subscriptions, payment processing, and provider reconciliation. What Stripe collects directly and the choices it offers are governed in part by Stripe's own privacy notice and settings.",
      "Apple Health or Health Connect handles the device-side permission and health-source access. The infrastructure, authentication, email or push-message, and other vendors that receive service information must be listed with their actual role, purpose, and processing region in the final notice.",
      "Information may also be disclosed where the operator reasonably believes disclosure is required by law, necessary to address an urgent security or safety issue, or necessary to protect legal rights. The scope and legal basis of such a disclosure depend on the applicable facts and law.",
      "This draft does not assert that StridePool sells personal information, uses health data for targeted advertising, shares health data for unrelated marketing, or sends health records to AI training providers. The operator must confirm these practices before making categorical promises in an adopted notice.",
    ],
  },
  {
    id: "public",
    title: "Community features and visibility",
    paragraphs: [
      "Names, profile images, group membership, invitations, or challenge progress may be visible to participants where community or challenge features require it. What is visible can depend on your settings and the specific feature.",
      "A public-progress setting exists in the account profile. The actual effect of this setting and the fields shown in public or lifetime leaderboards must be described precisely before the policy is adopted. Turning a setting off must not be described as removing records required for an already-settled transaction.",
      "Do not submit someone else's personal information or share another participant's sensitive activity outside the service without an appropriate legal basis and permission.",
    ],
  },
  {
    id: "cookies",
    title: "Sessions, local storage, and device settings",
    paragraphs: [
      "Signing in requires a session mechanism. The database includes expiring server-side sessions, and the browser uses an authentication session cookie. Removing the cookie or signing out may end the current browser session but does not delete the associated account or its server records.",
      "The app writes limited operational information to browser local storage, including referral-code handling and account-scoped health-delivery retry metadata. Clearing browser storage may remove pending local retry information or require you to rejoin a referral flow; it does not delete server-side records.",
      "Health-source permission can be reviewed in Apple or Android settings. Turn off notifications in the available app or device setting where offered. The final notice must list any production analytics, optional cookies, advertising trackers, or push tokens after confirming whether they are enabled.",
    ],
  },
  {
    id: "retention",
    title: "How long information is kept",
    paragraphs: [
      "The service stores account, challenge, step, review, wallet, membership, and payout-related records in its database. This draft does not claim a defined retention period, automatic erasure schedule, or backup-purge deadline; those schedules have not been confirmed.",
      "The operator must set retention limits by data category. Health samples should not be retained longer or in more detail than needed for the disclosed challenge, review, security, and legal purposes. Financial records may have separate legally required retention needs.",
      "Until those schedules and backup processes have been documented, this proposed policy cannot promise that a particular record will be erased after an exact number of days. The user-facing retention disclosures and internal cleanup process must agree before adoption.",
    ],
  },
  {
    id: "security",
    title: "Security and access controls",
    paragraphs: [
      "StridePool uses authenticated accounts and server-side authorization for account-specific features; administrative information is restricted to authorized support roles. Health-source records and financial records warrant particularly careful access controls.",
      "No website, mobile device, network, or storage system can be guaranteed completely secure. Avoid sending credentials or full health histories through ordinary support messages. Report suspected unauthorized access through the verified support route once one has been established.",
      "The operator must verify hosting configuration, encryption, secret handling, staff access, audit records, backup security, incident response, and vendor safeguards before this section is approved. This draft does not assert technical controls that have not been independently confirmed.",
    ],
  },
  {
    id: "rights",
    title: "Privacy choices and requests",
    paragraphs: [
      "You can manage some account preferences and turn off a connected health-source permission in device settings. Those actions affect future collection or display in the described feature; they may not erase records already used to operate a challenge or settle a transaction.",
      "Depending on where you live, privacy law may give you a right to request access, correction, deletion, a copy, restriction, objection, or withdrawal of consent, and to appeal a denial. The exact rights, identity-check steps, and response deadlines depend on applicable law.",
      "A working privacy-request route has not been confirmed in the product. Before adoption, StridePool must publish a real contact or in-app request flow, explain how to verify a request safely, set appeal and response procedures, and ensure approved requests reach backups and vendors where required.",
      "If a health permission is withdrawn or an account is closed, the service may still need limited records to meet legal, safety, dispute, fraud-prevention, or payment obligations. Those exceptions and their retention periods must be supported by the final policy and applicable law.",
    ],
  },
  {
    id: "children",
    title: "Children and age requirements",
    paragraphs: [
      "Paid participation currently requires age 18 or higher, along with other paid-entry checks. That is not a representation that StridePool has adopted a complete minimum-age policy for every free, community, or anonymous feature.",
      "The operator must define and review age rules for all audiences and features and establish a safe process to handle personal information collected from a child where applicable law requires one.",
    ],
  },
  {
    id: "transfers",
    title: "Service providers and data locations",
    paragraphs: [
      "StridePool currently uses Stripe-related financial features, device health sources, server-side authentication and session storage, and hosted database infrastructure. The precise legal names, subcontractors, services, storage regions, remote access, and international transfers must be checked against the production configuration before adoption.",
      "Payment providers, device platform operators, hosting providers, and authentication providers may act as independent controllers for some information under their own terms and privacy notices. Review the provider's own privacy notice for processing it controls directly.",
      "A current, accurate subprocessor list and cross-border transfer mechanism have not been confirmed here. Do not infer that data stays in a particular country or that every provider processes it only on StridePool's instructions.",
    ],
  },
  {
    id: "changes",
    title: "Changes to this notice",
    paragraphs: [
      "A future operative notice should display its effective date, version, and meaningful summary of material changes. Where privacy law requires notice, consent, or another user action, the operator must provide it before applying the relevant change.",
      "This draft date reflects when this proposed document was last revised. It is not an effective date, and making this page available does not change an account's terms acceptance, privacy consent, or settings.",
    ],
  },
  {
    id: "contact",
    title: "Privacy questions and complaints",
    paragraphs: [
      "The legal operator's name, privacy contact, address, regulator information where applicable, and complaint process have not been verified. They must be supplied before this policy can serve as an operative notice.",
      "If you have a concern about health information, an account, or an unauthorized disclosure, use only a support or privacy contact officially published by StridePool. Do not send identity documents or access credentials to an address copied from another service.",
    ],
  },
];
