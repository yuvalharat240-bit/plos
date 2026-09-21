import Foundation

extension Data {
    /// Base64URL, unpadded — the encoding every field in `apps/api`'s
    /// WebAuthn DTOs expects (matches @simplewebauthn/server's own
    /// `isoBase64URL.fromBuffer`).
    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

extension String {
    func base64URLDecodedData() -> Data? {
        var base64 = replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while base64.count % 4 != 0 { base64 += "=" }
        return Data(base64Encoded: base64)
    }
}

/// Mirrors `apps/api`'s `PasskeyRegisterVerifyDto.response` shape
/// (RegistrationResponseJSON, @simplewebauthn/types) — built from
/// `ASAuthorizationPlatformPublicKeyCredentialRegistration`.
struct WebAuthnRegistrationResponse {
    let credentialId: Data
    let rawClientDataJSON: Data
    let rawAttestationObject: Data

    var jsonObject: [String: Any] {
        let id = credentialId.base64URLEncodedString()
        return [
            "id": id,
            "rawId": id,
            "type": "public-key",
            "clientExtensionResults": [String: Any](),
            "response": [
                "clientDataJSON": rawClientDataJSON.base64URLEncodedString(),
                "attestationObject": rawAttestationObject.base64URLEncodedString(),
            ],
        ]
    }
}

/// Mirrors `apps/api`'s `PasskeyLoginVerifyDto.response` shape
/// (AuthenticationResponseJSON) — built from
/// `ASAuthorizationPlatformPublicKeyCredentialAssertion`.
struct WebAuthnAuthenticationResponse {
    let credentialId: Data
    let rawClientDataJSON: Data
    let rawAuthenticatorData: Data
    let signature: Data
    let userHandle: Data?

    var jsonObject: [String: Any] {
        let id = credentialId.base64URLEncodedString()
        var response: [String: Any] = [
            "clientDataJSON": rawClientDataJSON.base64URLEncodedString(),
            "authenticatorData": rawAuthenticatorData.base64URLEncodedString(),
            "signature": signature.base64URLEncodedString(),
        ]
        if let userHandle {
            response["userHandle"] = userHandle.base64URLEncodedString()
        }
        return [
            "id": id,
            "rawId": id,
            "type": "public-key",
            "clientExtensionResults": [String: Any](),
            "response": response,
        ]
    }
}
