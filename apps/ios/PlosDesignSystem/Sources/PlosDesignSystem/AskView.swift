import SwiftUI

/// MVP Ask plos — the Explain → Inspect interaction (brand doc §20, §22):
/// a concise answer up front, evidence available on demand, never raw
/// chain-of-thought. docs/09 Milestone 5: wired to a real
/// `POST /v1/agent/ask`, rendering the real `AgentOutput` shape — no more
/// hardcoded question/answer pair.
public struct AskView: View {
    @EnvironmentObject private var session: AppSession
    @Environment(\.dismiss) private var dismiss

    @State private var draftQuestion = ""
    @State private var askedQuestion: String?
    @State private var response: PlosAPI.AskResponse?
    @State private var isAsking = false
    @State private var errorMessage: String?
    @State private var showEvidence = false
    @State private var isActingOnConfirmation = false
    @State private var confirmationOutcome: String?

    public init() {}

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: PlosTheme.Spacing.md) {
                if let askedQuestion {
                    questionBubble(askedQuestion)
                }
                if isAsking {
                    ProgressView().padding(.vertical, 8)
                } else if let response {
                    answerSection(response)
                } else if let errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(PlosTheme.Semantic.critical)
                }
            }
            .padding(20)
            .padding(.bottom, 72)
        }
        .safeAreaInset(edge: .bottom) {
            askBar
                .padding(.horizontal, 20)
                .padding(.bottom, 8)
        }
        .background(PlosTheme.background)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Home") { dismiss() }
            }
        }
    }

    private var askBar: some View {
        HStack(spacing: 10) {
            TextField(
                askedQuestion == nil ? "Ask plos anything about your day" : "Ask a follow-up",
                text: $draftQuestion
            )
            .textFieldStyle(.plain)
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .modifier(GlassOrMaterial())
            .disabled(isAsking)
            .onSubmit { Task { await submit() } }

            Button {
                Task { await submit() }
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.title2)
                    .foregroundStyle(draftQuestion.trimmingCharacters(in: .whitespaces).isEmpty ? PlosTheme.inkMuted : PlosTheme.accent)
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(Rectangle())
            }
            .disabled(isAsking || draftQuestion.trimmingCharacters(in: .whitespaces).isEmpty)
            .accessibilityLabel("Send question")
        }
    }

    private func submit() async {
        let question = draftQuestion.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !question.isEmpty, let accessToken = session.currentAccessToken() else { return }

        askedQuestion = question
        draftQuestion = ""
        response = nil
        errorMessage = nil
        confirmationOutcome = nil
        isAsking = true
        do {
            response = try await PlosAPI().askAgent(accessToken: accessToken, question: question)
        } catch {
            errorMessage = "Couldn't reach plos right now. Please try again."
        }
        isAsking = false
    }

    private func questionBubble(_ text: String) -> some View {
        HStack {
            Spacer(minLength: 60)
            Text(text)
                .font(.subheadline)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(PlosTheme.surface, in: RoundedRectangle(cornerRadius: 16))
        }
        .frame(maxWidth: .infinity)
    }

    private func answerSection(_ response: PlosAPI.AskResponse) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(response.output.recommendation ?? response.output.finding)
                .font(.subheadline)
                .foregroundStyle(PlosTheme.ink)

            if !response.output.evidence.isEmpty {
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        showEvidence.toggle()
                    }
                } label: {
                    HStack(spacing: 6) {
                        Text(showEvidence ? "Hide the evidence" : "Why am I seeing this?")
                        Image(systemName: "chevron.down")
                            .rotationEffect(.degrees(showEvidence ? 180 : 0))
                    }
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(PlosTheme.accent)
                }
                .buttonStyle(.plain)
                .accessibilityHint(showEvidence ? "Collapses the evidence list" : "Expands the evidence behind this answer")

                if showEvidence {
                    evidenceCard(response)
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }
            }

            if let pending = response.pendingConfirmation {
                confirmationActions(pending)
            } else if let confirmationOutcome {
                Text(confirmationOutcome)
                    .font(.footnote)
                    .foregroundStyle(PlosTheme.inkMuted)
            }
        }
    }

    private func evidenceCard(_ response: PlosAPI.AskResponse) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("BASED ON")
                .font(.caption2.weight(.semibold))
                .tracking(0.6)
                .foregroundStyle(PlosTheme.inkMuted)
            ForEach(Array(response.output.evidence.enumerated()), id: \.offset) { _, item in
                evidenceRow(item.description)
            }
            if !response.output.uncertainty.isEmpty {
                Divider().padding(.vertical, 2)
                ForEach(Array(response.output.uncertainty.enumerated()), id: \.offset) { _, note in
                    Text(note)
                        .font(.caption)
                        .foregroundStyle(PlosTheme.inkMuted)
                }
            }
        }
        .padding(16)
        .background(PlosTheme.surface, in: RoundedRectangle(cornerRadius: 14))
    }

    private func evidenceRow(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text("•").foregroundStyle(PlosTheme.accent)
            Text(text).font(.footnote)
        }
    }

    /// docs/09 Milestone 5: a real Tier 2 confirm→execute round trip —
    /// tapping "confirm" requests a confirmation token, then immediately
    /// redeems it; declining makes no call at all (nothing was confirmed,
    /// so there is nothing to undo).
    private func confirmationActions(_ pending: PlosAPI.PendingConfirmation) -> some View {
        HStack(spacing: 10) {
            Button {
                Task { await actOnPendingConfirmation(pending) }
            } label: {
                if isActingOnConfirmation {
                    ProgressView()
                } else {
                    Text("Move today's workout")
                }
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 16)
            .padding(.vertical, 11)
            .frame(minHeight: 44)
            .foregroundStyle(PlosTheme.background)
            .background(PlosTheme.ink, in: RoundedRectangle(cornerRadius: 12))
            .disabled(isActingOnConfirmation)

            Button("Not today") {
                confirmationOutcome = "Kept as planned."
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 16)
            .padding(.vertical, 11)
            .frame(minHeight: 44)
            .foregroundStyle(PlosTheme.ink)
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(PlosTheme.inkMuted.opacity(0.3)))
            .disabled(isActingOnConfirmation)
        }
    }

    private func actOnPendingConfirmation(_ pending: PlosAPI.PendingConfirmation) async {
        guard let accessToken = session.currentAccessToken() else { return }
        isActingOnConfirmation = true
        do {
            let api = PlosAPI()
            let requested = try await api.requestCancelWorkout(accessToken: accessToken, sessionId: pending.sessionId)
            if let token = requested.confirmationToken {
                let confirmed = try await api.confirmCancelWorkout(
                    accessToken: accessToken, sessionId: pending.sessionId, confirmationToken: token)
                confirmationOutcome = confirmed.cancelled == true ? "Tonight's session is cancelled." : "Couldn't cancel that session."
            }
        } catch {
            confirmationOutcome = "Couldn't cancel that session. Please try again."
        }
        isActingOnConfirmation = false
    }
}

#Preview {
    AskView().environmentObject(AppSession())
}
