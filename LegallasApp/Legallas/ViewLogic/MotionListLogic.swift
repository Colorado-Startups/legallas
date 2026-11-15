// SPDX-License-Identifier: Apache-2.0
import Foundation
import LegallasCore

public enum MotionListLogic {

    public static func filter(_ motions: [Motion], filedBy: MotionFiler?) -> [Motion] {
        guard let filedBy else { return motions }
        return motions.filter { $0.filedBy == filedBy }
    }

    public static func partitioned(_ motions: [Motion]) -> (ours: [Motion], theirs: [Motion]) {
        let ours = motions.filter { $0.filedBy == .us }
        let theirs = motions.filter { $0.filedBy == .opponent }
        return (ours, theirs)
    }

    public static func statusStyle(for status: MotionStatus) -> StatusStyle {
        switch status {
        case .pending: return .warning
        case .responseFiled, .replyFiled: return .neutral
        case .argued: return .informational
        case .granted: return .positive
        case .denied: return .negative
        case .grantedInPart: return .muted
        case .withdrawn: return .neutral
        }
    }

    public static func hearingCountdown(
        to hearingAt: Date?,
        now: Date = Date()
    ) -> (days: Int, urgency: CountdownUrgency)? {
        guard let hearingAt else { return nil }
        let days = DateMath.daysBetween(DateMath.startOfDay(now), DateMath.startOfDay(hearingAt))
        return (days, CountdownClassifier.urgency(days: days))
    }
}
