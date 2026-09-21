import SwiftUI

/// The Insight component — brand doc §21: What / Why / What-it-may-mean
/// folded into `headline` + `detail` (kept as two fields, not four, since
/// splitting them further bought no clarity for a single-paragraph
/// insight) / What-you-can-do as the two actions. Content-layer surface —
/// deliberately not glass (see `GlassAskBar`'s doc comment).
public struct InsightCard: View {
    public var headline: String
    public var detail: String
    public var primaryActionTitle: String
    public var primaryAction: () -> Void
    public var secondaryActionTitle: String
    public var secondaryAction: () -> Void

    public init(
        headline: String,
        detail: String,
        primaryActionTitle: String,
        primaryAction: @escaping () -> Void,
        secondaryActionTitle: String,
        secondaryAction: @escaping () -> Void
    ) {
        self.headline = headline
        self.detail = detail
        self.primaryActionTitle = primaryActionTitle
        self.primaryAction = primaryAction
        self.secondaryActionTitle = secondaryActionTitle
        self.secondaryAction = secondaryAction
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: PlosTheme.Spacing.sm) {
            // FINDING (pre-Milestone-8 audit, 2026-09-21): the eyebrow,
            // headline, and detail text had no grouping, so VoiceOver
            // stepped through them as three separate swipes instead of
            // reading the card as one block. The two buttons stay outside
            // this group so they remain independently actionable.
            VStack(alignment: .leading, spacing: PlosTheme.Spacing.sm) {
                HStack(spacing: 8) {
                    PlusMark(color: PlosTheme.accentSoft, size: 14)
                    Text("INSIGHT")
                        .font(.caption.weight(.semibold))
                        .tracking(0.6)
                        .foregroundStyle(PlosTheme.accentSoft)
                }
                Text(headline)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(PlosTheme.background)
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(PlosTheme.background.opacity(0.85))
            }
            .accessibilityElement(children: .combine)

            HStack(spacing: 10) {
                Button(action: primaryAction) {
                    Text(primaryActionTitle)
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 16)
                        .padding(.vertical, 11)
                        .frame(minHeight: 44)
                        .foregroundStyle(PlosTheme.ink)
                }
                .buttonStyle(.plain)
                .background(PlosTheme.accentSoft, in: RoundedRectangle(cornerRadius: 12))

                Button(action: secondaryAction) {
                    Text(secondaryActionTitle)
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 16)
                        .padding(.vertical, 11)
                        .frame(minHeight: 44)
                        .foregroundStyle(PlosTheme.background)
                }
                .buttonStyle(.plain)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(PlosTheme.background.opacity(0.3))
                )
            }
        }
        .padding(PlosTheme.Spacing.md + 2)
        .background(PlosTheme.ink, in: RoundedRectangle(cornerRadius: PlosTheme.Radius.card + 2))
    }
}

#Preview {
    InsightCard(
        headline: "Your recovery is lower than usual today.",
        detail: "Sleep was 38 minutes below your recent baseline, and yesterday's training load was higher than average. This combination has usually meant slower recovery for you.",
        primaryActionTitle: "Move today's workout",
        primaryAction: {},
        secondaryActionTitle: "Not today",
        secondaryAction: {}
    )
    .padding()
    .background(PlosTheme.background)
}
