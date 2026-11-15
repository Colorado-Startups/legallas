// SPDX-License-Identifier: Apache-2.0
import Foundation

public enum StatusStyle: String, CaseIterable, Sendable {
    case warning
    case positive
    case negative
    case emphasis
    case informational
    case accent
    case muted
    case neutral
}

public enum CountdownUrgency: String, CaseIterable, Sendable {
    case normal
    case soon
    case overdue
}

public enum CountdownClassifier {
    public static func urgency(days: Int, soonThreshold: Int = 7) -> CountdownUrgency {
        if days < 0 { return .overdue }
        if days < soonThreshold { return .soon }
        return .normal
    }
}
