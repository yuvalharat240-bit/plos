import SwiftUI

/// Merges three requested screens into one lean surface: Calendar,
/// "Next up", and "today and before" (the day switcher browses either
/// direction from today). A separate screen per concept would just be
/// three thin wrappers around the same event list.
struct CalendarView: View {
    @State private var selectedDate = MockData.today

    private var eventsForSelectedDay: [CalendarEvent] {
        MockData.calendarEvents
            .filter { Calendar.current.isDate($0.date, inSameDayAs: selectedDate) }
            .sorted { $0.time < $1.time }
    }

    private var nextUp: CalendarEvent? {
        MockData.calendarEvents
            .filter { $0.date >= MockData.today }
            .sorted { $0.date < $1.date }
            .first
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: PlosTheme.Spacing.lg) {
                if let nextUp {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("NEXT UP")
                            .font(.caption.weight(.semibold))
                            .tracking(0.6)
                            .foregroundStyle(PlosTheme.inkMuted)
                        Text("\(nextUp.title) — \(nextUp.time)")
                            .font(.headline)
                            .foregroundStyle(PlosTheme.ink)
                    }
                    .padding(PlosTheme.Spacing.md)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(PlosTheme.surface, in: RoundedRectangle(cornerRadius: PlosTheme.Radius.tile))
                }

                daySwitcher

                VStack(alignment: .leading, spacing: 10) {
                    if eventsForSelectedDay.isEmpty {
                        Text("Nothing on the calendar this day.")
                            .font(.subheadline)
                            .foregroundStyle(PlosTheme.inkMuted)
                    } else {
                        ForEach(eventsForSelectedDay) { event in
                            HStack(alignment: .top, spacing: 12) {
                                Text(event.time)
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(PlosTheme.inkMuted)
                                    .frame(width: 72, alignment: .leading)
                                Text(event.title)
                                    .font(.subheadline)
                                    .foregroundStyle(PlosTheme.ink)
                            }
                        }
                    }
                }
            }
            .padding(20)
        }
        .background(PlosTheme.background)
    }

    private var daySwitcher: some View {
        HStack {
            Button {
                selectedDate = Calendar.current.date(byAdding: .day, value: -1, to: selectedDate) ?? selectedDate
            } label: {
                Image(systemName: "chevron.left")
            }
            .frame(width: 44, height: 44)
            .accessibilityLabel("Previous day")

            Spacer()

            Text(selectedDate, style: .date)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(PlosTheme.ink)

            Spacer()

            Button {
                selectedDate = Calendar.current.date(byAdding: .day, value: 1, to: selectedDate) ?? selectedDate
            } label: {
                Image(systemName: "chevron.right")
            }
            .frame(width: 44, height: 44)
            .accessibilityLabel("Next day")
        }
        .buttonStyle(.plain)
    }
}

#Preview {
    NavigationStack { CalendarView() }
}
