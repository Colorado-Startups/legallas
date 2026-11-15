// SPDX-License-Identifier: Apache-2.0
import Foundation

/// Progress state of a case task.
public enum TaskStatus: String, Codable, CaseIterable, Sendable {
    case toDo
    case inProgress
    case waiting
    case done

    /// Label shown in the interface for each task status.
    public var displayName: String {
        switch self {
        case .toDo: return "To Do"
        case .inProgress: return "In Progress"
        case .waiting: return "Waiting"
        case .done: return "Done"
        }
    }
}

/// Importance level of a task or similar item.
public enum Priority: String, Codable, CaseIterable, Sendable {
    case low, medium, high, critical

    /// Label shown in the interface for each priority.
    public var displayName: String {
        switch self {
        case .low: return "Low"
        case .medium: return "Medium"
        case .high: return "High"
        case .critical: return "Critical"
        }
    }
}

/// Role a contact plays in a case.
public enum ContactRole: String, Codable, CaseIterable, Sendable {
    case plaintiff
    case defendant
    case plaintiffCounsel
    case defenseCounsel
    case expert
    case witness
    case courtStaff
    case vendor
    case other

    /// Label shown in the interface for each contact role.
    public var displayName: String {
        switch self {
        case .plaintiff: return "Plaintiff"
        case .defendant: return "Defendant"
        case .plaintiffCounsel: return "Plaintiff's Counsel"
        case .defenseCounsel: return "Defense Counsel"
        case .expert: return "Expert"
        case .witness: return "Witness"
        case .courtStaff: return "Court Staff"
        case .vendor: return "Vendor"
        case .other: return "Other"
        }
    }
}

/// Kind of entry on a case chronology.
public enum EventType: String, Codable, CaseIterable, Sendable {
    case filing
    case service
    case pleading
    case discovery
    case meeting
    case communication
    case milestone
    case deadline
    case order
    case custom
}

/// Case event that a deadline's offset is counted from.
public enum AnchorEvent: String, Codable, CaseIterable, Sendable {
    case filing
    case service
    case answer
    case atIssue
    case cmc
    case trial
    case custom
}

/// Whether a deadline falls before or after its anchor date.
public enum DeadlineDirection: String, Codable, CaseIterable, Sendable {
    case before
    case after
}

/// Kind of claim asserted in a case.
public enum ClaimType: String, Codable, CaseIterable, Sendable {
    case stateRacketeering
    case civilTheft
    case breachContract
    case breachFiduciaryDuty
    case fraud
    case conversion
    case unjustEnrichment
    case custom
}

/// Assumption tier of a damages scenario, from conservative to aggressive.
public enum DamagesTier: String, Codable, CaseIterable, Sendable {
    case conservative
    case base
    case aggressive
}

/// Review state of a proposal in the inbox.
public enum ProposalStatus: String, Codable, CaseIterable, Sendable {
    case pending
    case accepted
    case rejected
}

/// Kind of record that an inbox proposal would create or change.
public enum ProposalType: String, Codable, CaseIterable, Sendable {
    case task
    case deadline
    case event
    case note
    case contactUpdate
    case discoveryItem
    case motion
}

/// Origin of a record: entered by the user, proposed by Claude, or imported.
public enum DataSource: String, Codable, CaseIterable, Sendable {
    case user
    case claude
    case importer
}

/// Kind of discovery request or process.
public enum DiscoveryCategory: String, Codable, CaseIterable, Sendable {
    case interrogatories
    case rfp
    case rfa
    case deposition
    case subpoena

    /// Full label shown in the interface for each discovery category.
    public var displayName: String {
        switch self {
        case .interrogatories: return "Interrogatories"
        case .rfp: return "Requests for Production"
        case .rfa: return "Requests for Admission"
        case .deposition: return "Deposition"
        case .subpoena: return "Subpoena"
        }
    }

    /// Short abbreviation for each discovery category.
    public var shortLabel: String {
        switch self {
        case .interrogatories: return "ROG"
        case .rfp: return "RFP"
        case .rfa: return "RFA"
        case .deposition: return "Depo"
        case .subpoena: return "Subpoena"
        }
    }
}

/// Whether a discovery item was sent by us or received from another party.
public enum DiscoveryDirection: String, Codable, CaseIterable, Sendable {
    case propounded
    case received

    /// Label shown in the interface for each discovery direction.
    public var displayName: String {
        switch self {
        case .propounded: return "Propounded"
        case .received: return "Received"
        }
    }
}

/// Response state of a discovery item.
public enum DiscoveryStatus: String, Codable, CaseIterable, Sendable {
    case outstanding
    case responded
    case objected
    case motionPending
    case closed

    /// Label shown in the interface for each discovery status.
    public var displayName: String {
        switch self {
        case .outstanding: return "Outstanding"
        case .responded: return "Responded"
        case .objected: return "Objected"
        case .motionPending: return "Motion Pending"
        case .closed: return "Closed"
        }
    }
}

/// Kind of motion filed in a case.
public enum MotionType: String, Codable, CaseIterable, Sendable {
    case dismiss
    case summaryJudgment
    case compel
    case protective
    case limineMine
    case limineThem
    case continuance
    case custom

    /// Full label shown in the interface for each motion type.
    public var displayName: String {
        switch self {
        case .dismiss: return "Motion to Dismiss"
        case .summaryJudgment: return "Summary Judgment"
        case .compel: return "Motion to Compel"
        case .protective: return "Protective Order"
        case .limineMine: return "Motion in Limine (Ours)"
        case .limineThem: return "Motion in Limine (Theirs)"
        case .continuance: return "Continuance"
        case .custom: return "Custom"
        }
    }

    /// Short abbreviation for each motion type.
    public var shortLabel: String {
        switch self {
        case .dismiss: return "MTD"
        case .summaryJudgment: return "MSJ"
        case .compel: return "MTC"
        case .protective: return "PO"
        case .limineMine: return "MIL"
        case .limineThem: return "MIL"
        case .continuance: return "Cont."
        case .custom: return "Motion"
        }
    }
}

/// Which side filed a motion.
public enum MotionFiler: String, Codable, CaseIterable, Sendable {
    case us
    case opponent

    /// Label shown in the interface for each motion filer.
    public var displayName: String {
        switch self {
        case .us: return "Us"
        case .opponent: return "Opponent"
        }
    }
}

/// Where a motion stands, from pending through ruling or withdrawal.
public enum MotionStatus: String, Codable, CaseIterable, Sendable {
    case pending
    case responseFiled
    case replyFiled
    case argued
    case granted
    case denied
    case grantedInPart
    case withdrawn

    /// Label shown in the interface for each motion status.
    public var displayName: String {
        switch self {
        case .pending: return "Pending"
        case .responseFiled: return "Response Filed"
        case .replyFiled: return "Reply Filed"
        case .argued: return "Argued"
        case .granted: return "Granted"
        case .denied: return "Denied"
        case .grantedInPart: return "Granted in Part"
        case .withdrawn: return "Withdrawn"
        }
    }
}
