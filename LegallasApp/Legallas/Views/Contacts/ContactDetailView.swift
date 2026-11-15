// SPDX-License-Identifier: Apache-2.0
import SwiftUI
import SwiftData
import LegallasCore

struct ContactDetailView: View {

    @Environment(\.modelContext) private var modelContext
    @Bindable var contact: Contact

    @State private var organization: String = ""
    @State private var email: String = ""
    @State private var phone: String = ""
    @State private var address: String = ""
    @State private var notesSummary: String = ""

    var body: some View {
        Form {
            Section("Identity") {
                TextField("Name", text: $contact.name)
                    .onChange(of: contact.name) { _, _ in save() }
                Picker("Role", selection: $contact.role) {
                    ForEach(ContactRole.allCases, id: \.self) { role in
                        Text(role.displayName).tag(role)
                    }
                }
                .onChange(of: contact.role) { _, _ in save() }
                TextField("Organization", text: $organization)
                    .onSubmit { contact.organization = organization.nonEmpty; save() }
            }
            Section("Contact") {
                TextField("Email", text: $email)
                    .onSubmit { contact.email = email.nonEmpty; save() }
                TextField("Phone", text: $phone)
                    .onSubmit { contact.phone = phone.nonEmpty; save() }
                TextField("Address", text: $address, axis: .vertical)
                    .lineLimit(2...4)
                    .onSubmit { contact.address = address.nonEmpty; save() }
            }
            Section("Notes") {
                TextField("Summary", text: $notesSummary, axis: .vertical)
                    .lineLimit(3...8)
                    .onSubmit { contact.notesSummary = notesSummary.nonEmpty; save() }
            }
            Section {
                LabeledContent("Source", value: contact.source.rawValue)
                LabeledContent("Created", value: Formatters.displayDate.string(from: contact.createdAt))
            }
        }
        .formStyle(.grouped)
        .navigationTitle(contact.name)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Save", action: saveAll)
            }
        }
        .onAppear(perform: bootstrap)
        .onChange(of: contact) { _, _ in bootstrap() }
    }

    private func bootstrap() {
        organization = contact.organization ?? ""
        email = contact.email ?? ""
        phone = contact.phone ?? ""
        address = contact.address ?? ""
        notesSummary = contact.notesSummary ?? ""
    }

    private func save() {
        try? modelContext.save()
    }

    private func saveAll() {
        contact.organization = organization.nonEmpty
        contact.email = email.nonEmpty
        contact.phone = phone.nonEmpty
        contact.address = address.nonEmpty
        contact.notesSummary = notesSummary.nonEmpty
        save()
    }
}

private extension String {
    var nonEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
