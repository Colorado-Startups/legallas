// SPDX-License-Identifier: Apache-2.0
import AppKit
import SwiftData
import LegallasCore

/// Asks for the case's documents folder with an NSOpenPanel and records the choice.
/// Views call `choose(for:in:)`; tests call `CaseDocumentsFolderStore.choose` with a URL instead.
@MainActor
enum DocumentsFolderPanel {

    /// Shows the panel (starting at the current folder) and saves the pick.
    /// Returns false when the user cancels; throws when the bookmark cannot be saved.
    @discardableResult
    static func choose(for kase: Case, in context: ModelContext) throws -> Bool {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = true
        panel.prompt = "Choose"
        panel.message = "Choose the case's documents folder. Claude's proposals arrive in its \(AppSettings.inboxFolderName) folder."
        if let path = kase.documentsFolderLastKnownPath {
            panel.directoryURL = URL(fileURLWithPath: path)
        }
        guard panel.runModal() == .OK, let url = panel.url else { return false }
        try CaseDocumentsFolderStore.choose(url, for: kase, in: context)
        return true
    }
}
