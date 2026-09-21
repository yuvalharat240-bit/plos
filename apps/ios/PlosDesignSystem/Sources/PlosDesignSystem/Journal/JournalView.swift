import SwiftUI

/// New screen (docs/09 Milestone 2 Context §2 — journal entries are an
/// explicit MVP loop requirement, 08 §1, that had no client-side screen
/// before this). Mental/Emotional domain (MVP), `observation_journal_entry`.
struct JournalView: View {
    @EnvironmentObject private var session: AppSession
    @Environment(\.dismiss) private var dismiss

    @State private var entryKind: EntryKind = .freeText
    @State private var entryText = ""
    @State private var moodScore: Double = 5
    @State private var stressScore: Double = 5
    @State private var energyScore: Double = 5
    @State private var tagsText = ""
    @State private var isSaving = false
    @State private var errorMessage: String?

    private enum EntryKind: String, CaseIterable {
        case freeText = "Free text"
        case structuredCheckin = "Quick check-in"
    }

    var body: some View {
        NavigationStack {
            Form {
                Picker("Kind", selection: $entryKind) {
                    ForEach(EntryKind.allCases, id: \.self) { Text($0.rawValue) }
                }
                .pickerStyle(.segmented)

                if entryKind == .freeText {
                    Section("What's on your mind?") {
                        TextEditor(text: $entryText)
                            .frame(minHeight: 120)
                    }
                } else {
                    Section("Mood") {
                        Slider(value: $moodScore, in: 0...10, step: 1) {
                            Text("Mood")
                        }
                        Text("\(Int(moodScore))/10")
                            .font(.caption)
                            .foregroundStyle(PlosTheme.inkMuted)
                    }
                    Section("Stress") {
                        Slider(value: $stressScore, in: 0...10, step: 1) {
                            Text("Stress")
                        }
                        Text("\(Int(stressScore))/10")
                            .font(.caption)
                            .foregroundStyle(PlosTheme.inkMuted)
                    }
                    Section("Energy") {
                        Slider(value: $energyScore, in: 0...10, step: 1) {
                            Text("Energy")
                        }
                        Text("\(Int(energyScore))/10")
                            .font(.caption)
                            .foregroundStyle(PlosTheme.inkMuted)
                    }
                }

                Section("Tags (comma separated, optional)") {
                    TextField("gratitude, work, sleep", text: $tagsText)
                }

                if let errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(PlosTheme.Semantic.critical)
                }
            }
            .navigationTitle("Journal entry")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Button("Save") { Task { await save() } }
                            .disabled(entryKind == .freeText && entryText.isEmpty)
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
        let tags = tagsText
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }

        do {
            let api = PlosAPI()
            _ = try await api.createJournalEntry(
                accessToken: accessToken,
                entryKind: entryKind == .freeText ? "free_text" : "structured_checkin",
                entryText: entryKind == .freeText ? entryText : nil,
                moodScore: entryKind == .structuredCheckin ? moodScore : nil,
                stressScore: entryKind == .structuredCheckin ? stressScore : nil,
                energyScore: entryKind == .structuredCheckin ? energyScore : nil,
                tags: tags
            )
            isSaving = false
            dismiss()
        } catch {
            isSaving = false
            errorMessage = "Couldn't save your entry. Please try again."
        }
    }
}

#Preview {
    JournalView().environmentObject(AppSession())
}
