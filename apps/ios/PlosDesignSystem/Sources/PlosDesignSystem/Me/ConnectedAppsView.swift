import SwiftUI
import EventKit

/// docs/00-brand-design-master-prompt.md §27 / docs/08-mvp-definition.md
/// §3: Apple Health + Apple Calendar are the MVP's only two integrations.
/// Rows are now real (docs/09 Milestone 3), not hardcoded: tapping one
/// requests the real system permission, then syncs recent data through
/// `PlosAPI` — see each row's action and `HealthKitService`/
/// `EventKitService`'s headers for exactly what "Connected" can and
/// can't mean for each.
struct ConnectedAppsView: View {
    @EnvironmentObject private var session: AppSession
    @AppStorage("plos.healthKitRequested") private var healthKitRequested = false
    @State private var calendarStatus: EKAuthorizationStatus = EventKitService().authorizationStatus
    @State private var isSyncingHealth = false
    @State private var isSyncingCalendar = false
    @State private var syncMessage: String?
    @State private var syncMessageIsError = false

    private let healthKit = HealthKitService()
    private let eventKit = EventKitService()

    var body: some View {
        List {
            Section {
                connectionRow(
                    "Apple Health",
                    connected: healthKitRequested,
                    isBusy: isSyncingHealth,
                    action: { Task { await connectHealth() } }
                )
                connectionRow(
                    "Apple Calendar",
                    connected: calendarStatus == .fullAccess,
                    isBusy: isSyncingCalendar,
                    action: { Task { await connectCalendar() } }
                )
            } header: {
                Text("Connected")
            } footer: {
                // Deliberately honest, not just reassuring: HealthKit
                // never reports true grant/deny status for read access
                // (Apple's own privacy design) — see HealthKitService's
                // header. EventKit's status is exact.
                Text("Apple Health can only confirm plos asked for access, not whether you allowed it — that's Apple's own privacy design, not a bug here. Apple Calendar's status is exact.")
            }

            if let syncMessage {
                Section {
                    Text(syncMessage)
                        .font(.caption)
                        .foregroundStyle(syncMessageIsError ? PlosTheme.Semantic.critical : PlosTheme.Semantic.success)
                }
            }

            Section("Available") {
                connectionRow("Garmin", connected: false, isBusy: false, action: nil)
                connectionRow("Strava", connected: false, isBusy: false, action: nil)
                connectionRow("MyFitnessPal", connected: false, isBusy: false, action: nil)
            }
        }
        .listStyle(.plain)
        .background(PlosTheme.background)
    }

    private func connectionRow(_ name: String, connected: Bool, isBusy: Bool, action: (() -> Void)?) -> some View {
        Button {
            action?()
        } label: {
            HStack {
                Text(name).foregroundStyle(PlosTheme.ink)
                Spacer()
                if isBusy {
                    ProgressView()
                } else {
                    Text(connected ? "Connected" : "Available")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(connected ? PlosTheme.accent : PlosTheme.inkMuted)
                }
            }
        }
        .buttonStyle(.plain)
        .disabled(action == nil || isBusy)
    }

    private func connectHealth() async {
        guard let accessToken = session.currentAccessToken() else {
            syncMessage = "Session expired — please sign in again."
            syncMessageIsError = true
            return
        }
        isSyncingHealth = true
        syncMessage = nil
        do {
            try await healthKit.requestAuthorization()
            healthKitRequested = true
            async let sleep = healthKit.fetchRecentSleep()
            async let vitals = healthKit.fetchRecentRestingHeartRate()
            async let workouts = healthKit.fetchRecentWorkouts()
            let result = try await PlosAPI().syncHealth(
                accessToken: accessToken,
                sleep: sleep,
                vitals: vitals,
                workouts: workouts
            )
            syncMessage = "Synced \(result.inserted) new record(s) from Apple Health."
            syncMessageIsError = false
        } catch {
            syncMessage = "Couldn't sync Apple Health."
            syncMessageIsError = true
        }
        isSyncingHealth = false
    }

    private func connectCalendar() async {
        guard let accessToken = session.currentAccessToken() else {
            syncMessage = "Session expired — please sign in again."
            syncMessageIsError = true
            return
        }
        isSyncingCalendar = true
        syncMessage = nil
        do {
            _ = try await eventKit.requestAccess()
            calendarStatus = eventKit.authorizationStatus
            let events = eventKit.fetchUpcomingEvents()
            let result = try await PlosAPI().syncCalendar(accessToken: accessToken, events: events)
            syncMessage = "Synced \(result.inserted) new event(s) from Apple Calendar."
            syncMessageIsError = false
        } catch {
            syncMessage = "Couldn't sync Apple Calendar."
            syncMessageIsError = true
        }
        isSyncingCalendar = false
    }
}

#Preview {
    ConnectedAppsView().environmentObject(AppSession())
}
