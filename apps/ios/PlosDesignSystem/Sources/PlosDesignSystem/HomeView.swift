import SwiftUI

/// MVP Home — product vision §30, brand doc §23: Today state, one
/// Insight, Ask plos. No dashboard, no scrolling list of metrics.
///
/// docs/09 Milestone 5: the Insight card is now backed by a real
/// `POST /v1/agent/ask` call (docs/03 §4's own worked example question),
/// not a hardcoded string, and its actions run the real Tier 2
/// confirm→execute flow — see AskView's identical wiring for the fuller
/// evidence/why-panel version of the same response shape. There is no
/// dedicated "today's proactive insight" endpoint at any Phase 1
/// milestone (only the interactive ask endpoint exists), so this reuses
/// it with a fixed question on every Home appearance. That is a real,
/// flagged MVP simplification — a genuine proactive-insight feature would
/// be worker-generated or otherwise not re-run a live (paid) model call
/// each time Home loads — not a hidden shortcut.
public struct HomeView: View {
    @EnvironmentObject private var session: AppSession
    @State private var showAsk = false
    @State private var showJournal = false

    @State private var insight: PlosAPI.AskResponse?
    @State private var isLoadingInsight = false
    @State private var insightError: String?
    @State private var isActingOnInsight = false
    @State private var insightOutcome: String?

    public init() {}

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: PlosTheme.Spacing.lg) {
                header
                TodayStateGrid(
                    sleepDuration: "6h 42m",
                    sleepDelta: "38 min below your baseline",
                    sleepBaselineFraction: 0.74,
                    recoveryLabel: "Lower",
                    recoveryDetail: "than usual"
                )
                insightSection
            }
            .padding(20)
            .padding(.bottom, 72)
        }
        .safeAreaInset(edge: .bottom) {
            GlassAskBar(placeholder: "Ask plos anything about your day") {
                showAsk = true
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 8)
        }
        .background(PlosTheme.background)
        .sheet(isPresented: $showAsk) {
            AskView()
        }
        .sheet(isPresented: $showJournal) {
            JournalView()
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showJournal = true
                } label: {
                    Image(systemName: "square.and.pencil")
                }
                .accessibilityLabel("New journal entry")
            }
        }
        .task { await loadInsight() }
    }

    private var header: some View {
        HStack(spacing: 10) {
            PlusMark(size: 20)
            Text("Good morning")
                .font(.title2.weight(.semibold))
                .foregroundStyle(PlosTheme.ink)
        }
    }

    @ViewBuilder
    private var insightSection: some View {
        if let insight {
            InsightCard(
                headline: insight.output.finding,
                detail: insightOutcome ?? insight.output.recommendation ?? "",
                primaryActionTitle: isActingOnInsight ? "Working…" : (insight.pendingConfirmation != nil ? "Move today's workout" : "Got it"),
                primaryAction: { Task { await actOnInsight() } },
                secondaryActionTitle: "Not today",
                secondaryAction: { insightOutcome = "Kept as planned." }
            )
            .disabled(isActingOnInsight)
        } else if isLoadingInsight {
            ProgressView()
                .frame(maxWidth: .infinity)
                .padding(.vertical, 24)
        } else if let insightError {
            Text(insightError)
                .font(.footnote)
                .foregroundStyle(PlosTheme.inkMuted)
        }
    }

    private func loadInsight() async {
        guard let accessToken = session.currentAccessToken() else { return }
        isLoadingInsight = true
        insightError = nil
        do {
            insight = try await PlosAPI().askAgent(accessToken: accessToken, question: "Should I train tonight?")
        } catch {
            insightError = "Today's insight isn't available right now."
        }
        isLoadingInsight = false
    }

    private func actOnInsight() async {
        guard let pending = insight?.pendingConfirmation, let accessToken = session.currentAccessToken() else { return }
        isActingOnInsight = true
        do {
            let api = PlosAPI()
            let requested = try await api.requestCancelWorkout(accessToken: accessToken, sessionId: pending.sessionId)
            if let token = requested.confirmationToken {
                let confirmed = try await api.confirmCancelWorkout(
                    accessToken: accessToken, sessionId: pending.sessionId, confirmationToken: token)
                insightOutcome = confirmed.cancelled == true ? "Tonight's session is cancelled." : "Couldn't cancel that session."
            }
        } catch {
            insightOutcome = "Couldn't cancel that session. Please try again."
        }
        isActingOnInsight = false
    }
}

#Preview {
    HomeView().environmentObject(AppSession())
}
