import Foundation

/// Thin URLSession client for `apps/api` (docs/09 Milestone 2). No third-
/// party networking dependency — Foundation's URLSession already covers
/// everything a handful of JSON endpoints need.
struct PlosAPI {
    /// ponytail: a mutable static, not a config file/plist — there is
    /// exactly one deployment target right now (local dev). Point this
    /// at a real host once Milestone 8 stands one up.
    static var baseURL = URL(string: "http://localhost:3000")!

    private let session: URLSession
    init(session: URLSession = .shared) {
        self.session = session
    }

    struct APIError: Error, LocalizedError {
        let status: Int
        var errorDescription: String? { "Request failed with status \(status)" }
    }

    // MARK: - Auth

    struct TokenResponse: Decodable {
        let accessToken: String
        let refreshToken: String
        let userId: String
        let isNew: Bool?
    }

    func signInWithApple(identityToken: String) async throws -> TokenResponse {
        try await post("/v1/auth/apple", body: ["identityToken": identityToken])
    }

    func refresh(refreshToken: String) async throws -> TokenResponse {
        try await post("/v1/auth/refresh", body: ["refreshToken": refreshToken])
    }

    func logout(accessToken: String) async throws {
        let _: SuccessLikeResponse = try await post("/v1/auth/logout", body: [:], accessToken: accessToken)
    }

    // MARK: - Passkeys

    struct PasskeyRegistrationOptions: Decodable {
        struct RP: Decodable { let id: String }
        struct User: Decodable { let id: String; let name: String }
        let rp: RP
        let user: User
        let challenge: String
    }

    struct PasskeyAuthenticationOptions: Decodable {
        let rpId: String?
        let challenge: String
    }

    private struct AttemptEnvelope<T: Decodable>: Decodable {
        let attemptId: String
        let options: T
    }

    func passkeyRegisterOptions(accessToken: String) async throws -> (attemptId: String, options: PasskeyRegistrationOptions) {
        let envelope: AttemptEnvelope<PasskeyRegistrationOptions> =
            try await post("/v1/auth/passkey/register/options", body: [:], accessToken: accessToken)
        return (envelope.attemptId, envelope.options)
    }

    func passkeyRegisterVerify(
        accessToken: String,
        attemptId: String,
        credential: WebAuthnRegistrationResponse,
        deviceName: String?
    ) async throws {
        var body: [String: Any] = ["attemptId": attemptId, "response": credential.jsonObject]
        if let deviceName { body["deviceName"] = deviceName }
        let _: SuccessLikeResponse = try await post(
            "/v1/auth/passkey/register/verify", body: body, accessToken: accessToken)
    }

    func passkeyLoginOptions() async throws -> (attemptId: String, options: PasskeyAuthenticationOptions) {
        let envelope: AttemptEnvelope<PasskeyAuthenticationOptions> =
            try await post("/v1/auth/passkey/login/options", body: [:])
        return (envelope.attemptId, envelope.options)
    }

    func passkeyLoginVerify(attemptId: String, assertion: WebAuthnAuthenticationResponse) async throws -> TokenResponse {
        try await post(
            "/v1/auth/passkey/login/verify",
            body: ["attemptId": attemptId, "response": assertion.jsonObject])
    }

    // MARK: - Profile

    func updateProfile(accessToken: String, displayName: String?, primaryGoal: String?) async throws {
        var body: [String: Any] = [:]
        if let displayName { body["displayName"] = displayName }
        if let primaryGoal { body["primaryGoal"] = primaryGoal }
        let _: IDResponse = try await patch("/v1/users/me", body: body, accessToken: accessToken)
    }

    // MARK: - CRUD

    struct IDResponse: Decodable { let id: String }

    func createJournalEntry(
        accessToken: String,
        entryKind: String,
        entryText: String?,
        moodScore: Double?,
        stressScore: Double?,
        energyScore: Double?,
        tags: [String]
    ) async throws -> IDResponse {
        var body: [String: Any] = ["entryKind": entryKind, "tags": tags]
        if let entryText { body["entryText"] = entryText }
        if let moodScore { body["moodScore"] = moodScore }
        if let stressScore { body["stressScore"] = stressScore }
        if let energyScore { body["energyScore"] = energyScore }
        return try await post("/v1/journal", body: body, accessToken: accessToken)
    }

    func createWorkout(
        accessToken: String,
        sportType: String,
        startsAt: Date,
        durationMin: Int?
    ) async throws -> IDResponse {
        var body: [String: Any] = [
            "sportType": sportType,
            "startsAt": ISO8601DateFormatter().string(from: startsAt),
        ]
        if let durationMin { body["durationMin"] = durationMin }
        return try await post("/v1/workouts", body: body, accessToken: accessToken)
    }

    func createMedicationLog(
        accessToken: String,
        medicationName: String,
        dose: String?,
        unit: String?,
        takenAt: Date
    ) async throws -> IDResponse {
        var body: [String: Any] = [
            "medicationName": medicationName,
            "takenAt": ISO8601DateFormatter().string(from: takenAt),
        ]
        if let dose { body["dose"] = dose }
        if let unit { body["unit"] = unit }
        return try await post("/v1/medications", body: body, accessToken: accessToken)
    }

    // MARK: - Device sync (docs/09 Milestone 3)

    struct SyncResult: Decodable { let inserted: Int; let skipped: Int }

    func syncHealth(
        accessToken: String,
        sleep: [HealthSleepSample],
        vitals: [HealthVitalSample],
        workouts: [HealthWorkoutSample]
    ) async throws -> SyncResult {
        let iso = ISO8601DateFormatter()
        var body: [String: Any] = [:]
        if !sleep.isEmpty {
            body["sleepSamples"] = sleep.map {
                [
                    "sourceId": $0.sourceId,
                    "sleepStart": iso.string(from: $0.start),
                    "sleepEnd": iso.string(from: $0.end),
                    "durationMin": $0.durationMin,
                ] as [String: Any]
            }
        }
        if !vitals.isEmpty {
            body["vitalSamples"] = vitals.map {
                [
                    "sourceId": $0.sourceId,
                    "vitalType": $0.vitalType,
                    "valueNumeric": $0.value,
                    "unit": $0.unit,
                    "observedAt": iso.string(from: $0.observedAt),
                ] as [String: Any]
            }
        }
        if !workouts.isEmpty {
            body["workouts"] = workouts.map { w -> [String: Any] in
                var sample: [String: Any] = [
                    "sourceId": w.sourceId,
                    "sportType": w.sportType,
                    "startsAt": iso.string(from: w.start),
                ]
                if let end = w.end { sample["endsAt"] = iso.string(from: end) }
                if let durationMin = w.durationMin { sample["durationMin"] = durationMin }
                if let calories = w.calories { sample["calories"] = calories }
                return sample
            }
        }
        return try await post("/v1/sync/health", body: body, accessToken: accessToken)
    }

    func syncCalendar(accessToken: String, events: [CalendarEventSample]) async throws -> SyncResult {
        let iso = ISO8601DateFormatter()
        let payload: [String: Any] = [
            "events": events.map { e -> [String: Any] in
                var sample: [String: Any] = [
                    "sourceId": e.sourceId,
                    "startsAt": iso.string(from: e.start),
                ]
                if let end = e.end { sample["endsAt"] = iso.string(from: end) }
                if let attendeeCount = e.attendeeCount { sample["attendeeCount"] = attendeeCount }
                return sample
            }
        ]
        return try await post("/v1/sync/calendar", body: payload, accessToken: accessToken)
    }

    // MARK: - Agent (docs/09 Milestone 5)

    struct AgentEvidence: Decodable {
        let description: String
    }

    struct AgentOutputResponse: Decodable {
        let finding: String
        let evidence: [AgentEvidence]
        let uncertainty: [String]
        let recommendation: String?
    }

    struct PendingConfirmation: Decodable {
        let tool: String
        let sessionId: String
    }

    struct AskResponse: Decodable {
        let output: AgentOutputResponse
        let pendingConfirmation: PendingConfirmation?
    }

    func askAgent(accessToken: String, question: String) async throws -> AskResponse {
        try await post("/v1/agent/ask", body: ["question": question], accessToken: accessToken)
    }

    struct CancelWorkoutStatus: Decodable {
        let status: String
        let confirmationToken: String?
        let cancelled: Bool?
    }

    func requestCancelWorkout(accessToken: String, sessionId: String) async throws -> CancelWorkoutStatus {
        try await post("/v1/agent/actions/cancel-workout", body: ["sessionId": sessionId], accessToken: accessToken)
    }

    func confirmCancelWorkout(accessToken: String, sessionId: String, confirmationToken: String) async throws -> CancelWorkoutStatus {
        try await post(
            "/v1/agent/actions/cancel-workout/confirm",
            body: ["sessionId": sessionId, "confirmationToken": confirmationToken],
            accessToken: accessToken)
    }

    // MARK: - Privacy & data control (docs/09 Milestone 6)

    struct ConsentStatus: Decodable {
        let consentType: String
        let granted: Bool
    }

    func listConsents(accessToken: String) async throws -> [ConsentStatus] {
        try await get("/v1/privacy/consents", accessToken: accessToken)
    }

    struct ConsentRevokeResult: Decodable {
        let triggeredDeletion: Bool
    }

    func grantConsent(accessToken: String, consentType: String) async throws {
        let _: SuccessLikeResponse = try await post(
            "/v1/privacy/consents/grant", body: ["consentType": consentType], accessToken: accessToken)
    }

    func revokeConsent(accessToken: String, consentType: String) async throws -> ConsentRevokeResult {
        try await post("/v1/privacy/consents/revoke", body: ["consentType": consentType], accessToken: accessToken)
    }

    struct PermissionGrant: Decodable {
        let scope: String
        let purpose: String
    }

    func listGrants(accessToken: String) async throws -> [PermissionGrant] {
        try await get("/v1/privacy/grants", accessToken: accessToken)
    }

    func revokeGrant(accessToken: String, scope: String) async throws {
        let _: SuccessLikeResponse = try await post("/v1/privacy/grants/revoke", body: ["scope": scope], accessToken: accessToken)
    }

    struct ExportResult: Decodable {
        let status: String?
        let confirmationToken: String?
        let downloadUrl: String?
    }

    func requestExport(accessToken: String, includeMentalHealth: Bool, confirmationToken: String? = nil) async throws -> ExportResult {
        var body: [String: Any] = ["includeMentalHealth": includeMentalHealth]
        if let confirmationToken { body["confirmationToken"] = confirmationToken }
        return try await post("/v1/privacy/export", body: body, accessToken: accessToken)
    }

    struct DeletionResult: Decodable {
        let status: String
    }

    func requestAccountDeletion(accessToken: String, immediate: Bool) async throws -> DeletionResult {
        try await post("/v1/privacy/account/delete", body: ["immediate": immediate], accessToken: accessToken)
    }

    /// A tolerant decode target for endpoints whose exact success shape
    /// callers here don't need to inspect (`{granted: true}`,
    /// `{revoked: true}`, `{cancelled: true}`, ...).
    private struct SuccessLikeResponse: Decodable {}

    // MARK: - Transport

    private func post<T: Decodable>(_ path: String, body: [String: Any], accessToken: String? = nil) async throws -> T {
        try await send(path: path, method: "POST", body: body, accessToken: accessToken)
    }

    private func patch<T: Decodable>(_ path: String, body: [String: Any], accessToken: String? = nil) async throws -> T {
        try await send(path: path, method: "PATCH", body: body, accessToken: accessToken)
    }

    private func get<T: Decodable>(_ path: String, accessToken: String) async throws -> T {
        try await send(path: path, method: "GET", body: nil, accessToken: accessToken)
    }

    private func send<T: Decodable>(path: String, method: String, body: [String: Any]?, accessToken: String?) async throws -> T {
        var request = URLRequest(url: Self.baseURL.appendingPathComponent(path))
        request.httpMethod = method
        if let accessToken {
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            // Every caller only inserts keys it actually has a value for
            // (see each method above) — no Optional ever reaches this
            // point, which matters because JSONSerialization crashes on a
            // boxed Optional hiding inside an `Any` rather than reporting
            // an error.
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIError(status: -1)
        }
        guard (200...299).contains(http.statusCode) else {
            throw APIError(status: http.statusCode)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}
