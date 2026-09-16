# StridePool step verification

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

Support can review pending samples through the admin step-sample review action.
An approval changes only the sample's verification status to `verified` and
rebuilds that user's affected date from all verified samples, including active
challenge records whose date contains the sample. A rejection changes the status to `rejected`
and rebuilds the same date without counting the sample. In both cases the raw
payload and original review flags remain intact, and repeating a decision is
rejected rather than counting the sample again.
