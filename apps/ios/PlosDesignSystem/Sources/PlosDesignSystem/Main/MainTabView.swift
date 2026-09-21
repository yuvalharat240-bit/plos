import SwiftUI

/// Five tabs cover the requested screen set without inventing new
/// domains beyond what docs/08-mvp-definition.md scopes: Today (Home),
/// Calendar (also carries "next up" and day-before/after browsing),
/// Workouts (Fitness), History (past Insights), Me (profile/settings/
/// meds/connections). No cross-platform-unsafe modifiers here — this
/// target also compiles on macOS for local verification (see
/// PlosPreviewApp); keep it that way rather than reaching for
/// iOS-only APIs for a cosmetic gain.
struct MainTabView: View {
    var body: some View {
        TabView {
            NavigationStack {
                HomeView()
                    .navigationTitle("Today")
            }
            .tabItem { Label("Today", systemImage: "sun.max") }

            NavigationStack {
                CalendarView()
                    .navigationTitle("Calendar")
            }
            .tabItem { Label("Calendar", systemImage: "calendar") }

            NavigationStack {
                WorkoutsView()
                    .navigationTitle("Workouts")
            }
            .tabItem { Label("Workouts", systemImage: "figure.run") }

            NavigationStack {
                HistoryView()
                    .navigationTitle("History")
            }
            .tabItem { Label("History", systemImage: "clock.arrow.circlepath") }

            NavigationStack {
                MeView()
                    .navigationTitle("Me")
            }
            .tabItem { Label("Me", systemImage: "person.circle") }
        }
        .tint(PlosTheme.accent)
    }
}

#Preview {
    MainTabView().environmentObject(AppSession())
}
