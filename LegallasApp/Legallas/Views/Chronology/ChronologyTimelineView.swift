// SPDX-License-Identifier: Apache-2.0
import SwiftUI
import SwiftData
import LegallasCore

struct ChronologyTimelineView: View {

    @Environment(\.modelContext) private var modelContext
    @Query(sort: \ChronologyEvent.date) private var events: [ChronologyEvent]
    @Query(sort: \Case.createdAt) private var cases: [Case]

    @State private var creating = false
    @State private var editing: ChronologyEvent?

    private struct MonthGroup: Identifiable {
        let id: Date
        let label: String
        let events: [ChronologyEvent]
    }

    var body: some View {
        NavigationStack {
            Group {
                if events.isEmpty {
                    ContentUnavailableView(
                        "Empty chronology",
                        systemImage: "calendar.day.timeline.left",
                        description: Text("Log filings, service events, and milestones to build the case timeline.")
                    )
                } else {
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 24) {
                            ForEach(monthGroups) { group in
                                VStack(alignment: .leading, spacing: 10) {
                                    Text(group.label)
                                        .font(.headline)
                                        .padding(.leading, 8)
                                    ForEach(group.events) { event in
                                        EventRow(event: event) {
                                            editing = event
                                        }
                                    }
                                }
                            }
                        }
                        .padding(16)
                    }
                }
            }
            .navigationTitle("Chronology")
            .toolbar {
                ToolbarItem {
                    Button { creating = true } label: {
                        Label("New Event", systemImage: "plus")
                    }
                    .disabled(cases.first == nil)
                }
            }
            .sheet(isPresented: $creating) {
                ChronologyEditor(existing: nil, caseOwner: cases.first)
            }
            .sheet(item: $editing) { event in
                ChronologyEditor(existing: event, caseOwner: cases.first)
            }
        }
    }

    private var monthGroups: [MonthGroup] {
        let calendar = DateMath.denverCalendar
        let grouped = Dictionary(grouping: events) { event -> Date in
            let comps = calendar.dateComponents([.year, .month], from: event.date)
            return calendar.date(from: comps) ?? event.date
        }
        return grouped.keys.sorted().map { anchor in
            let formatter = DateFormatter()
            formatter.calendar = calendar
            formatter.timeZone = DateMath.denverTimeZone
            formatter.dateFormat = "MMMM y"
            return MonthGroup(
                id: anchor,
                label: formatter.string(from: anchor),
                events: grouped[anchor]?.sorted { $0.date < $1.date } ?? []
            )
        }
    }
}

private struct EventRow: View {
    let event: ChronologyEvent
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(alignment: .top, spacing: 12) {
                VStack(spacing: 2) {
                    Image(systemName: icon)
                        .foregroundStyle(.white)
                        .padding(6)
                        .background(Circle().fill(color))
                    Text(dayString)
                        .font(.caption2)
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
                .frame(width: 44)

                VStack(alignment: .leading, spacing: 4) {
                    Text(event.title.isEmpty ? "Untitled event" : event.title)
                        .font(.subheadline.weight(.semibold))
                    if !event.summary.isEmpty {
                        Text(event.summary)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(3)
                    }
                    HStack(spacing: 8) {
                        Text(event.type.rawValue.capitalized)
                            .font(.caption2.weight(.medium))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(color.opacity(0.2), in: Capsule())
                        if !event.documents.isEmpty {
                            Label("\(event.documents.count)", systemImage: "doc")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        if !event.contacts.isEmpty {
                            Label("\(event.contacts.count)", systemImage: "person")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                Spacer()
            }
            .padding(12)
            .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
    }

    private var dayString: String {
        let f = DateFormatter()
        f.calendar = DateMath.denverCalendar
        f.timeZone = DateMath.denverTimeZone
        f.dateFormat = "d MMM"
        return f.string(from: event.date)
    }

    private var icon: String {
        switch event.type {
        case .filing: return "doc.text"
        case .service: return "envelope"
        case .pleading: return "doc.append"
        case .discovery: return "magnifyingglass"
        case .meeting: return "person.2"
        case .communication: return "bubble.left.and.bubble.right"
        case .milestone: return "flag"
        case .deadline: return "calendar.badge.clock"
        case .order: return "gavel"
        case .custom: return "star"
        }
    }

    private var color: Color {
        switch event.type {
        case .filing: return .blue
        case .service: return .purple
        case .pleading: return .indigo
        case .discovery: return .cyan
        case .meeting: return .green
        case .communication: return .mint
        case .milestone: return .pink
        case .deadline: return .orange
        case .order: return .red
        case .custom: return .gray
        }
    }
}
