// StridePool Paid Play Terms, as reviewed by counsel on October 6, 2026.
// The acceptance version must match PAID_PLAY_TERMS_VERSION in
// lib/db/src/stridepool-paid-play-policy.ts; bumping it forces re-acceptance.
// Sections 6.8, 6.9, 7.7, the three added 8.1 items, and Section 17 were
// added after that review and are pending counsel sign-off.
export const PAID_PLAY_TERMS_VERSION = 'paid-play-terms-2026-10-06';
export const PAID_PLAY_TERMS_UPDATED = 'October 6, 2026';
export const PAID_PLAY_TERMS_UPDATED_ISO = '2026-10-06';

export type PaidPlayTermsSection = {
  id: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
  table?: { headers: string[]; rows: string[][] };
};

export const paidPlayTermsIntro = [
  'These Paid Play Terms apply when you enter a challenge that requires an entry fee ("Paid Challenge") on StridePool, operated by Wennekes Enterprises LLC, an Illinois limited liability company ("StridePool," "we," "us"). They supplement StridePool\'s Terms of Service and Privacy Policy. If they conflict, these Paid Play Terms control for Paid Challenges.',
  'You accept these terms by affirmatively checking the acceptance box presented before your first Paid Challenge entry. Reading this document or browsing challenges does not constitute acceptance.',
];

export const paidPlayTermsSections: PaidPlayTermsSection[] = [
  {
    id: 'eligibility',
    title: '1. Eligibility',
    paragraphs: [
      '1.1 You must be at least 18 years old, or the age of majority where you live if higher. We verify age as part of identity verification under Section 9.',
      '1.2 You must be a resident of, and physically located in, a jurisdiction where Paid Challenges are permitted, both when you enter a Paid Challenge and when you request a withdrawal. Paid Challenges are not available to residents of, or persons located in: Arizona, Arkansas, Connecticut, Delaware, Iowa, Louisiana, Maryland, Montana, South Carolina, South Dakota, Tennessee, Vermont, and Washington. We may update this list at any time; changes do not affect challenges you have already entered unless the law requires it.',
      '1.3 We use device location, IP address, and other location signals to confirm eligibility. Using a VPN, proxy, or location spoofing to enter from a restricted jurisdiction is prohibited and grounds for disqualification under Section 8.',
      '1.4 You may hold only one account. Entering a Paid Challenge from more than one account is prohibited.',
      '1.5 You must complete identity verification under Section 9 before your first Paid Challenge entry.',
      '1.6 StridePool employees, contractors, and their immediate household members may not enter Paid Challenges unless we state otherwise in writing.',
    ],
  },
  {
    id: 'nature',
    title: '2. Nature of Paid Challenges',
    paragraphs: [
      '2.1 Paid Challenges are bona fide contests of physical endurance and effort. Prizes are awarded only to actual contestants, based solely on the verified step counts and activity data each contestant generates through their own walking or running under these terms. Outcomes do not depend on a random draw or on the result of any sporting event or third-party performance.',
      '2.2 Each participant controls their own result. Device and sync issues are addressed through the verification, correction, and review procedures in Sections 7, 8.5, and 10 so that results reflect actual effort.',
      '2.3 StridePool is not a casino, sportsbook, or lottery. Participation does not guarantee that you will finish or recover your entry fee.',
    ],
  },
  {
    id: 'how-it-works',
    title: '3. How a Paid Challenge Works',
    paragraphs: [
      '3.1 Sponsor. StridePool is the sponsor of every Paid Challenge, including challenges configured by a Challenge Creator. StridePool holds entry fees, administers verification, and pays prizes.',
      '3.2 Challenge Creators. A "Challenge Creator" is a user who configures a Paid Challenge within the parameters StridePool allows, such as entry fee, goal, duration, and format. Challenge Creators do not sponsor, guarantee, or fund prizes, and receive no share of the prize pool or platform fees.',
      '3.3 Challenge rules. Before you enter, each Paid Challenge displays: the entry fee; the separate platform fee and total payment; the daily step goal or other goal; the duration; the start and end dates and times; the challenge time zone; the format (for example, elimination or finish-the-goal); that no grace days apply; the minimum and maximum number of participants; whether and until when you may leave; and the payout structure.',
      '3.4 Challenge day. Each "challenge day" runs from 12:00:00 a.m. to 11:59:59 p.m. in the challenge time zone shown at entry. This applies to every participant regardless of where they are or whether they travel during the challenge.',
      '3.5 Entry. Your entry is complete when your payment is successfully processed and the challenge screen shows you as joined. If the challenge allows leaving, you may leave before the join deadline shown and receive a full refund under Section 5.3.',
      '3.6 Goals. Goals may be set by StridePool or, where the challenge allows, personalized at entry. Once a challenge starts, your goal is locked.',
      '3.7 No grace days; injury. Paid Challenges have no grace-day allowance. To qualify as a Finisher, you must meet your goal on every challenge day. If you are injured or become ill during a challenge, you may withdraw by contacting support@stridepool.com before the end of the challenge day on which the injury occurs. A withdrawal for injury or illness does not refund your entry fee and does not count a missed day as met; it only records the reason for your withdrawal. Please do not continue walking or running through an injury to meet a goal.',
      '3.8 Elimination format. In elimination challenges, if your verified steps for a challenge day fall short of your goal after that day\'s sync window under Section 7.4 has closed, you are eliminated. Before the sync window closes, your status may show "At Risk" but is not final. Once eliminated, your status shows "Eliminated" and your entry fee remains in the prize pool.',
      '3.9 Finisher. You are a "Finisher" if you meet every requirement of the challenge through its final challenge day and your data passes verification under Section 7.',
    ],
  },
  {
    id: 'prize-pool',
    title: '4. The Prize Pool and Payouts',
    paragraphs: [
      '4.1 Pool. The prize pool for a Paid Challenge consists only of the entry fees paid by participants in that challenge, plus any entry fees forfeited under Section 8. Platform fees under Section 5 do not enter the prize pool and are never deducted from it.',
      '4.2 Split. When the challenge ends, the pool is divided equally among all Finishers, unless the challenge displayed a different payout structure before you entered.',
      '4.3 Rounding. Pools and payouts are calculated in whole U.S. cents. In equal-split challenges, each Finisher receives the whole-cent base share, and any remaining cents are distributed one cent at a time among Finishers in the order they joined the challenge. In ranking challenges, the displayed payout structure is applied in whole cents, with remaining cents allocated the same way among eligible winners. Payouts always total the full prize pool. StridePool never retains any part of the pool.',
      '4.4 No-Finisher refund. If no participant finishes, every participant who was not disqualified under Section 8 receives a full refund of their entry fee under Section 5.4.',
      '4.5 Cancelled or under-filled challenges. If we cancel a challenge, or it does not reach its minimum number of participants by its start time, every participant receives a full refund of their entry fee and platform fee under Section 5.4.',
      '4.6 Timing. Settlement begins after the review period in Section 7.6 ends. We aim to finalize payouts within 5 business days after the final challenge day. Delivery to your bank or card also depends on our payment provider and your financial institution.',
      '4.7 Finality. A challenge moves through the states open, settling, and settled. Once settled, results are final, subject only to Section 8.4 (fraud correction), Section 8.5 (technical correction), and Section 10 (disputes).',
    ],
  },
  {
    id: 'fees',
    title: '5. Fees and Refunds',
    paragraphs: [
      '5.1 Platform fee. In addition to the challenge entry fee, each paid entry carries a platform fee of $2 for Free members and $1 for Pro members, based on your membership at checkout. "Free" and "Pro" membership are defined in the Terms of Service. The platform fee is StridePool\'s revenue for operating the challenge and is not part of the prize pool.',
      '5.2 Total payment. The total shown before checkout is the entry fee plus the platform fee. StridePool absorbs payment-processing fees charged by Stripe; no processing surcharge is added.',
      '5.3 When the platform fee is refunded:',
    ],
    table: {
      headers: ['Situation', 'Entry fee', 'Platform fee'],
      rows: [
        ['You leave before the join deadline (where allowed)', 'Refunded', 'Refunded'],
        ['Challenge cancelled by StridePool', 'Refunded', 'Refunded'],
        ['Challenge under-filled at start', 'Refunded', 'Refunded'],
        ['Challenge voided under Section 11', 'Refunded', 'Refunded'],
        ['No participant finishes', 'Refunded', 'Not refunded'],
        ['Eliminated or did not finish', 'Stays in pool', 'Not refunded'],
        ['Withdrawal for injury or illness', 'Stays in pool', 'Not refunded'],
        ['Disqualified for fraud', 'Forfeited to pool', 'Not refunded'],
        ['Disqualified for non-fraud technical reasons', 'Refunded', 'Refunded'],
      ],
    },
  },
  {
    id: 'fees-continued',
    title: '5. Fees and Refunds (continued)',
    paragraphs: [
      '5.4 How refunds are paid. Refunds go to your original payment method. If that is not possible, for example because the card has expired or been closed, the refund is credited to your wallet and may be withdrawn at any time without regard to the minimum withdrawal amount in Section 6.3.',
      '5.5 Third-party charges. Your bank, card issuer, or mobile carrier may charge you fees. We are not responsible for those.',
    ],
  },
  {
    id: 'wallet',
    title: '6. Payments and Wallet',
    paragraphs: [
      '6.1 Payment provider. Payments are processed by Stripe, Inc. and its affiliates, and you also agree to Stripe\'s applicable terms.',
      '6.2 Wallet balance. Winnings and certain refunds may be credited to your StridePool wallet. Your wallet balance is a record of amounts we owe you. Funds corresponding to wallet balances are held by our payment provider on your behalf and are not used for StridePool\'s operating expenses. Wallet balances are not a bank account, are not FDIC-insured, and do not earn interest. Free-play balances and credits are kept separate from paid balances and cannot be withdrawn as cash.',
      '6.3 Withdrawals. You may withdraw available wallet balances of $20 or more to a verified payout method, in any amount from $20 up to your available balance, subject to identity verification and your being located in a permitted jurisdiction. Pending funds are not available. The $20 minimum does not apply to refunds credited under Section 5.4 or to closures under Section 6.4.',
      '6.4 Account closure. If you close your account, or we close it for a reason other than fraud under Section 8, we will pay out your entire available wallet balance, regardless of amount, to your verified payout method, or to your original payment method if no payout method is verified.',
      '6.5 Chargebacks. If you file a chargeback or payment dispute for an entry fee, we may remove you from the challenge, suspend your account, and recover winnings or credits tied to that payment. We may contest chargebacks we believe are improper.',
      '6.6 Taxes. You are responsible for any taxes on your winnings. We will collect a Form W-9 or other tax information when required and will report prize payouts to the IRS and state tax authorities where the law requires, including issuing Form 1099 when your payouts in a calendar year meet the applicable reporting threshold. We may hold payouts until you provide required tax information.',
      '6.7 Unclaimed funds. If your account is inactive for 24 months, or you do not provide required information, we will attempt to contact you before treating any remaining balance as unclaimed property under applicable law.',
      '6.8 Payout account. Withdrawals go only to a payout account held in your own name that matches your verified identity. We may hold a withdrawal until the names match.',
      '6.9 Required notices. While you have an active paid entry or a wallet balance, we will send you transactional notices about your entries, results, refunds, payouts, security, and changes to these terms. You cannot opt out of these while either remains. Marketing messages are optional and you can turn them off at any time.',
    ],
  },
  {
    id: 'activity-data',
    title: '7. Activity Data and Verification',
    paragraphs: [
      '7.1 Data sources. Steps are collected from the sources you connect, such as Apple Health (HealthKit), Health Connect on Android, or other supported services. You must grant the required permissions for your steps to count. We use health data only to operate challenges and verify results, never for advertising, as described in our Privacy Policy.',
      '7.2 Accuracy. Step counts come from third-party devices and platforms whose accuracy we do not guarantee. You are responsible for keeping your device charged, synced, and permitted. If you believe a device or platform error affected your result, you may request review under Section 10.',
      '7.3 Accepted data. Only data from a supported, unmodified device or health platform counts. Manually entered steps, steps from unsupported sources, and steps we determine were not generated by your own walking or running do not count.',
      '7.4 Sync window. Steps for a challenge day must sync to StridePool within 24 hours after that challenge day ends. Data that arrives later does not count, except as corrected under Section 8.5.',
      '7.5 Verification. We may run automated and manual checks, including for abnormal patterns, impossible step rates, duplicate or conflicting sources, location spoofing, and device tampering. We may request additional proof, such as a health-app screenshot, a device check, or a short verification activity. If you do not respond within 48 hours, the affected steps may be excluded.',
      '7.6 Review period. After the sync window for the final challenge day closes, we hold results for a review period of up to 24 hours before settlement. Results are therefore settled no earlier than 48 hours after the final challenge day ends.',
      '7.7 Third-party wearables. Some wearables send steps to Apple Health or Health Connect only through their own companion apps, which can fail or lag without our knowledge. For Paid Challenges we recommend counting steps with your phone or a watch paired directly to it. If a companion app fails to deliver your steps within the sync window, you may request review under Section 10, but steps that never reach your connected health platform cannot be counted.',
    ],
  },
  {
    id: 'fair-play',
    title: '8. Fair Play, Anti-Cheat, and Disqualification',
    paragraphs: ['8.1 You may not, and may not help anyone else to:'],
    bullets: [
      'manually edit, inject, or fabricate step or activity data;',
      'use devices, machines, shakers, pets, vehicles, other people, or any method that creates steps without your own walking or running;',
      'use emulators, rooted or jailbroken devices for tampering, VPNs or spoofed location, or automation;',
      'operate multiple accounts or collude with other participants;',
      'exploit bugs or errors in StridePool;',
      'provide false identity, location, or payment information;',
      'enter or leave a challenge, or deliberately miss a goal, in order to move money to another participant, or otherwise transfer value between accounts;',
      'pay an entry fee with a card or account that is not yours;',
      'share your account, or enter a challenge on someone else\'s behalf;',
      'harass other participants or staff.',
    ],
  },
  {
    id: 'fair-play-consequences',
    title: '8. Fair Play (continued)',
    paragraphs: [
      '8.2 Consequences. If we reasonably determine, after considering any information you provide, that you violated Section 8.1, we may remove your steps, disqualify you, reverse or recover payouts, suspend or close your account, and report conduct to authorities or payment providers where appropriate. We will notify you of a disqualification and its reason.',
      '8.3 Treatment of entry fees. If you are disqualified for a violation of Section 8.1, your entry fee is forfeited to the prize pool and your platform fee is not refunded. If you are removed for a technical reason that is not your fault and does not involve a violation, both fees are refunded under Section 5.3.',
      '8.4 Fraud discovered after settlement. If we discover within 90 days after a challenge is settled that a participant violated Section 8.1, we may recalculate the results, recover the violating participant\'s winnings, and redistribute recovered funds to the participants who should have received them. We will not recover funds from participants who did not violate these terms, except under Section 8.5.',
      '8.5 Technical corrections. Administrators may adjust results for a verified technical error, outage, or data-source failure, applying the same correction to all affected participants. Every manual adjustment is logged with its reason and is available for review in a dispute under Section 10. If a correction within 90 days after settlement shows that a participant was overpaid because of our system error, we may offset the overpayment against that participant\'s wallet balance, but we will not otherwise demand repayment.',
      '8.6 Disqualified participants are not Finishers and are excluded from the payout split and from any No-Finisher refund.',
    ],
  },
  {
    id: 'identity',
    title: '9. Identity Verification, Biometrics, and Compliance',
    paragraphs: [
      '9.1 Before your first Paid Challenge entry, you must verify your identity, age, residence, and payout account ("KYC").',
      '9.2 We use third-party verification providers and share with them only the information needed for verification.',
      '9.3 We may delay or refuse entries, payouts, or withdrawals while verification is incomplete, or where we reasonably suspect fraud, money laundering, sanctions violations, or other unlawful activity.',
      '9.4 We may freeze funds and report to authorities as required by law.',
      '9.5 You must provide truthful information and keep it updated. Providing false information is a violation of Section 8.1.',
      '9.6 Biometric information. If identity verification compares a photo of your face to your ID, our verification provider may collect a scan of your face geometry ("biometric information"). Before any collection, we will present a separate written notice and ask for your written consent. Biometric information is used only to verify your identity, is not sold, leased, traded, or otherwise profited from, and is permanently destroyed within 30 days after verification is complete, and in no event later than permitted by applicable law, including the Illinois Biometric Information Privacy Act. Our biometric retention and destruction policy is available at stridepool.com/biometric-policy. If you do not consent, you may request an alternative verification method by contacting support@stridepool.com.',
    ],
  },
  {
    id: 'disputes',
    title: '10. Disputes About Results',
    paragraphs: [
      '10.1 You may dispute a result by emailing support@stridepool.com within 14 days after the challenge is marked settled. Include the challenge name, dates, a description of the issue, and any evidence such as health-app screenshots.',
      '10.2 We will review and respond within 5 business days, including the reason for our decision and any manual adjustment log relevant to your result. Our decision is final, subject to Section 16 (Arbitration).',
      '10.3 If a dispute shows an error in our system, we will correct the result and adjust payouts under Section 8.5.',
    ],
  },
  {
    id: 'technical',
    title: '11. Technical Failures and Force Majeure',
    paragraphs: [
      '11.1 We are not responsible for failures outside our reasonable control, including outages of Apple, Google, health platforms, payment providers, networks, or devices.',
      '11.2 If a technical problem materially affects a challenge, we may extend it, correct results under Section 8.5, or void it. If we void a challenge, all entry fees and platform fees are refunded under Section 5.3. Remedies are chosen in good faith and applied equally to all affected participants.',
    ],
  },
  {
    id: 'responsible',
    title: '12. Responsible Participation and Health',
    paragraphs: [
      '12.1 Paid Challenges involve physical activity. Consult a doctor before starting any exercise program. Do not walk or run in unsafe conditions, in traffic, or while distracted to meet a goal.',
      '12.2 You participate at your own risk. To the extent permitted by law, StridePool is not responsible for injury, illness, or loss arising from your physical activity, except where caused by our gross negligence or willful misconduct.',
      '12.3 Do not enter Paid Challenges with money you cannot afford to lose. You may set entry limits or request a temporary or permanent exclusion from Paid Challenges in your profile or by contacting support@stridepool.com, and we will apply valid requests within 2 business days. If you feel your participation is becoming a problem, free support is available through the National Problem Gambling Helpline at 1-800-GAMBLER (1-800-522-4700).',
    ],
  },
  {
    id: 'changes',
    title: '13. Changes to Challenges and to These Terms',
    paragraphs: [
      '13.1 We may modify, pause, or discontinue Paid Challenges. We will not change the rules of a challenge you have already entered in a way that is materially unfavorable to you, except to fix errors, comply with law, or prevent fraud.',
      '13.2 We may update these terms. We will post the new version and notify you of material changes at least 14 days before they take effect. Changes never apply to challenges you entered before the effective date.',
      '13.3 Material changes require you to affirmatively accept the updated terms before your next Paid Challenge entry. Changes to Section 16 (Arbitration) never apply to a dispute already pending or a claim that arose before the change. If you do not accept, you may stop entering Paid Challenges and withdraw your available balance under Section 6.4.',
    ],
  },
  {
    id: 'platforms',
    title: '14. App Store and Platform Disclaimers',
    paragraphs: [
      '14.1 Apple Inc. and Google LLC are not sponsors of, and are not involved in any manner with, Paid Challenges or any contest on StridePool. Apple and Google have no responsibility for prizes, entry fees, or the administration of any challenge.',
      '14.2 Entry fees are not paid through Apple or Google in-app purchase. These official rules are available within the StridePool app at all times.',
    ],
  },
  {
    id: 'liability',
    title: '15. Disclaimers and Limitation of Liability',
    paragraphs: [
      '15.1 Disclaimer. To the extent permitted by law, Paid Challenges and StridePool are provided "as is" and "as available."',
      '15.2 Limit of liability. To the extent permitted by law, StridePool\'s total liability to you arising from a Paid Challenge is limited to the entry fee and platform fee you paid for that challenge. This limit does not apply to: (a) prize payouts, refunds, or wallet balances owed to you under these terms; or (b) liability caused by our gross negligence, fraud, or willful misconduct. We are not liable for indirect, incidental, special, or consequential damages.',
    ],
  },
  {
    id: 'arbitration',
    title: '16. Governing Law, Arbitration, and Class Waiver',
    paragraphs: [
      '16.1 Governing law. These terms are governed by the laws of the State of Illinois, without regard to conflict-of-law rules.',
      '16.2 Arbitration. Any dispute arising from these terms that is not resolved under Section 10 will be resolved by binding individual arbitration administered by the American Arbitration Association under its Consumer Arbitration Rules, in Illinois, in your county of residence, or by video conference, at your choice. StridePool will pay all AAA filing, administration, and arbitrator fees beyond the amount you would pay to file a claim in court.',
      '16.3 Exceptions. Either party may bring an individual claim in small-claims court. Either party may seek injunctive relief in court for misuse of intellectual property or unauthorized access to StridePool systems.',
      '16.4 Class waiver. You and StridePool waive any right to bring or join a class, collective, or representative action. If this waiver is found unenforceable for a claim, that claim proceeds in court, not in arbitration.',
      '16.5 Opt-out. You may opt out of arbitration within 30 days after first accepting these terms by emailing support@stridepool.com with the subject "Arbitration Opt-Out" and your account email.',
      '16.6 Severability. If any part of this Section 16 other than the class waiver is found unenforceable, the rest remains in effect.',
    ],
  },
  {
    id: 'general',
    title: '17. General Terms',
    paragraphs: [
      '17.1 Indemnity. If a third-party claim against StridePool arises from your violation of these terms, your fraud, or your violation of law, you will cover StridePool\'s reasonable losses and costs from that claim. This does not apply to claims caused by StridePool\'s own negligence or misconduct.',
      '17.2 Sanctions. You confirm that you are not located in a country subject to U.S. embargo and are not on a U.S. government list of prohibited or restricted parties.',
      '17.3 Assignment. You may not transfer your account or your rights under these terms. StridePool may assign these terms in a merger, acquisition, or sale of its business, and the terms will continue to protect you on the same basis.',
      '17.4 Severability and waiver. If any provision is found unenforceable, it will be limited to the minimum extent necessary and the rest of these terms remain in effect. Our not enforcing a provision once does not waive it.',
      '17.5 Survival. Sections 6, 8.4, 10, 15, 16, and 17 continue to apply after your account closes, along with any amounts owed by either side.',
      '17.6 Entire agreement. These Paid Play Terms, the Terms of Service, and the Privacy Policy are the entire agreement between you and StridePool about Paid Challenges. There is no agency, partnership, or employment relationship between you and StridePool or between participants.',
    ],
  },
  {
    id: 'contact',
    title: '18. Contact',
    paragraphs: ['Wennekes Enterprises LLC, 4701 W 900 N, Michigan City, IN 46360. support@stridepool.com'],
  },
];
