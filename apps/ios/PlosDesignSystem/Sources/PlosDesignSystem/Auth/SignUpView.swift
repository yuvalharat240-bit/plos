import SwiftUI

/// Progressive onboarding per product vision §26: minimal account info +
/// primary goal, nothing else — permissions/integrations come later, not
/// on this screen.
struct SignUpView: View {
    @EnvironmentObject private var session: AppSession
    @State private var name = ""
    @State private var selectedGoal = "Sleep better"

    private let goals = ["Sleep better", "Train consistently", "Manage stress", "Just exploring"]

    var body: some View {
        VStack(alignment: .leading, spacing: PlosTheme.Spacing.lg) {
            VStack(alignment: .leading, spacing: 6) {
                Text("A couple of basics")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(PlosTheme.ink)
                Text("Nothing else yet — plos learns the rest from what you connect, when you're ready.")
                    .font(.subheadline)
                    .foregroundStyle(PlosTheme.inkMuted)
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("What should plos call you?")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(PlosTheme.ink)
                TextField("First name", text: $name)
                    .textFieldStyle(.plain)
                    .padding(14)
                    .background(PlosTheme.surface, in: RoundedRectangle(cornerRadius: PlosTheme.Radius.control))
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Right now, you're mostly here to")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(PlosTheme.ink)
                VStack(spacing: 8) {
                    ForEach(goals, id: \.self) { goal in
                        Button {
                            selectedGoal = goal
                        } label: {
                            HStack {
                                Text(goal)
                                    .foregroundStyle(PlosTheme.ink)
                                Spacer()
                                if selectedGoal == goal {
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundStyle(PlosTheme.accent)
                                }
                            }
                            .padding(14)
                            .background(PlosTheme.surface, in: RoundedRectangle(cornerRadius: PlosTheme.Radius.control))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            if case .failed(let message) = session.stage {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(PlosTheme.Semantic.critical)
            }

            Spacer()

            Button {
                Task { await session.completeSignUp(name: name, goal: selectedGoal) }
            } label: {
                if session.stage == .authenticating {
                    ProgressView().tint(PlosTheme.background)
                        .frame(maxWidth: .infinity, minHeight: 44)
                } else {
                    Text("Continue")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(PlosTheme.background)
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
            }
            .buttonStyle(.plain)
            .background(PlosTheme.accent, in: RoundedRectangle(cornerRadius: PlosTheme.Radius.control))
            .disabled(session.stage == .authenticating)
        }
        .padding(24)
        .background(PlosTheme.background)
    }
}

#Preview {
    SignUpView().environmentObject(AppSession())
}
