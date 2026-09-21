import AuthenticationServices
#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

/// Bridges `ASAuthorizationController`'s delegate callbacks to async/await.
///
/// Not yet exercisable end-to-end in this environment: passkeys need an
/// Associated Domains entitlement (`webcredentials:<rpID>`) backed by a
/// real HTTPS-hosted `apple-app-site-association` file, which requires
/// both a real Apple Developer team and a real deployed domain — neither
/// exists yet (same category of open item as Sign in with Apple's own
/// "needs a real Apple Developer team" blocker in CLAUDE.md). The code
/// here is real, not a stub, and matches `apps/api`'s passkey endpoints
/// exactly (verified against them in `test/auth-and-crud.e2e-spec.ts`
/// on the backend side) — it just cannot be run to completion on a
/// device/simulator until that infrastructure exists.
@MainActor
final class PasskeyCeremonyRunner: NSObject, ASAuthorizationControllerDelegate,
    ASAuthorizationControllerPresentationContextProviding
{
    private var continuation: CheckedContinuation<ASAuthorization, Error>?

    func perform(_ request: ASAuthorizationRequest) async throws -> ASAuthorization {
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }

    func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        continuation?.resume(returning: authorization)
        continuation = nil
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        continuation?.resume(throwing: error)
        continuation = nil
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        #if os(iOS)
        return UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow }
            .first ?? ASPresentationAnchor()
        #elseif os(macOS)
        return NSApplication.shared.windows.first ?? ASPresentationAnchor()
        #endif
    }

    func register(
        rpID: String,
        challenge: String,
        userID: Data,
        userName: String
    ) async throws -> WebAuthnRegistrationResponse {
        guard let challengeData = challenge.base64URLDecodedData() else {
            throw URLError(.badServerResponse)
        }
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpID)
        let request = provider.createCredentialRegistrationRequest(
            challenge: challengeData,
            name: userName,
            userID: userID
        )
        let authorization = try await perform(request)
        guard
            let credential = authorization.credential
                as? ASAuthorizationPlatformPublicKeyCredentialRegistration,
            let attestationObject = credential.rawAttestationObject
        else {
            throw URLError(.badServerResponse)
        }
        return WebAuthnRegistrationResponse(
            credentialId: credential.credentialID,
            rawClientDataJSON: credential.rawClientDataJSON,
            rawAttestationObject: attestationObject
        )
    }

    func authenticate(rpID: String, challenge: String) async throws -> WebAuthnAuthenticationResponse {
        guard let challengeData = challenge.base64URLDecodedData() else {
            throw URLError(.badServerResponse)
        }
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpID)
        let request = provider.createCredentialAssertionRequest(challenge: challengeData)
        let authorization = try await perform(request)
        guard
            let assertion = authorization.credential
                as? ASAuthorizationPlatformPublicKeyCredentialAssertion
        else {
            throw URLError(.badServerResponse)
        }
        return WebAuthnAuthenticationResponse(
            credentialId: assertion.credentialID,
            rawClientDataJSON: assertion.rawClientDataJSON,
            rawAuthenticatorData: assertion.rawAuthenticatorData,
            signature: assertion.signature,
            userHandle: assertion.userID
        )
    }
}
