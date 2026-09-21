import SwiftUI
import PlosDesignSystem

/// Runs the entire app (Login → Sign up → the 5-tab Main flow) as a real
/// macOS window — proof the navigation assembly actually works, not just
/// that each screen compiles in isolation. `swift run PlosPreviewApp`.
/// The shipping target is the iOS app in apps/ios/plos.xcodeproj; this
/// exists because this environment has no Xcode to run that one.
@main
struct PlosPreviewApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
                .frame(minWidth: 420, minHeight: 800)
        }
    }
}
