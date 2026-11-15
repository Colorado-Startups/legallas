// SPDX-License-Identifier: Apache-2.0
import SwiftUI
import SwiftData
import LegallasCore

struct DiscoveryEditor: View {

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    let existing: DiscoveryItem?
    let caseOwner: Case?

    @Query(sort: \Document.title) private var allDocuments: [Document]
    @Query(sort: \Contact.name) private var allContacts: [Contact]

    @State private var category: DiscoveryCategory = .interrogatories
    @State private var direction: DiscoveryDirection = .propounded
    @State private var setNumber: Int = 1
    @State private var hasItemNumber: Bool = false
    @State private var itemNumber: Int = 1
    @State private var subject: String = ""
    @State private var servedAt: Date = Date()
    @State private var hasDueDate: Bool = false
    @State private var dueAt: Date = Date()
    @State private var status: DiscoveryStatus = .outstanding
    @State private var responseText: String = ""
    @State private var notes: String = ""
    @State private var selectedDocumentIDs: Set<PersistentIdentifier> = []
    @State private var selectedContactIDs: Set<PersistentIdentifier> = []
    @State private var showingDocumentPicker = false
    @State private var showingContactPicker = false

    var body: some View {
        Form {
            Section("Basics") {
                Picker("Category", selection: $category) {
                    ForEach(DiscoveryCategory.allCases, id: \.self) { c in
                        Text(c.displayName).tag(c)
                    }
                }
                Picker("Direction", selection: $direction) {
                    ForEach(DiscoveryDirection.allCases, id: \.self) { d in
                        Text(d.displayName).tag(d)
                    }
                }
                Stepper("Set \(setNumber)", value: $setNumber, in: 1...20)
                if supportsItemNumber {
                    Toggle("Item number", isOn: $hasItemNumber)
                    if hasItemNumber {
                        Stepper("#\(itemNumber)", value: $itemNumber, in: 1...999)
                    }
                }
                TextField("Subject", text: $subject)
            }
            Section("Dates") {
                DatePicker("Served", selection: $servedAt, displayedComponents: .date)
                Toggle("Due date", isOn: $hasDueDate)
                if hasDueDate {
                    DatePicker("Due", selection: $dueAt, displayedComponents: .date)
                }
            }
            Section("Status and response") {
                Picker("Status", selection: $status) {
                    ForEach(DiscoveryStatus.allCases, id: \.self) { s in
                        Text(s.displayName).tag(s)
                    }
                }
                TextField("Response text", text: $responseText, axis: .vertical)
                    .lineLimit(3...10)
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
                    .disabled(subject.trimmingCharacters(in: .whitespaces).isEmpty)
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

    private var supportsItemNumber: Bool {
        DiscoveryEditorService.supportsItemNumber(category)
    }

    private var linkedDocuments: [Document] {
        allDocuments.filter { selectedDocumentIDs.contains($0.persistentModelID) }
    }

    private var linkedContacts: [Contact] {
        allContacts.filter { selectedContactIDs.contains($0.persistentModelID) }
    }

    private func bootstrap() {
        guard let item = existing else { return }
        category = item.category
        direction = item.direction
        setNumber = item.setNumber
        if let n = item.itemNumber {
            hasItemNumber = true
            itemNumber = n
        }
        subject = item.subject
        servedAt = item.servedAt
        if let due = item.dueAt {
            hasDueDate = true
            dueAt = due
        }
        status = item.status
        responseText = item.responseText
        notes = item.notes
        selectedDocumentIDs = Set(item.documents.map(\.persistentModelID))
        selectedContactIDs = Set(item.contacts.map(\.persistentModelID))
    }

    private func save() {
        let draft = DiscoveryEditorDraft(
            category: category,
            direction: direction,
            setNumber: setNumber,
            itemNumber: hasItemNumber ? itemNumber : nil,
            subject: subject,
            servedAt: servedAt,
            dueAt: hasDueDate ? dueAt : nil,
            status: status,
            responseText: responseText,
            notes: notes,
            documentIDs: selectedDocumentIDs,
            contactIDs: selectedContactIDs
        )
        DiscoveryEditorService.apply(
            draft,
            existing: existing,
            caseOwner: caseOwner,
            context: modelContext,
            allDocuments: allDocuments,
            allContacts: allContacts
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
