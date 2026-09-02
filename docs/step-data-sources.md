# StridePool step-data sources

StridePool is currently a web app. A normal browser cannot request or read
Apple HealthKit or Android Health Connect permissions; those APIs are exposed
to native iOS and Android applications, not ordinary web pages. The web app
therefore does not claim that a browser “connected” either source.

## Sources available on the web

- **Manual daily total** — a signed-in user records a daily total. The value is
  persisted through the same normalized source-sample path as other imports.
- **CSV import** — a user imports rows in `YYYY-MM-DD,steps` format. Each row is
  stored as a source sample and rebuilt into the daily record.
- **Demo steps** — a deterministic development/demo source remains available
  for previewing the flow.

All three sources are intentionally scoped to the free community lane. They do
not debit wallets, create paid entries, or settle a challenge.

## Native sources

Apple Health and Health Connect are represented as future source types so the
normalized ingestion contract can accept them later. The realistic production
options are:

1. A companion mobile shell with native permissions that uploads normalized
   samples to the existing ingestion endpoint.
2. A user-authorized export/import flow, such as CSV from a supported health
   service.
3. A third-party provider that offers a server-side health-data connection,
   subject to its consent, retention, and verification rules.

Until one of those exists, the UI labels native sources as companion-app-only
and never fabricates a native reading.

## Review heuristics

Samples are held out of the verified daily record when they contain an invalid
time interval, more than 1,500 steps in under five minutes, more than 60,000
steps in one sample, more than 60,000 verified-plus-incoming steps for one day,
or a source timestamp more than 48 hours behind its upload time. Flagged
records remain visible in the authenticated source-review panel for support
follow-up.