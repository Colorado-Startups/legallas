// SPDX-License-Identifier: Apache-2.0
import SwiftUI
import SwiftData
import os
import LegallasCore

private let logger = Logger(subsystem: AppSettings.bundleIdentifier, category: "App")

@main
struct LegallasApp: App {

    /// Nil when the store did not open: the app then says why, with the store unchanged.
    let container: ModelContainer?
    let storeProblem: String?
    @State private var documentStoreState = DocumentStoreState()
    @State private var inboxWatcherController = InboxWatcherController()

    init() {
        do {
            self.container = try ModelContainerFactory.makeReadWriteContainer()
            self.storeProblem = nil
            logger.info("ModelContainer ready")
        } catch {
            self.container = nil
            self.storeProblem = StoreOpenError.message(for: error)
            logger.error("Store not opened: \(String(describing: error), privacy: .public)")
        }
    }

    var body: some Scene {
        WindowGroup {
            if let container {
                mainWindow(container)
            } else {
                StoreProblemView(message: storeProblem ?? "")
            }
        }
        .commands {
            LegallasCommandMenu()
        }

        MenuBarExtra(AppSettings.appName, systemImage: "scalemass") {
            if let container {
                MenuBarQuickCapture()
                    .modelContainer(container)
            } else {
                StoreProblemView(message: storeProblem ?? "")
            }
        }
        .menuBarExtraStyle(.window)

        Settings {
            if let container {
                CaseSettingsView()
                    .modelContainer(container)
            } else {
                StoreProblemView(message: storeProblem ?? "")
            }
        }
    }

    private func mainWindow(_ container: ModelContainer) -> some View {
        RootView()
            .environment(documentStoreState)
            .modifier(InboxFolderObserver(controller: inboxWatcherController))
            .task { @MainActor in
                let context = ModelContext(container)
                do {
                    try Seeding.seedIfNeeded(context)
                } catch {
                    logger.error("Seeding failed: \(error.localizedDescription, privacy: .public)")
                }
                if let kase = try? context.fetch(FetchDescriptor<Case>()).first {
                    let store = DocumentStore(modelContext: context)
                    documentStoreState.staleDocuments = store.sweepBookmarks(for: kase)
                }
                await NotificationService.shared.requestAuthorization()
                await NotificationService.shared.reconcileAllPending(context: context)
            }
            .onReceive(NotificationCenter.default.publisher(for: NSApplication.willTerminateNotification)) { _ in
                inboxWatcherController.stop()
                AutoExporter.writeOnQuit(container: container)
            }
            .modelContainer(container)
    }
}
