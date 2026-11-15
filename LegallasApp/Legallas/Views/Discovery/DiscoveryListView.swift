// SPDX-License-Identifier: Apache-2.0
import SwiftUI
import SwiftData
import LegallasCore

struct DiscoveryListView: View {

    @Environment(\.modelContext) private var modelContext
    @Query(sort: \DiscoveryItem.servedAt) private var items: [DiscoveryItem]
    @Query(sort: \Case.createdAt) private var cases: [Case]

    @State private var segment: Segment = .all
    @State private var creating = false
    @State private var editing: DiscoveryItem?

    enum Segment: String, CaseIterable, Identifiable {
        case all, propounded, received
        var id: String { rawValue }
        var title: String {
            switch self {
            case .all: return "All"
            case .propounded: return "Propounded"
            case .received: return "Received"
            }
        }
        var direction: DiscoveryDirection? {
            switch self {
            case .all: return nil
            case .propounded: return .propounded
            case .received: return .received
            }
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("", selection: $segment) {
                    ForEach(Segment.allCases) { s in
                        Text(s.title).tag(s)
                    }
                }
                .pickerStyle(.segmented)
                .padding()

                Group {
                    if filtered.isEmpty {
                        ContentUnavailableView(
                            "No discovery items",
                            systemImage: "magnifyingglass.circle",
                            description: Text("Track propounded and received interrogatories, RFPs, RFAs, depositions, and subpoenas.")
                        )
                    } else {
                        List {
                            ForEach(grouped, id: \.category) { section in
                                Section(section.category.displayName) {
                                    ForEach(section.items) { item in
                                        Button {
                                            editing = item
                                        } label: {
                                            DiscoveryRow(item: item)
                                        }
                                        .buttonStyle(.plain)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Discovery")
            .toolbar {
                ToolbarItem {
                    Button { creating = true } label: {
                        Label("New Item", systemImage: "plus")
                    }
                    .disabled(cases.first == nil)
                }
            }
            .sheet(isPresented: $creating) {
                DiscoveryEditor(existing: nil, caseOwner: cases.first)
            }
            .sheet(item: $editing) { item in
                DiscoveryEditor(existing: item, caseOwner: cases.first)
            }
        }
    }

    private var filtered: [DiscoveryItem] {
        DiscoveryListLogic.filter(items, direction: segment.direction)
    }

    private var grouped: [(category: DiscoveryCategory, items: [DiscoveryItem])] {
        DiscoveryListLogic.grouped(filtered)
    }
}

private struct DiscoveryRow: View {
    let item: DiscoveryItem

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(DiscoveryListLogic.headline(for: item))
                    .font(.subheadline.weight(.semibold))
                if !item.subject.isEmpty {
                    Text(item.subject)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                HStack(spacing: 8) {
                    badge(
                        text: item.direction.displayName,
                        style: DiscoveryListLogic.directionStyle(for: item.direction)
                    )
                    badge(
                        text: item.status.displayName,
                        style: DiscoveryListLogic.statusStyle(for: item.status)
                    )
                }
            }
            Spacer()
            dueCountdownView
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    private func badge(text: String, style: StatusStyle) -> some View {
        Text(text)
            .font(.caption2.weight(.medium))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(style.color.opacity(0.2), in: Capsule())
            .foregroundStyle(style.color)
    }

    @ViewBuilder
    private var dueCountdownView: some View {
        if let countdown = DiscoveryListLogic.countdown(to: item.dueAt) {
            VStack(alignment: .trailing, spacing: 2) {
                Text(countdown.days >= 0 ? "\(countdown.days)d" : "overdue")
                    .font(.headline.monospacedDigit())
                    .foregroundStyle(countdown.urgency.color)
                if let due = item.dueAt {
                    Text(Formatters.displayDate.string(from: due))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        } else {
            Text("No due date")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
    }
}
