import ExpoModulesCore
import HealthKit
import WebKit

public final class StridePoolHealthModule: Module {
  private let store = HKHealthStore()
  private let requestedKey = "StridePoolHealth.requestedAppleHealth"
  private let connectedKey = "StridePoolHealth.connectedAppleHealth"
  private let enabledKey = "StridePoolHealth.backgroundEnabled"
  private let originKey = "StridePoolHealth.apiOrigin"
  private let failureAtKey = "StridePoolHealth.pendingFailureAt"
  private let failureReasonKey = "StridePoolHealth.pendingFailureReason"
  private var observerQuery: HKObserverQuery?

  public func definition() -> ModuleDefinition {
    Name("StridePoolHealth")

    OnCreate {
      self.restoreObserverIfEnabled()
    }

    OnDestroy {
      if let query = self.observerQuery {
        self.store.stop(query)
        self.observerQuery = nil
      }
    }

    AsyncFunction("requestPermissions") { (source: String) async throws -> String in
      guard source == "apple_health", HKHealthStore.isHealthDataAvailable(),
            let stepType = HKObjectType.quantityType(forIdentifier: .stepCount) else {
        return "denied"
      }
      UserDefaults.standard.set(true, forKey: self.requestedKey)
      try await self.store.requestAuthorization(toShare: [], read: [stepType])
      UserDefaults.standard.set(true, forKey: self.connectedKey)
      return "connected"
    }

    AsyncFunction("getPermissionStatus") { (source: String) async throws -> String in
      guard source == "apple_health", HKHealthStore.isHealthDataAvailable(),
            let stepType = HKObjectType.quantityType(forIdentifier: .stepCount) else {
        return "denied"
      }
      if !UserDefaults.standard.bool(forKey: self.requestedKey) { return "denied" }
      do {
        try await self.assertReadable(stepType)
        return UserDefaults.standard.bool(forKey: self.connectedKey) ? "connected" : "denied"
      } catch let healthError as HKError where healthError.code == .errorAuthorizationDenied {
        UserDefaults.standard.set(false, forKey: self.connectedKey)
        return "revoked"
      }
      return UserDefaults.standard.bool(forKey: self.connectedKey) ? "connected" : "revoked"
    }

    AsyncFunction("readStepSamples") { (source: String, since: String?) async throws -> [[String: Any]] in
      guard source == "apple_health" else { return [] }
      return try await self.readSamples(since: since)
    }

    AsyncFunction("configureBackgroundDelivery") { (source: String, apiOrigin: String, enabled: Bool) async throws -> Bool in
      guard source == "apple_health",
            let stepType = HKObjectType.quantityType(forIdentifier: .stepCount) else { return false }
      if !enabled {
        UserDefaults.standard.set(false, forKey: self.enabledKey)
        self.clearQueuedFailure()
        if let query = self.observerQuery {
          self.store.stop(query)
          self.observerQuery = nil
        }
        _ = try await self.setBackgroundDelivery(for: stepType, enabled: false)
        return false
      }
      guard let url = URL(string: apiOrigin), url.scheme == "https", url.host != nil else {
        throw NSError(domain: "StridePoolHealth", code: 1, userInfo: [NSLocalizedDescriptionKey: "A secure StridePool address is required for background delivery."])
      }
      let origin = "\(url.scheme ?? "https")://\(url.host ?? "")\(url.port.map { ":\($0)" } ?? "")"
      UserDefaults.standard.set(origin, forKey: self.originKey)
      guard try await self.setBackgroundDelivery(for: stepType, enabled: true) else { return false }
      UserDefaults.standard.set(true, forKey: self.enabledKey)
      self.startObserverIfNeeded()
      return true
    }

    AsyncFunction("markDeliverySucceeded") { (source: String) in
      guard source == "apple_health" else { return }
      self.clearQueuedFailure()
    }
  }

  private func restoreObserverIfEnabled() {
    guard UserDefaults.standard.bool(forKey: enabledKey),
          let origin = UserDefaults.standard.string(forKey: originKey),
          URL(string: origin)?.scheme == "https" else { return }
    startObserverIfNeeded()
  }

  private func startObserverIfNeeded() {
    guard observerQuery == nil,
          UserDefaults.standard.bool(forKey: enabledKey),
          let stepType = HKObjectType.quantityType(forIdentifier: .stepCount) else { return }
    let query = HKObserverQuery(sampleType: stepType, predicate: nil) { [weak self] _, completion, error in
      guard let self else {
        completion()
        return
      }
      Task {
        if error != nil {
          await self.queueFailure(reason: "native_read")
        } else {
          await self.deliverBackgroundSamples()
        }
        completion()
      }
    }
    observerQuery = query
    store.execute(query)
  }

  private func readSamples(since: String?) async throws -> [[String: Any]] {
    guard let stepType = HKObjectType.quantityType(forIdentifier: .stepCount) else { return [] }
    let start = ISO8601DateFormatter().date(from: since ?? "") ?? Date(timeIntervalSinceNow: -172800)
    let predicate = HKQuery.predicateForSamples(withStart: start, end: Date(), options: .strictStartDate)
    let samples: [HKQuantitySample] = try await withCheckedThrowingContinuation { continuation in
      let query = HKSampleQuery(
        sampleType: stepType,
        predicate: predicate,
        limit: HKObjectQueryNoLimit,
        sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
      ) { _, values, error in
        if let error { continuation.resume(throwing: error); return }
        continuation.resume(returning: (values as? [HKQuantitySample]) ?? [])
      }
      store.execute(query)
    }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let day = DateFormatter()
    day.calendar = Calendar(identifier: .iso8601)
    day.locale = Locale(identifier: "en_US_POSIX")
    day.timeZone = .current
    day.dateFormat = "yyyy-MM-dd"
    let recordedAt = formatter.string(from: Date())
    return samples.map { sample in
      let id = sample.uuid.uuidString
      return [
        "sourceSampleId": id,
        "recordDate": day.string(from: sample.startDate),
        "steps": Int(sample.quantity.doubleValue(for: .count())),
        "startTime": formatter.string(from: sample.startDate),
        "endTime": formatter.string(from: sample.endDate),
        "recordedAt": recordedAt,
        "rawPayload": ["platform": "healthkit", "uuid": id]
      ]
    }
  }

  private func deliverBackgroundSamples() async {
    guard UserDefaults.standard.bool(forKey: enabledKey),
          let origin = UserDefaults.standard.string(forKey: originKey),
          let cookie = await sessionCookie(for: origin) else {
      await queueFailure(reason: "upload_failed")
      return
    }
    await reportQueuedFailure(origin: origin, cookie: cookie)
    let samples: [[String: Any]]
    do {
      samples = try await readSamples(since: ISO8601DateFormatter().string(from: Date(timeIntervalSinceNow: -172800)))
    } catch {
      await queueFailure(reason: "native_read")
      return
    }
    do {
      for start in stride(from: 0, to: samples.count, by: 500) {
        guard UserDefaults.standard.bool(forKey: enabledKey) else { return }
        let batch = Array(samples[start..<min(start + 500, samples.count)])
        try await postJSON(
          origin: origin,
          cookie: cookie,
          path: "/api/stridepool/sources/apple_health/samples",
          body: ["samples": batch]
        )
      }
      guard UserDefaults.standard.bool(forKey: enabledKey) else { return }
      try await postJSON(
        origin: origin,
        cookie: cookie,
        path: "/api/stridepool/sources/apple_health/delivery",
        body: ["outcome": "success"]
      )
      clearQueuedFailure()
    } catch {
      await queueFailure(reason: "upload_failed")
      await reportQueuedFailure(origin: origin, cookie: cookie)
    }
  }

  private func queueFailure(reason: String) async {
    guard UserDefaults.standard.bool(forKey: enabledKey) else { return }
    UserDefaults.standard.set(ISO8601DateFormatter().string(from: Date()), forKey: failureAtKey)
    UserDefaults.standard.set(reason, forKey: failureReasonKey)
    guard let origin = UserDefaults.standard.string(forKey: originKey),
          let cookie = await sessionCookie(for: origin) else { return }
    await reportQueuedFailure(origin: origin, cookie: cookie)
  }

  private func reportQueuedFailure(origin: String, cookie: String) async {
    let defaults = UserDefaults.standard
    guard let attemptedAt = defaults.string(forKey: failureAtKey) else { return }
    let reason = defaults.string(forKey: failureReasonKey) ?? "upload_failed"
    do {
      try await postJSON(
        origin: origin,
        cookie: cookie,
        path: "/api/stridepool/sources/apple_health/delivery",
        body: ["outcome": "failure", "reason": reason, "attemptedAt": attemptedAt]
      )
      clearQueuedFailure()
    } catch {
      // Keep only failure metadata; HealthKit samples are reread on the next observer event.
    }
  }

  private func clearQueuedFailure() {
    UserDefaults.standard.removeObject(forKey: failureAtKey)
    UserDefaults.standard.removeObject(forKey: failureReasonKey)
  }

  private func setBackgroundDelivery(for type: HKObjectType, enabled: Bool) async throws -> Bool {
    try await withCheckedThrowingContinuation { continuation in
      let completion: (Bool, Error?) -> Void = { success, error in
        if let error {
          continuation.resume(throwing: error)
        } else {
          continuation.resume(returning: success)
        }
      }
      if enabled {
        store.enableBackgroundDelivery(for: type, frequency: .hourly, withCompletion: completion)
      } else {
        store.disableBackgroundDelivery(for: type, withCompletion: completion)
      }
    }
  }

  private func sessionCookie(for origin: String) async -> String? {
    guard let host = URL(string: origin)?.host else { return nil }
    let cookies: [HTTPCookie] = await withCheckedContinuation { continuation in
      WKWebsiteDataStore.default().httpCookieStore.getAllCookies { continuation.resume(returning: $0) }
    }
    guard let session = cookies.first(where: {
      let cookieDomain = $0.domain.trimmingCharacters(in: CharacterSet(charactersIn: "."))
      return $0.name == "sid" && (host == cookieDomain || host.hasSuffix("." + cookieDomain))
    }) else { return nil }
    return "\(session.name)=\(session.value)"
  }

  private func postJSON(origin: String, cookie: String, path: String, body: [String: Any]) async throws {
    guard let url = URL(string: origin + path) else {
      throw NSError(domain: "StridePoolHealth", code: 2, userInfo: [NSLocalizedDescriptionKey: "Invalid StridePool API address."])
    }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue(cookie, forHTTPHeaderField: "Cookie")
    request.httpBody = try JSONSerialization.data(withJSONObject: body)
    let (_, response) = try await URLSession.shared.data(for: request)
    guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else {
      throw NSError(domain: "StridePoolHealth", code: 3, userInfo: [NSLocalizedDescriptionKey: "StridePool did not accept the background delivery."])
    }
  }

  private func assertReadable(_ type: HKQuantityType) async throws {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      let query = HKSampleQuery(sampleType: type, predicate: nil, limit: 1, sortDescriptors: nil) { _, _, error in
        if let error { continuation.resume(throwing: error) }
        else { continuation.resume(returning: ()) }
      }
      store.execute(query)
    }
  }
}