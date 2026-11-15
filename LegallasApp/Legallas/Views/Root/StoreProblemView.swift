// SPDX-License-Identifier: Apache-2.0
import SwiftUI
import LegallasCore

/// Shown in place of the app when its store did not open, so a person reads why instead of the app quitting at launch.
/// The store has not been changed.
struct StoreProblemView: View {
    let message: String

    var body: some View {
        ContentUnavailableView {
            Label("Case data not opened", systemImage: "exclamationmark.triangle")
        } description: {
            Text(message)
                .textSelection(.enabled)
        } actions: {
            Button("Quit \(AppSettings.appName)") {
                NSApplication.shared.terminate(nil)
            }
        }
        .frame(minWidth: 420, minHeight: 280)
    }
}
