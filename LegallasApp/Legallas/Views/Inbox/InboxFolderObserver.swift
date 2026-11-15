// SPDX-License-Identifier: Apache-2.0
import SwiftUI
import SwiftData
import LegallasCore

/// Points the inbox watcher at the case's documents folder at launch and again whenever
/// that folder is set or changes. Every window carries it; the controller ignores repeats.
struct InboxFolderObserver: ViewModifier {

    let controller: InboxWatcherController

    @Query private var cases: [Case]
    @Environment(\.modelContext) private var modelContext

    /// What the observer watches: any change to the case's bookmark or path triggers a refresh.
    struct FolderKey: Equatable {
        let bookmark: Data?
        let path: String?

        init(_ kase: Case?) {
            bookmark = kase?.documentsFolderBookmark
            path = kase?.documentsFolderLastKnownPath
        }
    }

    func body(content: Content) -> some View {
        content.onChange(of: FolderKey(cases.first), initial: true) {
            controller.refresh(in: modelContext)
        }
    }
}
