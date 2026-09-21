import SwiftUI
import AuthenticationServices

/// ADR D7: Sign in with Apple + Passkeys, no invented auth scheme. Both
/// paths now call the real `apps/api` endpoints (docs/09 Milestone 2) —
/// see `AppSession.signInWithApple`/`signInWithPasskey`. Passkey login
/// cannot complete end-to-end yet (needs an Associated Domains
/// entitlement — see `PasskeyCeremony.swift`'s header); the button still
/// triggers the real flow so the failure mode is a clean, understood
/// error rather than a silent no-op.
struct LoginView: View {
    @EnvironmentObject private var session: AppSession

    var body: some View {
        VStack(spacing: PlosTheme.Spacing.lg) {
            Spacer()
            PlusMark(size: 56)
            Text("plos")
                .font(.largeTitle.weight(.semibold))
                .foregroundStyle(PlosTheme.ink)
            Text("Personal Life Operating System")
                .font(.subheadline)
                .foregroundStyle(PlosTheme.inkMuted)

            Spacer()

            if case .failed(let message) = session.stage {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(PlosTheme.Semantic.critical)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }

            VStack(spacing: 12) {
                SignInWithAppleButton(.signIn) { request in
                    // Non-negotiable (CLAUDE.md): no permission requested
                    // without a feature that needs it right now. `.fullName`
                    // is deliberately not requested — SignUpView already
                    // collects the display name itself, and nothing here
                    // reads Apple's copy of it. Only `.email` backs a real
                    // use: the backend upserts it onto `users.email` (which
                    // has to come from somewhere, since Sign in with Apple
                    // supplies no separate profile-fetch step).
                    request.requestedScopes = [.email]
                } onCompletion: { result in
                    handleAppleCompletion(result)
                }
                .signInWithAppleButtonStyle(.black)
                .frame(height: 50)
                .clipShape(RoundedRectangle(cornerRadius: PlosTheme.Radius.control))
                .disabled(session.stage == .authenticating)

                Button {
                    Task { await session.signInWithPasskey() }
                } label: {
                    Text("Use a Passkey instead")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(PlosTheme.accent)
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.plain)
                .disabled(session.stage == .authenticating)

                if session.stage == .authenticating {
                    ProgressView()
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(PlosTheme.background)
    }

    private func handleAppleCompletion(_ result: Result<ASAuthorization, Error>) {
        switch result {
        case .failure:
            session.acknowledgeFailure()
        case .success(let authorization):
            guard
                let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                let tokenData = credential.identityToken,
                let identityToken = String(data: tokenData, encoding: .utf8)
            else {
                session.acknowledgeFailure()
                return
            }
            Task { await session.signInWithApple(identityToken: identityToken) }
        }
    }
}

#Preview {
    LoginView().environmentObject(AppSession())
}
