import Foundation

enum AuthStage: Equatable {
    /// App launch, checking Keychain for a refresh token — RootView shows
    /// a blank/splash state rather than flashing LoginView first.
    case restoring
    case loggedOut
    /// An Apple/passkey round trip is in flight.
    case authenticating
    case signingUp
    case loggedIn
    case failed(String)
}

/// ponytail: plain ObservableObject, not the newer @Observable macro —
/// this class predates real Xcode being available in this environment
/// (see docs/10-progress-checklist.md's Milestone 0 entry); @Observable
/// would work fine now, but there's no reason to touch this file's
/// pattern for its own sake once auth wiring already needs to.
@MainActor
final class AppSession: ObservableObject {
    @Published var stage: AuthStage = .restoring
    @Published var displayName: String = ""

    private var accessToken: String?

    private let api: PlosAPI
    private let keychain: KeychainStore

    init(api: PlosAPI = PlosAPI(), keychain: KeychainStore = KeychainStore()) {
        self.api = api
        self.keychain = keychain
    }

    /// Call once, on `RootView`'s first appearance.
    func restoreSession() async {
        guard let refreshToken = keychain.refreshToken else {
            stage = .loggedOut
            return
        }
        do {
            let tokens = try await api.refresh(refreshToken: refreshToken)
            apply(tokens)
            stage = .loggedIn
        } catch {
            keychain.clear()
            stage = .loggedOut
        }
    }

    func signInWithApple(identityToken: String) async {
        stage = .authenticating
        do {
            let tokens = try await api.signInWithApple(identityToken: identityToken)
            apply(tokens)
            stage = (tokens.isNew ?? false) ? .signingUp : .loggedIn
        } catch {
            stage = .failed("Couldn't sign in with Apple. Please try again.")
        }
    }

    func signInWithPasskey() async {
        stage = .authenticating
        do {
            let (attemptId, options) = try await api.passkeyLoginOptions()
            let runner = PasskeyCeremonyRunner()
            let assertion = try await runner.authenticate(
                rpID: options.rpId ?? "localhost",
                challenge: options.challenge
            )
            let tokens = try await api.passkeyLoginVerify(attemptId: attemptId, assertion: assertion)
            apply(tokens)
            stage = (tokens.isNew ?? false) ? .signingUp : .loggedIn
        } catch {
            stage = .failed("Couldn't sign in with your passkey. Please try again.")
        }
    }

    func completeSignUp(name: String, goal: String) async {
        guard let accessToken else {
            stage = .failed("Session expired — please sign in again.")
            return
        }
        stage = .authenticating
        do {
            try await api.updateProfile(accessToken: accessToken, displayName: name, primaryGoal: goal)
            displayName = name.isEmpty ? "there" : name
            stage = .loggedIn
        } catch {
            stage = .failed("Couldn't save your profile. Please try again.")
        }
    }

    func signOut() async {
        if let accessToken {
            _ = try? await api.logout(accessToken: accessToken)
        }
        keychain.clear()
        accessToken = nil
        displayName = ""
        stage = .loggedOut
    }

    /// After a `.failed` stage, return to a clean sign-in screen.
    func acknowledgeFailure() {
        stage = .loggedOut
    }

    /// The bearer token CRUD screens (Journal/Workouts/Meds) need for
    /// authenticated requests. `nil` should never actually happen while
    /// `stage == .loggedIn`, but callers still handle it rather than
    /// force-unwrapping across a network boundary.
    func currentAccessToken() -> String? {
        accessToken
    }

    private func apply(_ tokens: PlosAPI.TokenResponse) {
        accessToken = tokens.accessToken
        keychain.refreshToken = tokens.refreshToken
    }
}
