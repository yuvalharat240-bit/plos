import Foundation

// ponytail: static illustrative data, same values as the design artifact
// and no backend exists yet. Replace with real repository calls once
// docs/03-system-architecture.md's Scoped Tools layer is wired up —
// screens should not need to change shape when that happens, just what
// feeds them.

struct CalendarEvent: Identifiable {
    let id = UUID()
    let date: Date
    let time: String
    let title: String
}

struct WorkoutEntry: Identifiable {
    let id = UUID()
    let date: Date
    let type: String
    let durationMinutes: Int
}

struct PastInsight: Identifiable {
    let id = UUID()
    let date: Date
    let headline: String
}

struct MedEntry: Identifiable {
    let id = UUID()
    let name: String
    let dose: String
    let lastTaken: String
}

enum MockData {
    static let today = Date()

    static let calendarEvents: [CalendarEvent] = [
        CalendarEvent(date: today, time: "7:30 AM", title: "Team standup"),
        CalendarEvent(date: today, time: "12:30 PM", title: "Lunch with Dana"),
        CalendarEvent(date: Calendar.current.date(byAdding: .day, value: 1, to: today) ?? today, time: "9:00 AM", title: "Dentist"),
        CalendarEvent(date: Calendar.current.date(byAdding: .day, value: -1, to: today) ?? today, time: "6:00 PM", title: "Evening run"),
    ]

    static let workouts: [WorkoutEntry] = [
        WorkoutEntry(date: Calendar.current.date(byAdding: .day, value: -1, to: today) ?? today, type: "Run", durationMinutes: 32),
        WorkoutEntry(date: Calendar.current.date(byAdding: .day, value: -3, to: today) ?? today, type: "Strength", durationMinutes: 48),
        WorkoutEntry(date: Calendar.current.date(byAdding: .day, value: -5, to: today) ?? today, type: "Yoga", durationMinutes: 25),
    ]

    static let pastInsights: [PastInsight] = [
        PastInsight(date: Calendar.current.date(byAdding: .day, value: -1, to: today) ?? today, headline: "Your recovery was lower than usual."),
        PastInsight(date: Calendar.current.date(byAdding: .day, value: -3, to: today) ?? today, headline: "Sleep was back near your baseline."),
        PastInsight(date: Calendar.current.date(byAdding: .day, value: -6, to: today) ?? today, headline: "Training load was elevated three days running."),
    ]

    static let medications: [MedEntry] = [
        MedEntry(name: "Vitamin D", dose: "1000 IU", lastTaken: "Today, 8:10 AM"),
        MedEntry(name: "Magnesium", dose: "200 mg", lastTaken: "Yesterday, 9:45 PM"),
    ]
}
