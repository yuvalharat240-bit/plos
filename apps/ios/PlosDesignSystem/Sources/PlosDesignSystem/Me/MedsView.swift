import SwiftUI

/// Medication logging only — never dosage/schedule/prescription changes.
/// Mirrors `action_medication_log` in docs/04-database-schema.md, which
/// is deliberately write-once ("only ever logs a dose the user reports
/// taking") per product vision §12/§16's non-negotiable.
struct MedsView: View {
    @State private var showLogSheet = false

    var body: some View {
        List {
            Section {
                Text("plos only logs doses you report taking — it never changes a dosage or prescribes anything.")
                    .font(.caption)
                    .foregroundStyle(PlosTheme.inkMuted)
            }
            if MockData.medications.isEmpty {
                Text("No medications logged yet.")
                    .font(.subheadline)
                    .foregroundStyle(PlosTheme.inkMuted)
            } else {
                ForEach(MockData.medications) { med in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(med.name)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(PlosTheme.ink)
                        Text("\(med.dose) · last taken \(med.lastTaken)")
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
                .accessibilityLabel("Log a dose")
            }
        }
        .sheet(isPresented: $showLogSheet) {
            LogDoseSheet()
        }
    }
}

private struct LogDoseSheet: View {
    @EnvironmentObject private var session: AppSession
    @Environment(\.dismiss) private var dismiss
    @State private var medName = MockData.medications.first?.name ?? ""
    @State private var isSaving = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Picker("Medication", selection: $medName) {
                    ForEach(MockData.medications) { med in
                        Text(med.name).tag(med.name)
                    }
                }
                Text("Logs that a dose was taken now. Does not change dose, schedule, or prescription.")
                    .font(.caption)
                    .foregroundStyle(PlosTheme.inkMuted)

                if let errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(PlosTheme.Semantic.critical)
                }
            }
            .navigationTitle("Log a dose")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Button("Save") { Task { await save() } }
                            .disabled(medName.isEmpty)
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
            _ = try await api.createMedicationLog(
                accessToken: accessToken,
                medicationName: medName,
                dose: nil,
                unit: nil,
                takenAt: Date()
            )
            isSaving = false
            dismiss()
        } catch {
            isSaving = false
            errorMessage = "Couldn't save this dose. Please try again."
        }
    }
}

#Preview {
    NavigationStack { MedsView() }
}
