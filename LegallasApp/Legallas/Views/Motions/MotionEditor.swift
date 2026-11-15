// SPDX-License-Identifier: Apache-2.0
import SwiftUI
import SwiftData
import LegallasCore

struct MotionEditor: View {

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    let existing: Motion?
    let caseOwner: Case?

    @Query(sort: \Document.title) private var allDocuments: [Document]

    @State private var title: String = ""
    @State private var motionType: MotionType = .custom
    @State private var filedBy: MotionFiler = .us
    @State private var filedAt: Date = Date()
    @State private var hasResponseDue: Bool = false
    @State private var responseDueAt: Date = Date()
    @State private var hasReplyDue: Bool = false
    @State private var replyDueAt: Date = Date()
    @State private var hasHearing: Bool = false
    @State private var hearingAt: Date = Date()
    @State private var status: MotionStatus = .pending
    @State private var ruling: String = ""
    @State private var notes: String = ""
    @State private var selectedDocumentIDs: Set<PersistentIdentifier> = []
    @State private var showingDocumentPicker = false

    var body: some View {
        Form {
            Section("Motion") {
                TextField("Title", text: $title)
                Picker("Type", selection: $motionType) {
                    ForEach(MotionType.allCases, id: \.self) { t in
                        Text(t.displayName).tag(t)
                    }
                }
                Picker("Filed by", selection: $filedBy) {
                    ForEach(MotionFiler.allCases, id: \.self) { f in
                        Text(f.displayName).tag(f)
                    }
                }
                DatePicker("Filed", selection: $filedAt, displayedComponents: .date)
            }
            Section("Deadlines") {
                Toggle("Response due", isOn: $hasResponseDue)
                if hasResponseDue {
                    DatePicker("Response due", selection: $responseDueAt, displayedComponents: .date)
                }
                Toggle("Reply due", isOn: $hasReplyDue)
                if hasReplyDue {
                    DatePicker("Reply due", selection: $replyDueAt, displayedComponents: .date)
                }
                Toggle("Hearing scheduled", isOn: $hasHearing)
                if hasHearing {
                    DatePicker("Hearing", selection: $hearingAt, displayedComponents: [.date, .hourAndMinute])
                }
            }
            Section("Status and ruling") {
                Picker("Status", selection: $status) {
                    ForEach(MotionStatus.allCases, id: \.self) { s in
                        Text(s.displayName).tag(s)
                    }
                }
                TextField("Ruling", text: $ruling, axis: .vertical)
                    .lineLimit(2...8)
                TextField("Notes", text: $notes, axis: .vertical)
                    .lineLimit(2...6)
            }
            Section("Linked documents (\(selectedDocumentIDs.count))") {
                ForEach(linkedDocuments) { doc in
                    Text(doc.title)
                }
                Button {
                    showingDocumentPicker = true
                } label: {
                    Label("Edit documents", systemImage: "doc.badge.plus")
                }
            }
        }
        .formStyle(.grouped)
        .frame(minWidth: 520, minHeight: 620)
        .onAppear(perform: bootstrap)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { dismiss() }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button(existing == nil ? "Create" : "Save", action: save)
                    .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .sheet(isPresented: $showingDocumentPicker) {
            MultiSelectPicker(
                title: "Documents",
                items: allDocuments,
                label: { $0.title },
                selection: $selectedDocumentIDs
            )
        }
    }

    private var linkedDocuments: [Document] {
        allDocuments.filter { selectedDocumentIDs.contains($0.persistentModelID) }
    }

    private func bootstrap() {
        guard let m = existing else { return }
        title = m.title
        motionType = m.motionType
        filedBy = m.filedBy
        filedAt = m.filedAt
        if let d = m.responseDueAt {
            hasResponseDue = true
            responseDueAt = d
        }
        if let d = m.replyDueAt {
            hasReplyDue = true
            replyDueAt = d
        }
        if let d = m.hearingAt {
            hasHearing = true
            hearingAt = d
        }
        status = m.status
        ruling = m.ruling
        notes = m.notes
        selectedDocumentIDs = Set(m.documents.map(\.persistentModelID))
    }

    private func save() {
        let draft = MotionEditorDraft(
            title: title,
            motionType: motionType,
            filedBy: filedBy,
            filedAt: filedAt,
            responseDueAt: hasResponseDue ? responseDueAt : nil,
            replyDueAt: hasReplyDue ? replyDueAt : nil,
            hearingAt: hasHearing ? hearingAt : nil,
            status: status,
            ruling: ruling,
            notes: notes,
            documentIDs: selectedDocumentIDs
        )
        MotionEditorService.apply(
            draft,
            existing: existing,
            caseOwner: caseOwner,
            context: modelContext,
            allDocuments: allDocuments
        )
        dismiss()
    }
}

private struct MultiSelectPicker<Item: PersistentModel>: View {

    @Environment(\.dismiss) private var dismiss
    let title: String
    let items: [Item]
    let label: (Item) -> String
    @Binding var selection: Set<PersistentIdentifier>

    var body: some View {
        NavigationStack {
            List(items) { item in
                Button {
                    toggle(item)
                } label: {
                    HStack {
                        Image(systemName: selection.contains(item.persistentModelID) ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(selection.contains(item.persistentModelID) ? Color.accentColor : .secondary)
                        Text(label(item))
                        Spacer()
                    }
                }
                .buttonStyle(.plain)
            }
            .navigationTitle(title)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .frame(minWidth: 420, minHeight: 420)
    }

    private func toggle(_ item: Item) {
        if selection.contains(item.persistentModelID) {
            selection.remove(item.persistentModelID)
        } else {
            selection.insert(item.persistentModelID)
        }
    }
}
