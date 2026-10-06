export const RULES_UPDATED = "October 5, 2026";
export const RULES_UPDATED_ISO = "2026-10-05";

export type RuleSection = {
  id: string;
  title: string;
  summary: string;
  paragraphs: string[];
};

// Operational guidance, not a substitute for counsel-approved paid-play terms.
export const challengeRules: RuleSection[] = [
  {
    id: "about",
    title: "The challenge and the people behind it",
    summary: "StridePool connects verified walking progress with shared accountability.",
    paragraphs: [
      "StridePool provides the challenge experience, step review, results, and wallet records. Challenge creators choose the format, dates, daily target where applicable, and entry amount shown on the challenge.",
      "Apple and Google are not sponsors of StridePool challenges and do not administer them or provide their prizes. Apple Health and Health Connect are health-data platforms, not challenge operators.",
      "Results depend on the challenge's performance criteria. This guide does not establish that paid challenges are legally permitted in any particular jurisdiction.",
    ],
  },
  {
    id: "eligibility",
    title: "Check your eligibility before entering",
    summary: "Paid participation requires more than an available challenge card.",
    paragraphs: [
      "Paid participants must be at least 18 and meet the eligibility requirements shown in Safety. Paid play remains unavailable until legal review, approved-state configuration, and payment-provider launch controls are complete.",
      "The current paid-entry checks also require provider-backed identity verification and acceptance of the paid-challenge terms and refund policy. Age confirmation alone does not currently unlock paid participation.",
      "Use your own account and accurate eligibility information. Do not use another account or misrepresent your location to bypass participation restrictions. Intended launch coverage is not the same as an approved-state list.",
    ],
  },
  {
    id: "entry",
    title: "Know what you are joining",
    summary: "Review the format, dates, goal, and complete entry amount first.",
    paragraphs: [
      "Read the challenge details before confirming an entry. Paid entry is activated after the payment provider confirms a successful payment; opening checkout or returning from it is not proof of enrollment.",
      "The current entry window closes when the challenge starts. Every challenge day runs midnight to midnight in the challenge time zone shown on the challenge (America/Chicago unless stated), no matter where you are or whether you travel.",
      "Free challenges cannot be created. Existing free community challenges may remain available, subject to their access rules, but joining one does not establish paid-play eligibility.",
    ],
  },
  {
    id: "costs",
    title: "Entry amounts and the shared pool",
    summary: "The challenge contribution and platform fee are separate.",
    paragraphs: [
      "The creator-set entry amount funds the challenge pool. A separate platform fee applies according to your membership. Review both amounts and the total shown before confirming payment.",
      "Membership does not remove a challenge's entry contribution or guarantee a prize. Creating a paid challenge requires Pro and is subject to the active-challenge and creation limits shown in your account.",
      "Money is recorded in USD cents. Estimated shares are previews, not settled earnings, and may change as the eligible participant count changes.",
    ],
  },
  {
    id: "formats",
    title: "Different formats, different finish lines",
    summary: "Daily-goal challenges and total-step rankings are scored differently.",
    paragraphs: [
      "In a daily-goal challenge, meet the assigned target on every challenge day to qualify as a finisher. There is no automatic grace-day allowance. In an elimination challenge, a missed completed day removes you from the running.",
      "In a ranking challenge, placement is based on total verified steps within the challenge dates. There is no daily target or missed-day elimination for this format.",
      "Health comes first. Do not continue unsafe activity to protect an entry. An injury or disputed record can be reviewed through support, but a review request does not automatically restore qualification or create a refund.",
    ],
  },
  {
    id: "steps",
    title: "Which steps count",
    summary: "Challenge credit depends on accepted health-source records.",
    paragraphs: [
      "Connect Apple Health on iPhone or Health Connect on Android through the installed StridePool companion. A browser cannot request native health permissions. Wearable activity must reach a supported health source before it can be considered.",
      "Manually entered steps, imported CSV totals, and fabricated activity are not accepted as verified challenge steps. Duplicate source samples must not count twice. Suspicious samples can be held for review and do not contribute to verified totals while held.",
      "Steps for a day count if they sync within 24 hours after that day ends. Until then a short day shows At Risk, not Eliminated. Settlement waits another 24 hours for review. Keep health access enabled and check your sync status regularly. Background delivery depends on the device and operating system; it is not guaranteed after force-quitting or force-stopping the app. Reopening may recover undelivered records, but a sync indicator is not itself proof that a day qualified.",
    ],
  },
  {
    id: "results",
    title: "How the pool is distributed",
    summary: "Final results use the applicable format and verified records.",
    paragraphs: [
      "For daily-goal challenges, qualifying finishers share the pool equally. Leftover cents go one cent each to finishers in the order they joined, so the distributed amounts always equal the pool.",
      "Ranking challenges allocate 60% to first place, 25% to second, and 15% to third. Tied participants share the combined amounts for the positions they occupy. If fewer than three participants qualify for ranking, the pool is redistributed among the available places.",
      "Under the current settlement logic, a daily-goal challenge with no finishers returns entry contributions to participants rather than awarding the pool to StridePool. Platform fees are separate; this does not promise that every fee is refunded.",
      "Settlement happens after the challenge ends and required checks complete. Held records, support reviews, or payment reconciliation can delay final results. No fixed settlement or cash-out time is promised.",
    ],
  },
  {
    id: "withdrawals",
    title: "From earnings to your bank",
    summary: "Available balance and pending funds are not interchangeable.",
    paragraphs: [
      "Settled earnings appear in your StridePool wallet. Pending challenge funds are not available for withdrawal. The current minimum available balance for a withdrawal is $20.",
      "Bank withdrawals use Stripe and require a linked account with payouts enabled. Stripe may require identity, banking, or tax information before allowing a payout. An age declaration cannot replace required payout verification.",
      "Provider failures or reviews can leave a withdrawal pending until its final status is reconciled. Winnings may have tax consequences; obtain advice appropriate to your circumstances.",
    ],
  },
  {
    id: "leaving",
    title: "Leaving, refunds, and corrections",
    summary: "A wallet credit is not the same as a refund to your card.",
    paragraphs: [
      "The current self-service leave flow is available only before the challenge starts. For paid entries, it credits the challenge contribution back to your available wallet balance and removes it from the pool. It does not automatically refund the original card charge or the separate platform fee.",
      "After the start, the self-service leave action is closed. Missing a target is not an automatic refund event. Exceptional cases and scoring corrections require review; do not assume a refund has been approved until a decision and the corresponding money record are shown.",
      "Cancellation and provider refund outcomes depend on the applicable terms and confirmed provider records. This guide does not promise an automatic cancellation refund or a specific processing time.",
    ],
  },
  {
    id: "fair-play",
    title: "Fair play and respectful participation",
    summary: "Real activity and honest records protect every participant.",
    paragraphs: [
      "Do not falsify activity, manipulate health-source records, generate artificial steps, impersonate another person, or use multiple accounts to evade rules. Do not harass participants, spam invitations, or share another person's private information.",
      "StridePool retains source evidence for step review. Records flagged for suspicious activity may be excluded while support assesses them. Review and disqualification decisions can affect challenge results and settlement.",
      "For a disputed day, retain the challenge ID, date, health-source records, and sync details. Raise discrepancies as early as possible, preferably before settlement. A support decision must be based on the reviewed evidence, not an edited total or a screenshot alone.",
    ],
  },
  {
    id: "scope",
    title: "What this guide does—and does not—cover",
    summary: "These are current operating rules, not a declaration of legal approval.",
    paragraphs: [
      "This page explains the current StridePool challenge experience. It is not legal advice and does not replace the terms or privacy disclosures presented for acceptance. Paid-play terms and jurisdiction requirements still require qualified legal review before launch.",
      "The challenge details and checkout show the particular format and amounts for your entry. Check Safety for current launch restrictions and eligibility checks, and your wallet for confirmed financial records.",
      "This guide does not offer a paid solo-goal mode, sponsored entry, PayPal withdrawal, or a guaranteed support outcome. Those features or policies should not be assumed from another app's rules.",
    ],
  },
];
