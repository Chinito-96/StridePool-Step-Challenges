import ExpoModulesCore
import HealthKit

public final class StridePoolHealthModule: Module {
  private let store = HKHealthStore()
  private let requestedKey = "StridePoolHealth.requestedAppleHealth"
  private let connectedKey = "StridePoolHealth.connectedAppleHealth"

  public func definition() -> ModuleDefinition {
    Name("StridePoolHealth")

    AsyncFunction("requestPermissions") { (source: String) async throws -> String in
      guard source == "apple_health", HKHealthStore.isHealthDataAvailable(),
            let stepType = HKObjectType.quantityType(forIdentifier: .stepCount) else {
        return "denied"
      }
      UserDefaults.standard.set(true, forKey: requestedKey)
      try await store.requestAuthorization(toShare: [], read: [stepType])
      UserDefaults.standard.set(true, forKey: connectedKey)
      return "connected"
    }

    AsyncFunction("getPermissionStatus") { (source: String) async throws -> String in
      guard source == "apple_health", HKHealthStore.isHealthDataAvailable(),
            let stepType = HKObjectType.quantityType(forIdentifier: .stepCount) else {
        return "denied"
      }
      if !UserDefaults.standard.bool(forKey: requestedKey) { return "denied" }
      do {
        try await assertReadable(stepType)
        return UserDefaults.standard.bool(forKey: connectedKey) ? "connected" : "denied"
      } catch let healthError as HKError where healthError.code == .errorAuthorizationDenied {
        UserDefaults.standard.set(false, forKey: connectedKey)
        return "revoked"
      }
      return UserDefaults.standard.bool(forKey: connectedKey) ? "connected" : "revoked"
    }

    AsyncFunction("readStepSamples") { (source: String, since: String?) async throws -> [[String: Any]] in
      guard source == "apple_health",
            let stepType = HKObjectType.quantityType(forIdentifier: .stepCount) else { return [] }
      let start = ISO8601DateFormatter().date(from: since ?? "") ?? Date(timeIntervalSinceNow: -172800)
      let predicate = HKQuery.predicateForSamples(withStart: start, end: Date(), options: .strictStartDate)
      let samples: [HKQuantitySample] = try await withCheckedThrowingContinuation { continuation in
        let query = HKSampleQuery(sampleType: stepType, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]) { _, values, error in
          if let error { continuation.resume(throwing: error); return }
          continuation.resume(returning: (values as? [HKQuantitySample]) ?? [])
        }
        store.execute(query)
      }
      let formatter = ISO8601DateFormatter()
      let day = DateFormatter()
      day.calendar = Calendar(identifier: .iso8601)
      day.locale = Locale(identifier: "en_US_POSIX")
      day.dateFormat = "yyyy-MM-dd"
      return samples.map { sample in
        [
          "sourceSampleId": sample.uuid.uuidString,
          "recordDate": day.string(from: sample.startDate),
          "steps": Int(sample.quantity.doubleValue(for: .count())),
          "startTime": formatter.string(from: sample.startDate),
          "endTime": formatter.string(from: sample.endDate),
          "rawPayload": ["platform": "healthkit", "uuid": sample.uuid.uuidString]
        ]
      }
    }
  }

  private func assertReadable(_ type: HKQuantityType) async throws {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      let query = HKSampleQuery(sampleType: type, predicate: nil, limit: 1, sortDescriptors: nil) { _, values, error in
        if let healthError = error as? HKError, healthError.code == .errorAuthorizationDenied {
          continuation.resume(throwing: healthError)
        } else if let error {
          continuation.resume(throwing: error)
        } else {
          continuation.resume(returning: ())
        }
      }
      store.execute(query)
    }
  }
}