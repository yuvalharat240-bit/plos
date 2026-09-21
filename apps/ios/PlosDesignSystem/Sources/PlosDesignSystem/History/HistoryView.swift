import SwiftUI

struct HistoryView: View {
    var body: some View {
        // FINDING (pre-Milestone-8 audit, 2026-09-21): this List only ever
        // rendered MockData.pastInsights, with no branch for "no insights
        // yet" — a first-run user (or a future empty real response) would
        // see a totally blank screen with zero feedback.
        let insights = MockData.pastInsights.sorted(by: { $0.date > $1.date })
        Group {
            if insights.isEmpty {
                ContentUnavailableView(
                    "No history yet",
                    systemImage: "clock",
                    description: Text("Insights plos surfaces for you will show up here.")
                )
            } else {
                List {
                    ForEach(insights) { insight in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(insight.date, style: .date)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(PlosTheme.inkMuted)
                            Text(insight.headline)
                                .font(.subheadline)
                                .foregroundStyle(PlosTheme.ink)
                        }
                        .accessibilityElement(children: .combine)
                        .padding(.vertical, 4)
                    }
                }
                .listStyle(.plain)
            }
        }
        .background(PlosTheme.background)
    }
}

#Preview {
    NavigationStack { HistoryView() }
}
