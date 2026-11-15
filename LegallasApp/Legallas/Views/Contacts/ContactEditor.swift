// SPDX-License-Identifier: Apache-2.0
import SwiftUI
import SwiftData
import LegallasCore

struct ContactEditor: View {

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    let caseOwner: Case?

    @State private var name: String = ""
    @State private var role: ContactRole = .witness
    @State private var organization: String = ""
    @State private var email: String = ""
    @State private var phone: String = ""
    @State private var address: String = ""
    @State private var notesSummary: String = ""

    var body: some View {
        Form {
            Section("New contact") {
                TextField("Name", text: $name)
                Picker("Role", selection: $role) {
                    ForEach(ContactRole.allCases, id: \.self) { r in
                        Text(r.displayName).tag(r)
                    }
                }
                TextField("Organization", text: $organization)
            }
            Section("Contact") {
                TextField("Email", text: $email)
                TextField("Phone", text: $phone)
                TextField("Address", text: $address, axis: .vertical).lineLimit(2...4)
            }
            Section("Notes") {
                TextField("Summary", text: $notesSummary, axis: .vertical).lineLimit(3...8)
            }
        }
        .formStyle(.grouped)
        .frame(minWidth: 480, minHeight: 480)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { dismiss() }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button("Create", action: create)
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
    }

    private func create() {
        let contact = Contact(
            name: name.trimmingCharacters(in: .whitespaces),
            role: role,
            organization: organization.nonEmpty,
            email: email.nonEmpty,
            phone: phone.nonEmpty,
            address: address.nonEmpty,
            notesSummary: notesSummary.nonEmpty,
            source: .user
        )
        modelContext.insert(contact)
        caseOwner?.parties.append(contact)
        try? modelContext.save()
        dismiss()
    }
}

private extension String {
    var nonEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
