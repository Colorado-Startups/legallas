// SPDX-License-Identifier: Apache-2.0
import SwiftUI
import SwiftData
import LegallasCore

struct KanbanBoardView: View {

    @Environment(\.modelContext) private var modelContext
    @Query(sort: \CaseTask.sortIndex) private var tasks: [CaseTask]
    @State private var dragState = KanbanDragState()
    @State private var editingTask: CaseTask?
    @State private var isPresentingNewTask = false

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ForEach(TaskStatus.allCases, id: \.self) { status in
                KanbanColumnView(
                    status: status,
                    tasks: tasks(in: status),
                    dragState: dragState,
                    onEdit: { editingTask = $0 }
                )
            }
        }
        .padding(12)
        .navigationTitle("Kanban")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    isPresentingNewTask = true
                } label: {
                    Label("New Task", systemImage: "plus")
                }
                .keyboardShortcut("n", modifiers: .command)
            }
        }
        .sheet(isPresented: $isPresentingNewTask) {
            TaskEditor(mode: .create)
        }
        .sheet(item: $editingTask) { task in
            TaskEditor(mode: .edit(task))
        }
        .onReceive(NotificationCenter.default.publisher(for: .legallasNewTask)) { _ in
            isPresentingNewTask = true
        }
    }

    private func tasks(in status: TaskStatus) -> [CaseTask] {
        tasks.filter { $0.status == status }
    }
}
