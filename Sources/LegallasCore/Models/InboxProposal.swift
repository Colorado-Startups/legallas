// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData

/// A change proposed through the inbox, kept with its review state and the record it produced.
@Model
public final class InboxProposal {
    /// Unique id shared with the proposal file in the inbox.
    /// Stored raw value of the proposal type.
    @Attribute(.unique) public var externalId: UUID = UUID()
    public var proposalTypeRaw: String = ProposalType.task.rawValue
    /// When the proposal was made.
    public var proposedAt: Date = Date()
    /// Reason given for the proposal, if any.
    public var rationale: String?
    /// The proposed content as JSON text.
    public var payloadJSON: String = "{}"
    /// Stored raw value of the proposal's review state.
    public var statusRaw: String = ProposalStatus.pending.rawValue
    /// When the proposal was accepted or rejected.
    public var reviewedAt: Date?
    /// Reason given when the proposal was rejected.
    public var rejectionReason: String?

    /// Task created by accepting the proposal.
    public var resultingTask: CaseTask?
    /// Deadline created by accepting the proposal.
    public var resultingDeadline: Deadline?
    /// Chronology event created by accepting the proposal.
    public var resultingEvent: ChronologyEvent?
    /// Note created by accepting the proposal.
    public var resultingNote: Note?
    /// Contact changed by accepting the proposal.
    public var resultingContact: Contact?
    /// Discovery item created by accepting the proposal.
    public var resultingDiscoveryItem: DiscoveryItem?
    /// Motion created by accepting the proposal.
    public var resultingMotion: Motion?

    /// Case the proposal belongs to.
    public var `case`: Case?

    /// Kind of record the proposal would create or change; an unreadable stored value reads as task.
    public var proposalType: ProposalType {
        get { ProposalType(rawValue: proposalTypeRaw) ?? .task }
        set { proposalTypeRaw = newValue.rawValue }
    }

    /// Review state of the proposal; an unreadable stored value reads as pending.
    public var status: ProposalStatus {
        get { ProposalStatus(rawValue: statusRaw) ?? .pending }
        set { statusRaw = newValue.rawValue }
    }

    /// Creates a proposal from its id, type and payload JSON; it starts out pending.
    public init(
        externalId: UUID,
        proposalType: ProposalType,
        proposedAt: Date = Date(),
        rationale: String? = nil,
        payloadJSON: String,
        status: ProposalStatus = .pending
    ) {
        self.externalId = externalId
        self.proposalTypeRaw = proposalType.rawValue
        self.proposedAt = proposedAt
        self.rationale = rationale
        self.payloadJSON = payloadJSON
        self.statusRaw = status.rawValue
    }
}
