// SPDX-License-Identifier: Apache-2.0
import Foundation
import LegallasCore

public enum DiscoveryListLogic {

    public static func filter(
        _ items: [DiscoveryItem],
        direction: DiscoveryDirection?
    ) -> [DiscoveryItem] {
        guard let direction else { return items }
        return items.filter { $0.direction == direction }
    }

    public static func grouped(
        _ items: [DiscoveryItem]
    ) -> [(category: DiscoveryCategory, items: [DiscoveryItem])] {
        let byCategory = Dictionary(grouping: items) { $0.category }
        return DiscoveryCategory.allCases.compactMap { category in
            guard let bucket = byCategory[category], !bucket.isEmpty else { return nil }
            return (category, bucket)
        }
    }

    public static func headline(for item: DiscoveryItem) -> String {
        let setLabel = "\(item.category.shortLabel) Set \(item.setNumber)"
        if let n = item.itemNumber {
            return "\(setLabel) #\(n)"
        }
        return setLabel
    }

    public static func statusStyle(for status: DiscoveryStatus) -> StatusStyle {
        switch status {
        case .outstanding: return .warning
        case .responded: return .positive
        case .objected: return .negative
        case .motionPending: return .emphasis
        case .closed: return .neutral
        }
    }

    public static func directionStyle(for direction: DiscoveryDirection) -> StatusStyle {
        switch direction {
        case .propounded: return .informational
        case .received: return .accent
        }
    }

    public static func countdown(
        to dueDate: Date?,
        now: Date = Date()
    ) -> (days: Int, urgency: CountdownUrgency)? {
        guard let dueDate else { return nil }
        let days = DateMath.daysBetween(DateMath.startOfDay(now), DateMath.startOfDay(dueDate))
        return (days, CountdownClassifier.urgency(days: days))
    }
}
