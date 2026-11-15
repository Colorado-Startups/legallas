// SPDX-License-Identifier: Apache-2.0
import SwiftUI
import SwiftData
import LegallasCore

struct KanbanColumnView: View {

    let status: TaskStatus
    let tasks: [CaseTask]
    let dragState: KanbanDragState
    let onEdit: (CaseTask) -> Void

    @Environment(\.modelContext) private var modelContext
    @State private var isTargeted = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(status.displayName)
                    .font(.headline)
                Spacer()
                Text("\(tasks.count)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 8)
            .accessibilityElement(children: .combine)
            .accessibilityLabel("\(status.displayName) column, \(tasks.count) tasks")

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 6) {
                    ForEach(tasks) { task in
                        TaskCardView(task: task)
                            .onTapGesture { onEdit(task) }
                            .draggable(TaskDragPlaceholder(title: task.title)) {
                                TaskCardView(task: task)
                                    .frame(width: 240)
                            }
                            .simultaneousGesture(DragGesture(minimumDistance: 0).onChanged { _ in
                                dragState.draggedTask = task
                            })
                    }
                }
                .padding(8)
            }
            .background(Color.secondary.opacity(isTargeted ? 0.15 : 0.05), in: RoundedRectangle(cornerRadius: 10))
            .dropDestination(for: TaskDragPlaceholder.self) { _, _ in
                handleDrop()
                return true
            } isTargeted: { targeted in
                isTargeted = targeted
            }
        }
        .frame(maxWidth: .infinity, alignment: .top)
    }

    private func handleDrop() {
        guard let task = dragState.draggedTask, task.status != status else {
            dragState.draggedTask = nil
            return
        }
        task.status = status
        if status == .done, task.completedAt == nil {
            task.completedAt = Date()
        } else if status != .done {
            task.completedAt = nil
        }
        task.updatedAt = Date()
        let maxSort = tasks.map(\.sortIndex).max() ?? 0
        task.sortIndex = maxSort + 1000
        try? modelContext.save()
        dragState.draggedTask = nil
    }
}

struct TaskDragPlaceholder: Codable, Transferable, Equatable {
    let title: String

    static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .data)
    }
}
