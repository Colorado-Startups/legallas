// SPDX-License-Identifier: Apache-2.0
import SwiftUI
import SwiftData
import LegallasCore

enum TaskEditorMode {
    case create
    case edit(CaseTask)
}

struct TaskEditor: View {

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @Query(sort: \Case.createdAt) private var cases: [Case]

    let mode: TaskEditorMode

    @State private var title: String = ""
    @State private var details: String = ""
    @State private var status: TaskStatus = .toDo
    @State private var priority: Priority = .medium
    @State private var category: String = ""
    @State private var hasDueDate: Bool = false
    @State private var dueDate: Date = Date()

    var body: some View {
        Form {
            Section("Task") {
                TextField("Title", text: $title)
                TextField("Details", text: $details, axis: .vertical)
                    .lineLimit(3...8)
                TextField("Category", text: $category)
            }
            Section("Status") {
                Picker("Status", selection: $status) {
                    ForEach(TaskStatus.allCases, id: \.self) { s in
                        Text(s.displayName).tag(s)
                    }
                }
                Picker("Priority", selection: $priority) {
                    ForEach(Priority.allCases, id: \.self) { p in
                        Text(p.displayName).tag(p)
                    }
                }
            }
            Section("Due Date") {
                Toggle("Has due date", isOn: $hasDueDate)
                if hasDueDate {
                    DatePicker("Due", selection: $dueDate, displayedComponents: .date)
                }
            }
        }
        .formStyle(.grouped)
        .frame(minWidth: 440, minHeight: 480)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { dismiss() }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button("Save", action: save)
                    .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .onAppear(perform: bootstrap)
    }

    private func bootstrap() {
        if case .edit(let task) = mode {
            title = task.title
            details = task.details
            status = task.status
            priority = task.priority
            category = task.category ?? ""
            hasDueDate = task.dueDate != nil
            dueDate = task.dueDate ?? Date()
        }
    }

    private func save() {
        switch mode {
        case .create:
            let maxSort = (cases.first?.tasks.map(\.sortIndex).max() ?? 0)
            let task = CaseTask(
                title: title,
                details: details,
                status: status,
                priority: priority,
                category: category.isEmpty ? nil : category,
                dueDate: hasDueDate ? dueDate : nil,
                sortIndex: maxSort + 1000,
                source: .user
            )
            modelContext.insert(task)
            if let kase = cases.first {
                kase.tasks.append(task)
            }
        case .edit(let task):
            task.title = title
            task.details = details
            task.status = status
            task.priority = priority
            task.category = category.isEmpty ? nil : category
            task.dueDate = hasDueDate ? dueDate : nil
            task.updatedAt = Date()
        }
        try? modelContext.save()
        dismiss()
    }
}
