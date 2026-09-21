import SwiftUI
#if os(iOS)
import UIKit
#else
import Foundation
#endif

struct SettingsView: View {
    @EnvironmentObject private var session: AppSession
    @AppStorage("plos.notificationsEnabled") private var notificationsEnabled = true
    @AppStorage("plos.useMetricUnits") private var useMetric = false

    @State private var isRegisteringPasskey = false
    @State private var passkeyMessage: String?
    @State private var passkeyMessageIsError = false

    var body: some View {
        List {
            Section("Notifications") {
                Toggle("Allow notifications", isOn: $notificationsEnabled)
                Text("Tiered per docs/03-system-architecture.md §7 — full Critical/Important/Useful/Optional/Silent tiering isn't built yet, this is a single on/off switch.")
                    .font(.caption)
                    .foregroundStyle(PlosTheme.inkMuted)
            }
            Section("Units") {
                Toggle("Use metric units", isOn: $useMetric)
            }
            Section {
                Button {
                    Task { await registerPasskey() }
                } label: {
                    HStack {
                        Text("Add a Passkey")
                        Spacer()
                        if isRegisteringPasskey {
                            ProgressView()
                        }
                    }
                }
                .disabled(isRegisteringPasskey)

                if let passkeyMessage {
                    Text(passkeyMessage)
                        .font(.caption)
                        .foregroundStyle(passkeyMessageIsError ? PlosTheme.Semantic.critical : PlosTheme.Semantic.success)
                }
            } header: {
                Text("Security")
            } footer: {
                // docs/09 Milestone 2: registration itself is real (same
                // backend endpoints and ceremony code the login path
                // uses), but a genuine on-device passkey needs an
                // Associated Domains entitlement backed by a real hosted
                // domain — not configured yet, same category of gap as
                // Sign in with Apple's "needs a real Developer team."
                // Attempting it is honest: it either works once that
                // infrastructure exists, or fails with a real system
                // error here, not a silent no-op.
                Text("Lets you sign in with Face ID or Touch ID instead of Sign in with Apple, next time.")
            }
        }
        .listStyle(.plain)
        .background(PlosTheme.background)
    }

    private func registerPasskey() async {
        guard let accessToken = session.currentAccessToken() else {
            passkeyMessage = "Session expired — please sign in again."
            passkeyMessageIsError = true
            return
        }
        isRegisteringPasskey = true
        passkeyMessage = nil
        do {
            let api = PlosAPI()
            let (attemptId, options) = try await api.passkeyRegisterOptions(accessToken: accessToken)
            guard let userIDData = options.user.id.base64URLDecodedData() else {
                throw URLError(.badServerResponse)
            }
            let runner = PasskeyCeremonyRunner()
            let credential = try await runner.register(
                rpID: options.rp.id,
                challenge: options.challenge,
                userID: userIDData,
                userName: options.user.name
            )
            try await api.passkeyRegisterVerify(
                accessToken: accessToken,
                attemptId: attemptId,
                credential: credential,
                deviceName: deviceLabel
            )
            passkeyMessage = "Passkey added."
            passkeyMessageIsError = false
        } catch {
            passkeyMessage = "Couldn't add a passkey on this device."
            passkeyMessageIsError = true
        }
        isRegisteringPasskey = false
    }

    private var deviceLabel: String {
        #if os(iOS)
        UIDevice.current.name
        #else
        Host.current().localizedName ?? "This Mac"
        #endif
    }
}

#Preview {
    SettingsView().environmentObject(AppSession())
}
