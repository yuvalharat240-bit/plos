import SwiftUI

/// Home's "Today state" row — an asymmetric pair, not equal-width tiles:
/// the fuller baseline story (Sleep) gets more room than the headline
/// (Recovery). Mirrors the design artifact's `1.4fr / 1fr` CSS grid via
/// `layoutPriority` (an approximation, not pixel-exact — sufficient here).
public struct TodayStateGrid: View {
    public var sleepDuration: String
    public var sleepDelta: String
    public var sleepBaselineFraction: Double
    public var recoveryLabel: String
    public var recoveryDetail: String

    public init(
        sleepDuration: String,
        sleepDelta: String,
        sleepBaselineFraction: Double,
        recoveryLabel: String,
        recoveryDetail: String
    ) {
        self.sleepDuration = sleepDuration
        self.sleepDelta = sleepDelta
        self.sleepBaselineFraction = sleepBaselineFraction
        self.recoveryLabel = recoveryLabel
        self.recoveryDetail = recoveryDetail
    }

    public var body: some View {
        HStack(spacing: PlosTheme.Spacing.sm) {
            sleepTile
                .layoutPriority(1.4)
            recoveryTile
                .layoutPriority(1)
        }
    }

    private var sleepTile: some View {
        VStack(alignment: .leading, spacing: PlosTheme.Spacing.xs) {
            Text("SLEEP")
                .font(.caption.weight(.semibold))
                .tracking(0.6)
                .foregroundStyle(PlosTheme.inkMuted)
            Text(sleepDuration)
                .font(.title.weight(.semibold))
                .foregroundStyle(PlosTheme.ink)
            Text(sleepDelta)
                .font(.subheadline)
                .foregroundStyle(PlosTheme.inkMuted)
                .fixedSize(horizontal: false, vertical: true)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(PlosTheme.line)
                    Capsule()
                        .fill(PlosTheme.accentSoft)
                        .frame(width: geo.size.width * sleepBaselineFraction)
                }
            }
            .frame(height: 4)
            .accessibilityHidden(true)
        }
        .padding(PlosTheme.Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(PlosTheme.surface, in: RoundedRectangle(cornerRadius: PlosTheme.Radius.tile))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Sleep, \(sleepDuration), \(sleepDelta)")
    }

    private var recoveryTile: some View {
        VStack(alignment: .leading, spacing: PlosTheme.Spacing.xs) {
            Text("RECOVERY")
                .font(.caption.weight(.semibold))
                .tracking(0.6)
                .foregroundStyle(PlosTheme.background.opacity(0.6))
            Text(recoveryLabel)
                .font(.title2.weight(.semibold))
                .foregroundStyle(PlosTheme.background)
            Text(recoveryDetail)
                .font(.caption)
                .foregroundStyle(PlosTheme.background.opacity(0.7))
        }
        .padding(PlosTheme.Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(PlosTheme.ink, in: RoundedRectangle(cornerRadius: PlosTheme.Radius.tile))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Recovery, \(recoveryLabel) \(recoveryDetail)")
    }
}

#Preview {
    TodayStateGrid(
        sleepDuration: "6h 42m",
        sleepDelta: "38 min below your baseline",
        sleepBaselineFraction: 0.74,
        recoveryLabel: "Lower",
        recoveryDetail: "than usual"
    )
    .padding()
    .background(PlosTheme.background)
}
