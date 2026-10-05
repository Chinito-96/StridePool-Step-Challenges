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

### Alternative: EAS cloud builds from your external checkout

The checked-in `eas.json` has a **preview-only** profile: installable Android APKs and signed physical-iPhone builds for internal testing. These builds do not need Metro. No store-submission profile or automatic publication is configured.

Run the external-workspace preparation in section 1 before uploading an iPhone build. Use the current EAS CLI locally, not inside Replit:

```sh
npm install -g eas-cli
eas login
cd artifacts/stridepool-companion
eas init
eas env:set --name EXPO_PUBLIC_DOMAIN --value YOUR_STRIDEPOOL_WEB_PREVIEW_HOST --environment preview --visibility plaintext
eas device:create
eas build --profile preview --platform all
```

Use `eas init` to link this checkout to your own Expo project; do not invent a project ID. `eas device:create` registers the physical iPhone for internal distribution. iPhone builds require a suitable Apple Developer account and provisioning; configure these through Expo's local prompts and never share credentials in chat. Android-only testing can start with `--platform android` if iPhone provisioning is not ready.

The pre-install hook refuses missing/malformed backend hostnames, Expo/Metro hostnames, and iPhone uploads that still exclude macOS tooling binaries. It does not enable paid play or prove native compilation. Download and install the resulting test builds, then complete the checklist below.

The default Git/EAS ignore rules exclude local environment files, common native signing credentials, and generated app native projects. The checked-in health-module native source remains included so EAS Prebuild can link it. Never deliberately override these exclusions to upload credentials. Supply signing configuration through Expo's credential prompts instead.

For configuration and hooks, see the official [EAS profile guide](https://docs.expo.dev/build/eas-json), [environment-variable guide](https://docs.expo.dev/build-reference/variables/), and [build-hook guide](https://docs.expo.dev/build-reference/npm-hooks/).

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

### iPhone suspended-app evidence

For the iPhone background check, use an installed **Release** build with the HealthKit and HealthKit background-delivery entitlements in `app.json`. Sign in to a test account, grant step access in iOS Health settings, and confirm the companion reports background delivery as scheduled. The app's message says delivery is scheduled when the device allows it; it is not a timing guarantee.

1. Record the iPhone model, iOS version/build, app build and tested code revision, test date, backend reachability, and the Health settings shown for StridePool.
2. Record the account's current Apple Health `lastSyncedAt`, verified sample count, and step total.
3. Put the app in the background or lock the phone without force-quitting it. Keep the WebView unopened. Record actual steps through normal activity while the app is suspended; do not use manually entered or imported records.
4. From a separate signed-in browser, check the account before reopening the companion. Record the observation start/end times, whether the app stayed unopened, and whether the new sample and updated delivery state appeared. Report elapsed time as an observation, not as a pass/fail latency threshold.
5. Only after that observation, reopen the companion and repeat the sync. Confirm the same source sample is not inserted twice and the verified step total does not increase a second time.
6. Test force-quit separately and label it separately; it must not be counted as a suspended-app result. If delivery is not observed before the companion is reopened, record that run as a failure or incomplete observation, not as a successful background delivery.

On iOS, HealthKit intentionally hides read-authorization choices. A completed prompt is not proof that reading was allowed, and an empty query is not proof of denial. Inspect the phone's Health settings and use newly recorded samples to assess actual reads. Background scheduling is controlled by the OS; report real outcomes without asserting an exact wake-up time or promising behavior after force-quit.

## 5. Return evidence

For each platform, provide:

- OS version, test date, and tested code revision.
- Device model, app build type/version, Health settings, network condition, and whether the app was suspended, force-quit, or reopened.
- Debug and Release build success/failure, including signing errors if any.
- Each checklist result: `PASS`, `FAIL`, or `NOT TESTED`.
- Background observation start/end times and whether records arrived before the companion was reopened; elapsed time is evidence, not a delivery-time guarantee.
- Redacted error messages/build logs for failures.

Do not share credentials, session cookies, bearer tokens, provisioning secrets, raw health records, device serial numbers, or unrelated account data. Keep detailed health samples on the device/in the test account.

No native compilation or real-device delivery has been verified by the workspace's JavaScript exports, typechecks, Expo Doctor results, or web screenshots. Mark the mobile launch checks complete only after reviewing installed-device evidence. Written legal approval, provider identity verification, and remaining paid-play reconciliation checks remain separate launch requirements.