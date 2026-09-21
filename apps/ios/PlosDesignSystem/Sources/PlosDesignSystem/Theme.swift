import SwiftUI

/// Design tokens for plos — mirrors `docs/00-brand-design-master-prompt.md`
/// and the plos design system artifact (Brand.dc.html).
///
/// ponytail: light mode only. The design artifact deliberately deferred
/// dark-mode artboards ("add when a real screen needs one, not
/// speculatively") — the same line is drawn here rather than silently
/// widening scope at the code layer.
public enum PlosTheme {
    public static let background = Color(hex: 0xF7F6F3)
    public static let surface = Color(hex: 0xECEAE5)
    public static let line = Color(hex: 0xDCD9D2)
    public static let ink = Color(hex: 0x201F1C)
    public static let inkMuted = Color(hex: 0x63605A)
    public static let accent = Color(hex: 0x2E5F5B)
    public static let accentSoft = Color(hex: 0x6B948F)

    public enum Semantic {
        public static let success = Color(hex: 0x4A7A4E)
        public static let warning = Color(hex: 0xB8863A)
        public static let critical = Color(hex: 0xA6483D)
        public static let info = Color(hex: 0x5B6B8C)
    }

    public enum Spacing {
        public static let xs: CGFloat = 6
        public static let sm: CGFloat = 12
        public static let md: CGFloat = 20
        public static let lg: CGFloat = 32
    }

    public enum Radius {
        /// Standalone content surfaces (Insight card, evidence card).
        public static let card: CGFloat = 18
        /// The one glass control shape — matches the Fixed-shape rule
        /// in the Liquid Glass shape system, not Capsule (this bar is
        /// full-width, not phone-scale-control-sized).
        public static let control: CGFloat = 18
        public static let tile: CGFloat = 16
    }
}

extension Color {
    init(hex: UInt32) {
        let r = Double((hex >> 16) & 0xFF) / 255
        let g = Double((hex >> 8) & 0xFF) / 255
        let b = Double(hex & 0xFF) / 255
        self.init(red: r, green: g, blue: b)
    }
}

/// The "iOS26 `.glassEffect()`, else `.ultraThinMaterial`" fallback — was
/// hand-duplicated in `GlassAskBar.swift` and `AskView.swift` (ponytail-
/// audit, pre-Milestone-8 pass, 2026-09-21). `interactive` matters: it's
/// the actual press-feedback behavior for a tappable control (GlassAskBar's
/// button), which a plain text field (AskView's ask bar) doesn't want.
struct GlassOrMaterial: ViewModifier {
    var interactive: Bool = false

    func body(content: Content) -> some View {
        if #available(iOS 26.0, macOS 26.0, *) {
            content.glassEffect(
                interactive ? .regular.interactive() : .regular,
                in: .rect(cornerRadius: PlosTheme.Radius.control)
            )
        } else {
            content.background(
                .ultraThinMaterial,
                in: RoundedRectangle(cornerRadius: PlosTheme.Radius.control)
            )
        }
    }
}
