// SPDX-License-Identifier: Apache-2.0
import SwiftUI
import SwiftData
import AppKit
import LegallasCore

struct MenuBarQuickCapture: View {

    @Environment(\.modelContext) private var modelContext
    @Query(sort: \Case.createdAt) private var cases: [Case]

    @State private var noteTitle: String = ""
    @State private var noteBody: String = ""
    @State private var taskTitle: String = ""
    @State private var taskDueDate: Date = Date()
    @State private var taskHasDueDate: Bool = false
    @State private var statusMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("\(AppSettings.appName) Quick Capture")
                .font(.headline)

            notePanel
            Divider()
            taskPanel
            Divider()

            HStack {
                if let message = statusMessage {
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button("Review in \(AppSettings.appName)") {
                    focusMainWindow()
                }
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(16)
        .frame(width: 360)
    }

    private var notePanel: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Quick note")
                .font(.subheadline).bold()
            TextField("Title (optional)", text: $noteTitle)
            TextEditor(text: $noteBody)
                .font(.body)
                .frame(minHeight: 80, maxHeight: 120)
                .overlay(
                    RoundedRectangle(cornerRadius: 4)
                        .stroke(Color.secondary.opacity(0.3))
                )
            HStack {
                Spacer()
                Button("Save note") { saveNote() }
                    .disabled(!MenuBarLogic.isNoteDraftValid(body: noteBody))
            }
        }
    }

    private var taskPanel: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Quick task")
                .font(.subheadline).bold()
            TextField("What needs doing?", text: $taskTitle)
            Toggle("Due date", isOn: $taskHasDueDate)
            if taskHasDueDate {
                DatePicker("Due", selection: $taskDueDate, displayedComponents: [.date])
                    .accessibilityLabel("Task due date")
            }
            HStack {
                Spacer()
                Button("Save task") { saveTask() }
                    .disabled(!MenuBarLogic.isTaskDraftValid(title: taskTitle))
            }
        }
    }

    private func saveNote() {
        let envelope = MenuBarLogic.noteEnvelope(title: noteTitle, body: noteBody)
        insert(envelope: envelope)
        noteTitle = ""
        noteBody = ""
        statusMessage = "Note saved to Inbox."
    }

    private func saveTask() {
        let envelope = MenuBarLogic.taskEnvelope(
            title: taskTitle,
            dueDate: taskHasDueDate ? taskDueDate : nil
        )
        insert(envelope: envelope)
        taskTitle = ""
        taskHasDueDate = false
        statusMessage = "Task saved to Inbox."
    }

    private func insert(envelope: ProposalEnvelope) {
        guard let payloadJSON = try? ProposalCodec.payloadJSONString(envelope) else {
            statusMessage = "Save failed."
            return
        }
        let proposal = InboxProposal(
            externalId: envelope.id,
            proposalType: envelope.type,
            proposedAt: envelope.proposedAt,
            rationale: envelope.rationale,
            payloadJSON: payloadJSON,
            status: .pending
        )
        modelContext.insert(proposal)
        if let kase = try? modelContext.fetch(FetchDescriptor<Case>()).first {
            kase.inboxProposals.append(proposal)
        }
        try? modelContext.save()
    }

    private func focusMainWindow() {
        NSApp.activate(ignoringOtherApps: true)
        for window in NSApp.windows where window.canBecomeMain {
            window.makeKeyAndOrderFront(nil)
            break
        }
    }
}
