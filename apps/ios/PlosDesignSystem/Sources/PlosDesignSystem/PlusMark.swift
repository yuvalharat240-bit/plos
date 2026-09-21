import SwiftUI

/// The plos mark — two rounded bars, never the Unicode "+".
/// Arm span : thickness = 64 : 18 (~3.6 : 1), 6pt corner radius at a
/// 64pt reference size — matches `docs/00-brand-design-master-prompt.md`
/// §10 and the plos design system artifact exactly.
public struct PlusMark: View {
    public var color: Color
    public var size: CGFloat

    public init(color: Color = PlosTheme.accent, size: CGFloat = 64) {
        self.color = color
        self.size = size
    }

    public var body: some View {
        let thickness = size * (18.0 / 64.0)
        let radius = size * (6.0 / 64.0)
        ZStack {
            RoundedRectangle(cornerRadius: radius)
                .fill(color)
                .frame(width: size, height: thickness)
            RoundedRectangle(cornerRadius: radius)
                .fill(color)
                .frame(width: thickness, height: size)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

#Preview {
    VStack(spacing: 24) {
        PlusMark(size: 96)
        PlusMark(size: 20)
    }
    .padding()
    .background(PlosTheme.background)
}
