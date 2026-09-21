import SwiftUI

struct WorkoutsView: View {
    @State private var showLogSheet = false

    var body: some View {
        let workouts = MockData.workouts.sorted(by: { $0.date > $1.date })
        List {
            if workouts.isEmpty {
                Text("No workouts logged yet.")
                    .font(.subheadline)
                    .foregroundStyle(PlosTheme.inkMuted)
            } else {
                ForEach(workouts) { workout in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(workout.type)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(PlosTheme.ink)
                        Text("\(workout.date.formatted(date: .abbreviated, time: .omitted)) · \(workout.durationMinutes) min")
                            .font(.caption)
                            .foregroundStyle(PlosTheme.inkMuted)
                    }
                    .accessibilityElement(children: .combine)
                    .padding(.vertical, 4)
                }
            }
        }
        .listStyle(.plain)
        .background(PlosTheme.background)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showLogSheet = true
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("Log a workout")
            }
        }
        .sheet(isPresented: $showLogSheet) {
            LogWorkoutSheet()
        }
    }
}

private struct LogWorkoutSheet: View {
    @EnvironmentObject private var session: AppSession
    @Environment(\.dismiss) private var dismiss
    @State private var type = "Run"
    @State private var minutes = 30
    @State private var isSaving = false
    @State private var errorMessage: String?

    private let types = ["Run", "Strength", "Yoga", "Ride", "Swim"]

    var body: some View {
        NavigationStack {
            Form {
                Picker("Type", selection: $type) {
                    ForEach(types, id: \.self) { Text($0) }
                }
                Stepper("Duration: \(minutes) min", value: $minutes, in: 5...180, step: 5)

                if let errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(PlosTheme.Semantic.critical)
                }
            }
            .navigationTitle("Log a workout")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Button("Save") { Task { await save() } }
                    }
                }
            }
        }
    }

    private func save() async {
        guard let accessToken = session.currentAccessToken() else {
            errorMessage = "Session expired — please sign in again."
            return
        }
        isSaving = true
        errorMessage = nil
        do {
            let api = PlosAPI()
            _ = try await api.createWorkout(
                accessToken: accessToken,
                sportType: type.lowercased(),
                startsAt: Date(),
                durationMin: minutes
            )
            isSaving = false
            dismiss()
        } catch {
            isSaving = false
            errorMessage = "Couldn't save this workout. Please try again."
        }
    }
}

#Preview {
    NavigationStack { WorkoutsView() }
}
