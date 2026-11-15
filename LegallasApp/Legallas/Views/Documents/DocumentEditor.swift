// SPDX-License-Identifier: Apache-2.0
import SwiftUI
import SwiftData
import LegallasCore

struct DocumentEditor: View {

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    let document: Document

    @State private var title: String = ""
    @State private var tagsText: String = ""

    var body: some View {
        Form {
            Section("Document") {
                TextField("Title", text: $title)
                TextField("Tags (comma separated)", text: $tagsText)
                    .help("Example: medical, billing, 2026")
            }
        }
        .formStyle(.grouped)
        .frame(minWidth: 420, minHeight: 220)
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
        title = document.title
        tagsText = document.tags.joined(separator: ", ")
    }

    private func save() {
        document.title = title.trimmingCharacters(in: .whitespaces)
        document.tags = tagsText
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        try? modelContext.save()
        dismiss()
    }
}
