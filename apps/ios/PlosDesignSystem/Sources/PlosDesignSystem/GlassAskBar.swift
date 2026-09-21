import SwiftUI

/// The one Liquid Glass surface per screen — a persistent floating
/// control (navigation layer), per the liquid-glass design rule: glass is
/// for bars/toolbars/floating controls, never content cards or full
/// backgrounds. `InsightCard` and the evidence card in `AskView`
/// deliberately do not use this. Falls back to `.ultraThinMaterial` on
/// OSes older than the 26-series this API requires.
public struct GlassAskBar: View {
    public var placeholder: String
    public var action: () -> Void

    public init(placeholder: String, action: @escaping () -> Void) {
        self.placeholder = placeholder
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Text(placeholder)
                    .font(.subheadline)
                    .foregroundStyle(PlosTheme.inkMuted)
                Spacer()
                Image(systemName: "arrow.right")
                    .foregroundStyle(PlosTheme.inkMuted)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .modifier(GlassOrMaterial(interactive: true))
        .accessibilityLabel(Text(placeholder))
    }
}

#Preview {
    GlassAskBar(placeholder: "Ask plos anything about your day") {}
        .padding()
        .background(PlosTheme.background)
}
