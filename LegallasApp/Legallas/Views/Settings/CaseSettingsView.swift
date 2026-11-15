// SPDX-License-Identifier: Apache-2.0
import SwiftUI
import SwiftData
import LegallasCore

/// The Settings window (Legallas > Settings…): the case's documents folder, with a
/// Choose or Change button. Changing it repoints the inbox watcher.
struct CaseSettingsView: View {

    @Environment(\.modelContext) private var modelContext
    @Query(sort: \Case.createdAt) private var cases: [Case]
    @State private var errorText: String?

    var body: some View {
        Form {
            Section {
                LabeledContent("Documents folder") {
                    HStack {
                        Text(displayPath)
                            .foregroundStyle(cases.first?.documentsFolderLastKnownPath == nil ? .secondary : .primary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                            .help(cases.first?.documentsFolderLastKnownPath ?? "")
                        Button(cases.first?.documentsFolderLastKnownPath == nil ? "Choose…" : "Change…") {
                            choose()
                        }
                        .disabled(cases.first == nil)
                    }
                }
            } footer: {
                Text("Claude's proposals arrive in this folder's \(AppSettings.inboxFolderName) subfolder; exports are written here too.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .frame(width: 520)
        .alert("Couldn't save the documents folder", isPresented: Binding(
            get: { errorText != nil },
            set: { if !$0 { errorText = nil } }
        )) {
            Button("OK") {}
        } message: {
            Text(errorText ?? "")
        }
    }

    private var displayPath: String {
        guard let path = cases.first?.documentsFolderLastKnownPath else { return "Not set" }
        return (path as NSString).abbreviatingWithTildeInPath
    }

    private func choose() {
        guard let kase = cases.first else { return }
        do {
            try DocumentsFolderPanel.choose(for: kase, in: modelContext)
        } catch {
            errorText = error.localizedDescription
        }
    }
}
