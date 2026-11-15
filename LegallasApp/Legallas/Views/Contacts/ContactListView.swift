// SPDX-License-Identifier: Apache-2.0
import SwiftUI
import SwiftData
import LegallasCore

struct ContactRoleFilter: Hashable {
    let role: ContactRole?

    static let all = ContactRoleFilter(role: nil)

    var title: String { role?.displayName ?? "All" }
}

struct ContactListView: View {

    @Environment(\.modelContext) private var modelContext
    @Query(sort: \Contact.name) private var contacts: [Contact]
    @Query(sort: \Case.createdAt) private var cases: [Case]

    @State private var selected: Contact?
    @State private var searchText: String = ""
    @State private var filter: ContactRoleFilter = .all
    @State private var creating = false

    var body: some View {
        NavigationSplitView {
            VStack(spacing: 0) {
                rolePicker
                List(selection: $selected) {
                    ForEach(filteredContacts) { contact in
                        ContactRow(contact: contact).tag(contact)
                    }
                }
            }
            .searchable(text: $searchText, prompt: "Search name, organization, email")
            .navigationTitle("Contacts")
            .toolbar {
                ToolbarItem {
                    Button { creating = true } label: {
                        Label("New Contact", systemImage: "plus")
                    }
                }
            }
        } detail: {
            if let contact = selected {
                ContactDetailView(contact: contact)
            } else {
                ContentUnavailableView("Select a contact", systemImage: "person.crop.circle")
            }
        }
        .sheet(isPresented: $creating) {
            ContactEditor(caseOwner: cases.first)
        }
    }

    private var rolePicker: some View {
        Picker("Role", selection: $filter) {
            Text("All").tag(ContactRoleFilter.all)
            ForEach(ContactRole.allCases, id: \.self) { role in
                Text(role.displayName).tag(ContactRoleFilter(role: role))
            }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, 12)
        .padding(.top, 8)
    }

    private var filteredContacts: [Contact] {
        contacts.filter { contact in
            if let role = filter.role, contact.role != role { return false }
            if searchText.isEmpty { return true }
            if contact.name.localizedCaseInsensitiveContains(searchText) { return true }
            if let org = contact.organization, org.localizedCaseInsensitiveContains(searchText) { return true }
            if let email = contact.email, email.localizedCaseInsensitiveContains(searchText) { return true }
            return false
        }
    }
}

private struct ContactRow: View {
    let contact: Contact

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(contact.name)
                Text(contact.role.displayName)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if let org = contact.organization {
                Text(org).font(.caption2).foregroundStyle(.tertiary).lineLimit(1)
            }
        }
        .padding(.vertical, 2)
    }

    private var icon: String {
        switch contact.role {
        case .plaintiff, .defendant: return "person.fill"
        case .plaintiffCounsel, .defenseCounsel: return "briefcase"
        case .expert: return "graduationcap"
        case .witness: return "person.wave.2"
        case .courtStaff: return "building.columns"
        case .vendor: return "shippingbox"
        case .other: return "person.crop.circle"
        }
    }
}
