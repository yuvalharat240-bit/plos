import Foundation

struct HealthSleepSample {
    let sourceId: String
    let start: Date
    let end: Date
    let durationMin: Int
}

struct HealthVitalSample {
    let sourceId: String
    let vitalType: String
    let value: Double
    let unit: String
    let observedAt: Date
}

struct HealthWorkoutSample {
    let sourceId: String
    let sportType: String
    let start: Date
    let end: Date?
    let durationMin: Int?
    let calories: Double?
}

#if os(iOS)
import HealthKit

/**
 * docs/09 Milestone 3 / ADR D4, docs/03 §2.1: client-driven HealthKit —
 * this service is the only place that touches `HKHealthStore`. Read-only
 * (sleep, resting heart rate, workouts); never requests share/write
 * types, matching the Info.plist usage string.
 *
 * A real, deliberate limitation, not an oversight: HealthKit does NOT
 * tell an app whether the user granted or denied a *read* type — Apple's
 * own privacy design (unlike EventKit, which does report real status).
 * `HKHealthStore.authorizationStatus(for:)` for a read-only type stays
 * `.notDetermined`-shaped information is unavailable even after a real
 * grant. `hasRequestedAccess` below is therefore a LOCAL "did we ask"
 * flag, not a "did they say yes" flag — `ConnectedAppsView` is explicit
 * about this distinction in its own UI copy rather than presenting a
 * guess as a fact (CLAUDE.md's epistemic-status non-negotiable applies
 * to UI copy, not just agent output).
 */
struct HealthKitService {
    private let store = HKHealthStore()

    var isAvailable: Bool { HKHealthStore.isHealthDataAvailable() }

    private var readTypes: Set<HKObjectType> {
        var types: Set<HKObjectType> = [HKObjectType.workoutType()]
        if let sleep = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) {
            types.insert(sleep)
        }
        if let hr = HKObjectType.quantityType(forIdentifier: .restingHeartRate) {
            types.insert(hr)
        }
        return types
    }

    func requestAuthorization() async throws {
        guard isAvailable else { throw HealthKitServiceError.unavailable }
        try await store.requestAuthorization(toShare: [], read: readTypes)
    }

    func fetchRecentSleep(days: Int = 14) async throws -> [HealthSleepSample] {
        guard let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) else { return [] }
        let samples = try await querySamples(type: sleepType, days: days)
        return samples.compactMap { sample -> HealthSleepSample? in
            guard let categorySample = sample as? HKCategorySample else { return nil }
            let asleepValues: Set<Int> = [
                HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue,
                HKCategoryValueSleepAnalysis.asleepCore.rawValue,
                HKCategoryValueSleepAnalysis.asleepDeep.rawValue,
                HKCategoryValueSleepAnalysis.asleepREM.rawValue,
            ]
            guard asleepValues.contains(categorySample.value) else { return nil }
            let minutes = Int(categorySample.endDate.timeIntervalSince(categorySample.startDate) / 60)
            return HealthSleepSample(
                sourceId: categorySample.uuid.uuidString,
                start: categorySample.startDate,
                end: categorySample.endDate,
                durationMin: minutes
            )
        }
    }

    func fetchRecentRestingHeartRate(days: Int = 14) async throws -> [HealthVitalSample] {
        guard let hrType = HKObjectType.quantityType(forIdentifier: .restingHeartRate) else { return [] }
        let samples = try await querySamples(type: hrType, days: days)
        let unit = HKUnit.count().unitDivided(by: .minute())
        return samples.compactMap { sample -> HealthVitalSample? in
            guard let quantitySample = sample as? HKQuantitySample else { return nil }
            return HealthVitalSample(
                sourceId: quantitySample.uuid.uuidString,
                vitalType: "resting_hr",
                value: quantitySample.quantity.doubleValue(for: unit),
                unit: "bpm",
                observedAt: quantitySample.startDate
            )
        }
    }

    func fetchRecentWorkouts(days: Int = 14) async throws -> [HealthWorkoutSample] {
        let samples = try await querySamples(type: HKObjectType.workoutType(), days: days)
        return samples.compactMap { sample -> HealthWorkoutSample? in
            guard let workout = sample as? HKWorkout else { return nil }
            return HealthWorkoutSample(
                sourceId: workout.uuid.uuidString,
                sportType: Self.sportType(for: workout.workoutActivityType),
                start: workout.startDate,
                end: workout.endDate,
                durationMin: Int(workout.duration / 60),
                calories: workout.statistics(for: HKQuantityType(.activeEnergyBurned))?
                    .sumQuantity()?.doubleValue(for: .kilocalorie())
            )
        }
    }

    private func querySamples(type: HKSampleType, days: Int) async throws -> [HKSample] {
        let start = Calendar.current.date(byAdding: .day, value: -days, to: Date()) ?? Date()
        let predicate = HKQuery.predicateForSamples(withStart: start, end: Date())
        return try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(sampleType: type, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: samples ?? [])
                }
            }
            store.execute(query)
        }
    }

    private static func sportType(for activityType: HKWorkoutActivityType) -> String {
        switch activityType {
        case .running: return "run"
        case .cycling: return "ride"
        case .swimming: return "swim"
        case .yoga: return "yoga"
        case .traditionalStrengthTraining, .functionalStrengthTraining: return "strength"
        default: return "other"
        }
    }
}

enum HealthKitServiceError: Error {
    case unavailable
}

#else

/// macOS stub — HealthKit doesn't exist on this platform. Same interface as
/// the real iOS implementation so `PlosPreviewApp` (the macOS verification
/// harness) keeps compiling without every call site needing its own `#if os(iOS)`.
struct HealthKitService {
    var isAvailable: Bool { false }
    func requestAuthorization() async throws { throw HealthKitServiceError.unavailable }
    func fetchRecentSleep(days: Int = 14) async throws -> [HealthSleepSample] { [] }
    func fetchRecentRestingHeartRate(days: Int = 14) async throws -> [HealthVitalSample] { [] }
    func fetchRecentWorkouts(days: Int = 14) async throws -> [HealthWorkoutSample] { [] }
}

enum HealthKitServiceError: Error {
    case unavailable
}

#endif
