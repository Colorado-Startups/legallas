// SPDX-License-Identifier: Apache-2.0
import SwiftUI

struct LegallasCommandMenu: Commands {
    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("New Task") {
                NotificationCenter.default.post(name: .legallasNewTask, object: nil)
            }
            .keyboardShortcut("n", modifiers: .command)

            Button("New Deadline") {
                NotificationCenter.default.post(name: .legallasNewDeadline, object: nil)
            }
            .keyboardShortcut("n", modifiers: [.command, .shift])
        }

        CommandGroup(replacing: .importExport) {
            Button("Export Case JSON...") {
                NotificationCenter.default.post(name: .legallasExportCaseJSON, object: nil)
            }
            .keyboardShortcut("e", modifiers: [.command, .shift])
        }
    }
}

extension Notification.Name {
    static let legallasNewTask = Notification.Name("LegallasNewTask")
    static let legallasNewDeadline = Notification.Name("LegallasNewDeadline")
    static let legallasExportCaseJSON = Notification.Name("LegallasExportCaseJSON")
}
