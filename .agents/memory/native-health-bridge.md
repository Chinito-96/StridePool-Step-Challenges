---
name: Native health bridge
description: Boundary between the StridePool web artifact and native Apple Health or Health Connect permissions
---

The web artifact must treat Apple Health and Android Health Connect as native-companion sources. Permission prompts and platform reads belong behind the `window.StridePoolHealth` bridge; the browser must never claim it can request those permissions itself.

**Why:** HealthKit and Health Connect are platform APIs, not browser APIs. Keeping the bridge boundary explicit prevents a web preview or desktop browser from silently presenting a fake connection.

**How to apply:** Native companions should return stable sample IDs, timestamps, step counts, and permission states (`connected`, `denied`, or `revoked`). The web client normalizes those records and sends them through the authenticated source-sample endpoint, while the API owns verification and derived totals.

On iOS, HealthKit intentionally does not disclose whether read access was granted, denied, or later revoked. Treat a completed authorization flow as connected-but-undisclosed, and only report revoked when HealthKit provides an explicit authorization error.

**Why:** Inferring read authorization from an empty HealthKit query mislabels authorized users with no samples, while treating request completion as proof of the user’s choice overstates what Apple reveals.

**How to apply:** Document the iOS semantic difference, never infer denial from zero records, and keep bridge responses bound to the exact trusted origin and requesting document so OAuth navigation cannot receive in-flight health data.