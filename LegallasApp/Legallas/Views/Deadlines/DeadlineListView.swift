// SPDX-License-Identifier: Apache-2.0
import SwiftUI
import SwiftData
import LegallasCore

struct DeadlineListView: View {

    @Environment(\.modelContext) private var modelContext
    @Query(sort: \Deadline.computedDate) private var deadlines: [Deadline]
    @State private var editingDeadline: Deadline?
    @State private var isPresentingNew = false

    var body: some View {
        Table(deadlines) {
            TableColumn("Title") { d in
                HStack {
                    Text(d.title)
                    if d.source == .claude {
                        Image(systemName: "sparkle")
                            .foregroundStyle(.purple)
                            .accessibilityLabel("Suggested by Claude")
                    }
                }
                .onTapGesture { editingDeadline = d }
            }
            TableColumn("Rule") { d in
                Text(d.ruleCitation ?? "")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            TableColumn("Anchor") { d in
                Text("\(d.anchor.rawValue) \(d.direction == .before ? "-" : "+")\(d.offsetDays)d")
                    .font(.caption.monospaced())
            }
            TableColumn("Computed Date") { d in
                let overdue = !d.isSatisfied && d.computedDate < Date()
                Text(Formatters.displayDate.string(from: d.computedDate))
                    .foregroundStyle(overdue ? .red : .primary)
            }
            TableColumn("Reminders") { d in
                Text("\(d.reminders.count)")
                    .font(.caption)
            }
            TableColumn("Status") { d in
                Text(d.isSatisfied ? "Satisfied" : "Open")
                    .font(.caption)
                    .foregroundStyle(d.isSatisfied ? .green : .primary)
            }
        }
        .navigationTitle("Deadlines")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    isPresentingNew = true
                } label: {
                    Label("New Deadline", systemImage: "plus")
                }
            }
        }
        .sheet(isPresented: $isPresentingNew) {
            DeadlineEditor(mode: .create)
        }
        .sheet(item: $editingDeadline) { d in
            DeadlineEditor(mode: .edit(d))
        }
        .onReceive(NotificationCenter.default.publisher(for: .legallasNewDeadline)) { _ in
            isPresentingNew = true
        }
    }
}
