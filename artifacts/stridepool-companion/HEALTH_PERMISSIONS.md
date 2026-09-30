# Native health declarations

StridePool Companion uses a local Expo native module for HealthKit and the native `react-native-health-connect` module on Android. These APIs are not available in Expo Go; test permission prompts and background access in an installed development or release build.

## iOS

`app.json` enables the HealthKit and HealthKit background-delivery entitlements and declares:

- `NSHealthShareUsageDescription` for reading step count samples.
- `NSHealthUpdateUsageDescription` because Apple requires a HealthKit usage explanation for the enabled capability.

The App Store target must retain the HealthKit capability. Users can revoke or restore access in **Settings → Privacy & Security → Health → StridePool**.

Apple intentionally does not expose read authorization status to apps. For iOS, `connected` means the HealthKit authorization flow completed without a system error; it does not claim Apple disclosed the user’s read choice. The bridge reports `denied` when the authorization request cannot complete and `revoked` only when HealthKit returns an explicit authorization-denied read error. An empty store remains connected because HealthKit deliberately makes “no records” indistinguishable from withheld records.

## Android

`app.json` and the native module manifest declare:

- `android.permission.health.READ_STEPS`
- `android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND`

The official Health Connect configuration plugin adds both the Android 13 permissions-rationale intent and the Android 14 `VIEW_PERMISSION_USAGE` activity alias. The Play Console Health apps declaration must list step-count reading and explain that records verify challenge progress. Users can revoke or restore access in **Health Connect → App permissions → StridePool**.

The permission request includes background access on supported Android versions. The bridge reports missing access as `revoked`; a declined prompt reports `denied`.