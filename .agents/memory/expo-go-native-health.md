---
name: Expo Go native health limits
description: Runtime distinction between the companion preview and installed native health builds
---

Expo Go cannot contain the companion's local HealthKit module or the Health Connect native library. Keep iOS module lookup optional and defer Android native-library evaluation until an actual request; surface a clear installed-build requirement rather than crashing at import or reporting a false permission denial.

**Why:** A preview can pass TypeScript and Metro checks yet throw “Cannot find native module” as soon as its eager native import runs in Expo Go.

**How to apply:** Test the preview as an unavailable-native state, and test real permission prompts only in a newly installed development or release build. Rebuild the binary after adding or changing native modules; updating JavaScript alone cannot add native code to an existing installation.