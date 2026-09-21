import SwiftUI

/// The package's one public entry point — an app target constructs
/// `RootView()` and nothing else. Everything downstream (auth, tabs,
/// every screen) is internal to this module by design: only the seam an
/// external app target actually needs is public.
public struct RootView: View {
    @StateObject private var session = AppSession()

    public init() {}

    public var body: some View {
        Group {
            switch session.stage {
            case .restoring:
                ZStack {
                    PlosTheme.background.ignoresSafeArea()
                    PlusMark(size: 48)
                }
            case .loggedOut, .authenticating, .failed:
                LoginView().environmentObject(session)
            case .signingUp:
                SignUpView().environmentObject(session)
            case .loggedIn:
                MainTabView().environmentObject(session)
            }
        }
        .animation(.easeInOut(duration: 0.2), value: session.stage)
        .task {
            await session.restoreSession()
        }
    }
}

#Preview {
    RootView()
}
