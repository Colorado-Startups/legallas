// SPDX-License-Identifier: Apache-2.0
import SwiftUI

extension StatusStyle {
    var color: Color {
        switch self {
        case .warning: return .orange
        case .positive: return .green
        case .negative: return .red
        case .emphasis: return .purple
        case .informational: return .blue
        case .accent: return .indigo
        case .muted: return .yellow
        case .neutral: return .secondary
        }
    }
}

extension CountdownUrgency {
    var color: Color {
        switch self {
        case .normal: return .primary
        case .soon: return .orange
        case .overdue: return .red
        }
    }
}
