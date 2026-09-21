import Foundation
import Security

/// Persists only the refresh token — the access token is short-lived
/// (15 min, ADR D7) and kept in memory only, never written to disk.
/// ponytail: a single fixed key, not a generic key-value Keychain
/// wrapper — this app has exactly one secret worth persisting right now.
struct KeychainStore {
    private let service = "com.plos.app.refreshToken"

    var refreshToken: String? {
        get {
            var query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecReturnData as String: true,
                kSecMatchLimit as String: kSecMatchLimitOne,
            ]
            var result: AnyObject?
            let status = SecItemCopyMatching(query as CFDictionary, &result)
            query.removeValue(forKey: kSecReturnData as String)
            guard status == errSecSuccess, let data = result as? Data else { return nil }
            return String(data: data, encoding: .utf8)
        }
        nonmutating set {
            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
            ]
            SecItemDelete(query as CFDictionary)
            guard let newValue, let data = newValue.data(using: .utf8) else { return }
            let addQuery: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecValueData as String: data,
                kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
            ]
            SecItemAdd(addQuery as CFDictionary, nil)
        }
    }

    func clear() {
        refreshToken = nil
    }
}
