import SwiftUI

/// The "My Data & Privacy" center (product vision §23). docs/09 Milestone
/// 6: both rows are wired to the real backend now — consent toggles,
/// permission-grant listing/revoke, a real downloadable export bundle,
/// and the real account-deletion workflow (grace-period or immediate).
struct PrivacyDataView: View {
    @EnvironmentObject private var session: AppSession

    @State private var consents: [PlosAPI.ConsentStatus] = []
    @State private var grants: [PlosAPI.PermissionGrant] = []
    @State private var isLoading = true
    @State private var statusMessage: String?

    @State private var pendingTosRevoke = false
    @State private var showDeleteConfirm = false
    @State private var showExportMentalHealthPrompt = false
    @State private var isExporting = false
    @State private var isDeleting = false

    var body: some View {
        List {
            if let statusMessage {
                Section {
                    Text(statusMessage)
                        .font(.footnote)
                        .foregroundStyle(PlosTheme.inkMuted)
                }
            }

            Section("Consent") {
                ForEach(consents, id: \.consentType) { consent in
                    Toggle(label(for: consent.consentType), isOn: binding(for: consent))
                }
            }
            .disabled(isLoading)

            Section("Permissions granted to plos") {
                if grants.isEmpty && !isLoading {
                    Text("No active permissions.")
                        .font(.footnote)
                        .foregroundStyle(PlosTheme.inkMuted)
                }
                ForEach(grants, id: \.scope) { grant in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(grant.scope).font(.subheadline)
                        Text(grant.purpose).font(.caption).foregroundStyle(PlosTheme.inkMuted)
                    }
                    .swipeActions {
                        Button("Revoke", role: .destructive) {
                            Task { await revokeGrant(grant.scope) }
                        }
                    }
                }
            }

            Section("Your data") {
                Button {
                    Task { await requestExport(includeMentalHealth: false) }
                } label: {
                    HStack {
                        Text("Export my data")
                        if isExporting { Spacer(); ProgressView() }
                    }
                }
                .disabled(isExporting)

                Button("Export including mental health data") {
                    showExportMentalHealthPrompt = true
                }
                .disabled(isExporting)

                Text("Health data is used to understand sleep, recovery, and activity patterns.")
                    .font(.caption)
                    .foregroundStyle(PlosTheme.inkMuted)
            }

            Section("Account") {
                Button("Delete account", role: .destructive) {
                    showDeleteConfirm = true
                }
                .disabled(isDeleting)
            }
        }
        .listStyle(.plain)
        .background(PlosTheme.background)
        .task { await load() }
        .alert("Delete your account?", isPresented: $showDeleteConfirm) {
            Button("Delete after 14 days", role: .destructive) { Task { await deleteAccount(immediate: false) } }
            Button("Delete immediately", role: .destructive) { Task { await deleteAccount(immediate: true) } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("You can cancel within 14 days by signing back in, unless you choose to delete immediately.")
        }
        .alert("Include mental health data?", isPresented: $showExportMentalHealthPrompt) {
            Button("Include", role: .destructive) { Task { await requestExport(includeMentalHealth: true) } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Journal entries and related content require an extra confirmation step before they're included.")
        }
        .alert("Withdrawing consent to plos's terms will schedule your account for deletion.", isPresented: $pendingTosRevoke) {
            Button("Delete my account", role: .destructive) { Task { await revokeConsent("tos") } }
            Button("Cancel", role: .cancel) { Task { await load() } }
        }
    }

    private func label(for consentType: String) -> String {
        switch consentType {
        case "tos": return "Terms of service"
        case "health_data_processing": return "Health & fitness data processing"
        case "mental_health_data_processing": return "Mental health data processing"
        default: return consentType
        }
    }

    private func binding(for consent: PlosAPI.ConsentStatus) -> Binding<Bool> {
        Binding(
            get: { consent.granted },
            set: { newValue in
                guard !newValue else {
                    Task { await grantConsent(consent.consentType) }
                    return
                }
                if consent.consentType == "tos" {
                    pendingTosRevoke = true
                } else {
                    Task { await revokeConsent(consent.consentType) }
                }
            }
        )
    }

    private func load() async {
        guard let accessToken = session.currentAccessToken() else { return }
        isLoading = true
        do {
            async let consentsResult = PlosAPI().listConsents(accessToken: accessToken)
            async let grantsResult = PlosAPI().listGrants(accessToken: accessToken)
            consents = try await consentsResult
            grants = try await grantsResult
        } catch {
            statusMessage = "Couldn't load your privacy settings."
        }
        isLoading = false
    }

    private func grantConsent(_ consentType: String) async {
        guard let accessToken = session.currentAccessToken() else { return }
        do {
            try await PlosAPI().grantConsent(accessToken: accessToken, consentType: consentType)
        } catch {
            statusMessage = "Couldn't update that setting."
        }
        await load()
    }

    private func revokeConsent(_ consentType: String) async {
        guard let accessToken = session.currentAccessToken() else { return }
        do {
            let result = try await PlosAPI().revokeConsent(accessToken: accessToken, consentType: consentType)
            if result.triggeredDeletion {
                statusMessage = "Your account has been scheduled for deletion."
            }
        } catch {
            statusMessage = "Couldn't update that setting."
        }
        await load()
    }

    private func revokeGrant(_ scope: String) async {
        guard let accessToken = session.currentAccessToken() else { return }
        do {
            try await PlosAPI().revokeGrant(accessToken: accessToken, scope: scope)
        } catch {
            statusMessage = "Couldn't revoke that permission."
        }
        await load()
    }

    private func requestExport(includeMentalHealth: Bool) async {
        guard let accessToken = session.currentAccessToken() else { return }
        isExporting = true
        statusMessage = nil
        do {
            let api = PlosAPI()
            var result = try await api.requestExport(accessToken: accessToken, includeMentalHealth: includeMentalHealth)
            if result.status == "confirmation_required", let token = result.confirmationToken {
                result = try await api.requestExport(
                    accessToken: accessToken, includeMentalHealth: includeMentalHealth, confirmationToken: token)
            }
            if let path = result.downloadUrl, let url = URL(string: path, relativeTo: PlosAPI.baseURL) {
                openInBrowser(url.absoluteURL)
                statusMessage = "Your export is ready — opening it now."
            } else {
                statusMessage = "Couldn't prepare your export."
            }
        } catch {
            statusMessage = "Couldn't prepare your export."
        }
        isExporting = false
    }

    private func deleteAccount(immediate: Bool) async {
        guard let accessToken = session.currentAccessToken() else { return }
        isDeleting = true
        do {
            let result = try await PlosAPI().requestAccountDeletion(accessToken: accessToken, immediate: immediate)
            if result.status == "deleted" {
                await session.signOut()
                return
            }
            statusMessage = "Your account is scheduled for deletion in 14 days. Sign back in during that window to cancel."
        } catch {
            statusMessage = "Couldn't process the deletion request."
        }
        isDeleting = false
    }

    private func openInBrowser(_ url: URL) {
        #if os(iOS)
        UIApplication.shared.open(url)
        #elseif os(macOS)
        NSWorkspace.shared.open(url)
        #endif
    }
}

#Preview {
    NavigationStack { PrivacyDataView().environmentObject(AppSession()) }
}
