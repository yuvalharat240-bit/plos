import SwiftUI

struct MeView: View {
    @EnvironmentObject private var session: AppSession

    var body: some View {
        List {
            Section {
                HStack(spacing: 14) {
                    ZStack {
                        Circle().fill(PlosTheme.surface)
                        Text(initials)
                            .font(.headline)
                            .foregroundStyle(PlosTheme.ink)
                    }
                    .frame(width: 52, height: 52)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(session.displayName.isEmpty ? "You" : session.displayName)
                            .font(.headline)
                            .foregroundStyle(PlosTheme.ink)
                        Text("Member since today")
                            .font(.caption)
                            .foregroundStyle(PlosTheme.inkMuted)
                    }
                }
                .padding(.vertical, 6)
            }

            Section("Health") {
                NavigationLink("Medications") { MedsView() }
                NavigationLink("Connected apps") { ConnectedAppsView() }
            }

            Section("Account") {
                NavigationLink("Settings") { SettingsView() }
                NavigationLink("Privacy & data") { PrivacyDataView() }
            }

            Section {
                Button(role: .destructive) {
                    Task { await session.signOut() }
                } label: {
                    Text("Sign out")
                }
            }
        }
        .listStyle(.plain)
        .background(PlosTheme.background)
    }

    private var initials: String {
        guard let first = session.displayName.first else { return "•" }
        return String(first).uppercased()
    }
}

#Preview {
    NavigationStack { MeView().environmentObject(AppSession()) }
}
