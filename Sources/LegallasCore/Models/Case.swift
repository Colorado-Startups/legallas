// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData

/// A legal case: its court details, the folder holding its documents and every record that belongs to it.
@Model
public final class Case {
    /// Case caption name.
    public var name: String = ""
    /// Court's case number.
    public var caseNumber: String = ""
    /// Name of the court.
    public var court: String = ""
    /// Name of the assigned judge.
    public var judge: String = ""
    /// Courtroom of the assigned judge.
    public var courtroom: String = ""
    /// Date the case was filed; holds the not-filed placeholder until the case is filed.
    public var filingDate: Date = Date.distantPast

    /// Bookmark data that lets the app reopen the case documents folder.
    public var documentsFolderBookmark: Data?
    /// Path of the documents folder when it was last resolved.
    public var documentsFolderLastKnownPath: String?
    /// When the documents folder bookmark was last checked.
    public var documentsFolderLastVerifiedAt: Date?

    /// When the case record was created.
    public var createdAt: Date = Date()
    /// When the case record was last changed.
    public var updatedAt: Date = Date()

    /// Parties and other contacts on the case.
    @Relationship(deleteRule: .nullify, inverse: \Contact.cases)
    public var parties: [Contact] = []

    /// Tasks on the case.
    @Relationship(deleteRule: .nullify, inverse: \CaseTask.case)
    public var tasks: [CaseTask] = []

    /// Deadlines on the case.
    @Relationship(deleteRule: .nullify, inverse: \Deadline.case)
    public var deadlines: [Deadline] = []

    /// Documents filed under the case.
    @Relationship(deleteRule: .nullify, inverse: \Document.case)
    public var documents: [Document] = []

    /// Chronology events on the case.
    @Relationship(deleteRule: .nullify, inverse: \ChronologyEvent.case)
    public var events: [ChronologyEvent] = []

    /// Claims asserted in the case; deleted along with the case.
    @Relationship(deleteRule: .cascade, inverse: \Claim.case)
    public var claims: [Claim] = []

    /// Damages scenarios on the case; deleted along with the case.
    @Relationship(deleteRule: .cascade, inverse: \DamagesScenario.case)
    public var damagesScenarios: [DamagesScenario] = []

    /// Settlement offers on the case.
    @Relationship(deleteRule: .nullify, inverse: \SettlementOffer.case)
    public var settlementOffers: [SettlementOffer] = []

    /// Notes on the case.
    @Relationship(deleteRule: .nullify, inverse: \Note.case)
    public var notes: [Note] = []

    /// Proposals from Claude waiting for review, or already reviewed; deleted along with the case.
    @Relationship(deleteRule: .cascade, inverse: \InboxProposal.case)
    public var inboxProposals: [InboxProposal] = []

    /// Discovery items on the case; deleted along with the case.
    @Relationship(deleteRule: .cascade, inverse: \DiscoveryItem.case)
    public var discoveryItems: [DiscoveryItem] = []

    /// Motions on the case; deleted along with the case.
    @Relationship(deleteRule: .cascade, inverse: \Motion.case)
    public var motions: [Motion] = []

    /// Creates a case; the courtroom defaults to empty.
    public init(
        name: String,
        caseNumber: String,
        court: String,
        judge: String,
        courtroom: String = "",
        filingDate: Date
    ) {
        self.name = name
        self.caseNumber = caseNumber
        self.court = court
        self.judge = judge
        self.courtroom = courtroom
        self.filingDate = filingDate
        self.createdAt = Date()
        self.updatedAt = Date()
    }
}

extension Case {
    /// The `filingDate` of a matter that has not been filed. `filingDate` is not optional
    /// in schema V1, so the model's own default stands in for "not yet filed".
    public static let notFiledDate = Date.distantPast

    /// Whether `filingDate` is a real date; false while it holds `notFiledDate`.
    /// Computed, so it adds nothing to the stored schema.
    public var isFiled: Bool { filingDate > Case.notFiledDate }
}
