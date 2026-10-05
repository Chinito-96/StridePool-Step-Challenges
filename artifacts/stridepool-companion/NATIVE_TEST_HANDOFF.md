# Installed-device build and launch-check handoff

Publication remains blocked until the full paid-play and native-mobile launch checks are complete. This guide prepares local test builds; it does not authorize publication, enable paid play, or establish legal approval.

## 1. Prepare an external checkout

Use a fresh clone or downloaded copy of the **whole repository**, not only the companion directory. The companion imports shared workspace packages. Do not copy Replit's `node_modules`, credentials, or environment secrets.

Prerequisites:

- Node.js 24 and pnpm 10.
- iPhone: a Mac with Xcode, its command-line tools, CocoaPods, and a signing/provisioning setup that supports HealthKit and background delivery. Configure signing locally in Xcode; never send signing credentials in chat.
- Android: Android Studio/SDK and a compatible JDK. Use a physical phone with Health Connect available and USB debugging enabled.
- Both phones need access to the StridePool web/API development host. Keep that backend running during tests.

The checked-in workspace excludes macOS/Windows binaries for esbuild, Lightning CSS, Tailwind Oxide, Rollup, and ngrok because Replit runs on Linux. In your **external checkout only**, enable those optional binaries before installing:

```sh
# From the repository root:
node artifacts/stridepool-companion/scripts/prepare-native-workspace.mjs --check
node artifacts/stridepool-companion/scripts/prepare-native-workspace.mjs --write
pnpm install --no-frozen-lockfile
pnpm run typecheck:libs
cd artifacts/stridepool-companion
CI=1 pnpm exec expo install --check
pnpm dlx expo-doctor@latest
```

The helper changes only macOS/Windows binary exclusions and their explanatory comment. It preserves supply-chain protections and security version overrides, and refuses to write inside Replit. Installation regenerates the local lockfile for those newly allowed binaries; do not replace the Replit workspace configuration with this local preparation without reviewing the difference.

## 2. Select the backend and install Debug builds

Set `EXPO_PUBLIC_DOMAIN` in each build terminal to the **StridePool web preview hostname**, without `https://`, a path, or a trailing slash. Do not use the Expo/Metro preview hostname. This is public build configuration, not a secret.

```sh
# From artifacts/stridepool-companion on the external machine:
export EXPO_PUBLIC_DOMAIN="YOUR_STRIDEPOOL_WEB_PREVIEW_HOST"

# On the Mac, select the connected physical iPhone:
pnpm exec expo run:ios --device

# In another terminal with the same domain configuration:
pnpm exec expo run:android --device
```

These commands generate missing native projects, build and install the app, and start Metro. Do not use `prebuild --clean` casually: it can discard manual changes in generated native projects. On Windows, set the same public variable using your shell's environment-variable syntax.

If iPhone signing needs attention, open the generated Xcode workspace and configure the development team for `com.stridepool.app`. Retain both HealthKit entitlements declared in `app.json`. Enable Developer Mode on the phone if requested.

Use the installed StridePool app, not Expo Go. Confirm the HealthKit/Health Connect module is present; an “installed build required” message is a failed native-build check, not successful permission handling.

## 3. Test installed Release builds before background checks

Debug builds help diagnose native compilation and permissions but rely on Metro. Background/restart launch evidence must also come from installed Release builds that operate without the development server.

```sh
# Keep EXPO_PUBLIC_DOMAIN set to the test backend in each terminal.
pnpm exec expo run:ios --device --configuration Release
pnpm exec expo run:android --device --variant release
```

Configure any required local Release signing in Xcode/Gradle. These commands are not App Store/Play Store submission, and a locally installed test build does not prove store-distribution readiness.

## 4. Device checks

Use signed-in test accounts and free challenges while paid play is blocked. Do not use real entry payments to test native health delivery.

| Check | Required observation |
| --- | --- |
| Install and launch | Native compilation succeeds on both platforms; installed apps load the intended backend without a crash. |
| Sign in | The account remains correct through native WebView login/navigation. Health records are not sent before sign-in. |
| First permission request | The actual HealthKit/Health Connect system screen appears. Android background-access availability is recorded, not assumed. |
| New steps | With access enabled, newly recorded native step samples appear in account progress after sync. Verify against the phone's health source; do not use manual/CSV steps as evidence. |
| Replay | Repeating the same sync does not increase totals from the same samples. |
| Revoke and restore | Test from system settings. Previous verified totals remain intact; Android missing permission is surfaced. Restoring access allows new samples to sync. |
| Foreground retry | Turn networking off, record steps, restore networking and reopen. Previously unsent records arrive without counting the same samples twice. |
| Background, app unopened | In a Release build, leave the app in the background, record steps and check the account from a separate browser **before reopening the app**. Record elapsed time and whether any upload actually arrived. |
| App termination | Test ordinary backgrounding separately from iOS force-quit and Android force-stop. Record each outcome; do not treat a later foreground catch-up as background delivery. |
| Android restart | Restart the phone after enabling background delivery. Check whether uploads resume without reopening the app, then separately test foreground recovery. |
| Sign out | Sign out, then record activity. Confirm it does not get delivered using the previous account session. |

On iOS, HealthKit intentionally hides read-authorization choices. A completed prompt is not proof that reading was allowed, and an empty query is not proof of denial. Inspect the phone's Health settings and use newly recorded samples to assess actual reads. Background scheduling is controlled by the OS; record real outcomes rather than assuming immediate delivery or promising behavior after force-quit.

## 5. Return evidence

For each platform, provide:

- OS version, test date, and tested code revision.
- Debug and Release build success/failure, including signing errors if any.
- Each checklist result: `PASS`, `FAIL`, or `NOT TESTED`.
- Background observation windows and whether the app was opened before records arrived.
- Redacted error messages/build logs for failures.

Do not share credentials, session cookies, bearer tokens, provisioning secrets, raw health records, device serial numbers, or unrelated account data. Keep detailed health samples on the device/in the test account.

No native compilation or real-device delivery has been verified by the workspace's JavaScript exports, typechecks, Expo Doctor results, or web screenshots. Mark the mobile launch checks complete only after reviewing installed-device evidence. Written legal approval, provider identity verification, and remaining paid-play reconciliation checks remain separate launch requirements.