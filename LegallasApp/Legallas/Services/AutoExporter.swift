// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData
import LegallasCore

enum AutoExporter {

    static let fileName = AppSettings.exportFileName

    @MainActor
    static func writeOnQuit(container: ModelContainer) {
        let context = ModelContext(container)
        guard let kase = try? context.fetch(FetchDescriptor<Case>()).first else { return }

        if let bookmark = kase.documentsFolderBookmark,
           let resolved = try? BookmarkResolver.resolve(bookmark) {
            try? BookmarkResolver.withSecurityScope(url: resolved.url) { folder in
                try CaseExporter.writeExport(
                    from: context,
                    to: folder.appendingPathComponent(fileName)
                )
            }
            return
        }

        if let path = kase.documentsFolderLastKnownPath {
            let url = URL(fileURLWithPath: path).appendingPathComponent(fileName)
            try? CaseExporter.writeExport(from: context, to: url)
        }
    }
}
