// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData
import LegallasCore

@MainActor
@Observable
final class KanbanDragState {
    var draggedTask: CaseTask?
}
