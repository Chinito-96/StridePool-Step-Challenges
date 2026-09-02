# StridePool step verification and recovery

StridePool accepts normalized step samples from two supported ecosystems:

- `apple_health` — Apple Health exports or an authorized HealthKit bridge
- `health_connect` — Android Health Connect exports or an authorized Health Connect bridge

The authenticated ingestion endpoint stores each source sample, its source id,
timestamps, the original payload, and the verification result. Re-sending the
same source id is idempotent for that user and source.

## Review rules

Samples count toward challenge settlement only when they are `verified`.
StridePool creates a `pending_review` sample when it detects:

- `burst_rate`: more than 1,500 steps in an interval shorter than five minutes
- `implausible_sample_total`: more than 60,000 steps in one sample
- `implausible_daily_total`: more than 60,000 steps across the day
- `backfilled_data`: the source says the sample was recorded more than 48 hours
  after the movement ended
- `invalid_interval`: an end timestamp at or before the start timestamp

The raw sample remains available to support even when it is held for review.
The daily verified total is rebuilt from verified samples, so a pending sample
cannot silently increase a challenge result.

## Recovery and settlement

Participants can request one of three visible recovery states:

- **Grace day** — consumes one of the challenge's published grace days.
- **Injury pause** — asks support to protect affected days while reviewing the
  source history.
- **Support review** — asks for a manual comparison of timestamps, raw source
  samples, and the challenge rules.

Any open recovery request moves the challenge to `pending_review`. Support
resolves the request as approved, denied, or resolved before settlement. This
keeps a source dispute separate from money events; paid settlement remains
provider- and counsel-gated.