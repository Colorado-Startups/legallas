// SPDX-License-Identifier: Apache-2.0
import SwiftUI
import SwiftData
import LegallasCore

struct ChronologyEditor: View {

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    let existing: ChronologyEvent?
    let caseOwner: Case?

    @Query(sort: \Document.title) private var allDocuments: [Document]
    @Query(sort: \Contact.name) private var allContacts: [Contact]

    @State private var title: String = ""
    @State private var date: Date = Date()
    @State private var type: EventType = .custom
    @State private var summary: String = ""
    @State private var selectedDocumentIDs: Set<PersistentIdentifier> = []
    @State private var selectedContactIDs: Set<PersistentIdentifier> = []
    @State private var showingDocumentPicker = false
    @State private var showingContactPicker = false

    var body: some View {
        Form {
            Section("Event") {
                TextField("Title", text: $title)
                DatePicker("Date", selection: $date, displayedComponents: .date)
                Picker("Type", selection: $type) {
                    ForEach(EventType.allCases, id: \.self) { t in
                        Text(t.rawValue.capitalized).tag(t)
                    }
                }
            }
            Section("Summary") {
                TextField("What happened", text: $summary, axis: .vertical)
                    .lineLimit(3...10)
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
            Section("Linked contacts (\(selectedContactIDs.count))") {
                ForEach(linkedContacts) { contact in
                    Text(contact.name)
                }
                Button {
                    showingContactPicker = true
                } label: {
                    Label("Edit contacts", systemImage: "person.badge.plus")
                }
            }
        }
        .formStyle(.grouped)
        .frame(minWidth: 520, minHeight: 600)
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
        .sheet(isPresented: $showingContactPicker) {
            MultiSelectPicker(
                title: "Contacts",
                items: allContacts,
                label: { $0.name },
                selection: $selectedContactIDs
            )
        }
    }

    private var linkedDocuments: [Document] {
        allDocuments.filter { selectedDocumentIDs.contains($0.persistentModelID) }
    }

    private var linkedContacts: [Contact] {
        allContacts.filter { selectedContactIDs.contains($0.persistentModelID) }
    }

    private func bootstrap() {
        guard let event = existing else { return }
        title = event.title
        date = event.date
        type = event.type
        summary = event.summary
        selectedDocumentIDs = Set(event.documents.map(\.persistentModelID))
        selectedContactIDs = Set(event.contacts.map(\.persistentModelID))
    }

    private func save() {
        let trimmed = title.trimmingCharacters(in: .whitespaces)
        let event: ChronologyEvent
        if let existing {
            event = existing
            event.title = trimmed
            event.date = date
            event.type = type
            event.summary = summary
        } else {
            event = ChronologyEvent(
                title: trimmed,
                date: date,
                type: type,
                summary: summary,
                source: .user
            )
            modelContext.insert(event)
            caseOwner?.events.append(event)
        }

        event.documents = allDocuments.filter { selectedDocumentIDs.contains($0.persistentModelID) }
        event.contacts = allContacts.filter { selectedContactIDs.contains($0.persistentModelID) }

        try? modelContext.save()
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
