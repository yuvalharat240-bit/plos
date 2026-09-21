import Foundation
import EventKit

struct CalendarEventSample {
    let sourceId: String
    let start: Date
    let end: Date?
    let attendeeCount: Int?
}

/**
 * docs/09 Milestone 3: EventKit, unlike HealthKit, does report real
 * authorization status for read access — `EKEventStore.authorizationStatus`
 * is a genuine signal, not a locally-tracked guess (contrast with
 * `HealthKitService`'s header comment). Deliberately reads only
 * start/end/attendee-count (docs/08 §2.4: calendar is a density signal,
 * not event content) — never `event.title`, matching the Info.plist
 * usage string and the backend DTO, which has no title field at all.
 */
struct EventKitService {
    private let store = EKEventStore()

    var authorizationStatus: EKAuthorizationStatus {
        EKEventStore.authorizationStatus(for: .event)
    }

    @discardableResult
    func requestAccess() async throws -> Bool {
        try await store.requestFullAccessToEvents()
    }

    func fetchUpcomingEvents(days: Int = 7) -> [CalendarEventSample] {
        let start = Date()
        guard let end = Calendar.current.date(byAdding: .day, value: days, to: start) else { return [] }
        let predicate = store.predicateForEvents(withStart: start, end: end, calendars: nil)
        return store.events(matching: predicate).map { event in
            CalendarEventSample(
                sourceId: event.eventIdentifier,
                start: event.startDate,
                end: event.endDate,
                attendeeCount: event.attendees?.count
            )
        }
    }
}
