---
name: Expo Go native health limits
description: Runtime distinction between the companion preview and installed native health builds
---

Expo Go cannot contain the companion's local HealthKit module or the Health Connect native library. Keep iOS module lookup optional and defer Android native-library evaluation until an actual request; surface a clear installed-build requirement rather than crashing at import or reporting a false permission denial.

**Why:** A preview can pass TypeScript and Metro checks yet throw “Cannot find native module” as soon as its eager native import runs in Expo Go.

**How to apply:** Test the preview as an unavailable-native state, and test real permission prompts only in a newly installed development or release build. Rebuild the binary after adding or changing native modules; updating JavaScript alone cannot add native code to an existing installation.

Keep ordinary screen and navigation testing accessible in Expo Go; restrict health operations instead of blocking the entire companion.

**Why:** An app-wide installed-build gate prevents iPhone users from testing features that do not need HealthKit, even though Expo Go can run the WebView.

**How to apply:** Show an explicit preview limitation notice, reject native-health bridge requests in Expo Go, and never count preview navigation as installed-device health evidence.

Do not assume Replit's managed native publishing route can build the existing custom health bridge.

**Why:** Official Replit documentation consulted on 2026-10-04 says custom native modules and EAS CLI/EAS Build are unsupported on Replit. The companion depends on a local custom HealthKit/Health Connect module.

**How to apply:** Recheck official platform documentation when choosing a distribution route. Until support changes, arrange an external native build setup for installed-device verification; JavaScript exports and Expo Go previews are not substitutes.

A clean Expo Doctor result does not establish portability to an external native-build host.

**Why:** SDK diagnostics passed on Linux while shared workspace exclusions still prevented macOS/Windows native tooling binaries from being installed. Different optional-binary families also use different package naming conventions.

**How to apply:** Include the whole workspace's platform dependency policy in native-build handoffs. Test preparation against the actual config with independently defined expected exclusions, preserve security protections, and still require a real build on the target host.