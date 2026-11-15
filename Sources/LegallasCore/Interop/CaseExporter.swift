// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData

/// Snapshot of a case and its records in plain, encodable form, written for Claude to read.
public struct CaseExportDTO: Codable, Sendable {
    /// When the export was made.
    public var exportedAt: Date
    /// Core details of the case.
    public var `case`: CaseDTO
    /// Parties and other contacts on the case.
    public var parties: [ContactDTO]
    /// Tasks on the case.
    public var tasks: [CaseTaskDTO]
    /// Deadlines on the case.
    public var deadlines: [DeadlineDTO]
    /// Claims asserted in the case.
    public var claims: [ClaimDTO]
    /// Notes on the case.
    public var notes: [NoteDTO]
    /// Chronology events on the case.
    public var events: [ChronologyEventDTO]
    /// Damages scenarios on the case.
    public var damagesScenarios: [DamagesScenarioDTO]
    /// Settlement offers on the case.
    public var settlementOffers: [SettlementOfferDTO]
    /// Discovery items on the case.
    public var discoveryItems: [DiscoveryItemDTO]
    /// Motions on the case.
    public var motions: [MotionDTO]

    /// Plain copy of the case record.
    public struct CaseDTO: Codable, Sendable {
        /// Case caption name.
        public var name: String
        /// Court's case number.
        public var caseNumber: String
        /// Name of the court.
        public var court: String
        /// Name of the assigned judge.
        public var judge: String
        /// Courtroom of the assigned judge.
        public var courtroom: String
        /// Date the case was filed.
        public var filingDate: Date
    }

    /// Plain copy of a contact.
    public struct ContactDTO: Codable, Sendable {
        /// Contact's full name.
        public var name: String
        /// Contact's role in the case.
        public var role: ContactRole
        /// Organization the contact belongs to, if known.
        public var organization: String?
        /// Contact's email address, if known.
        public var email: String?
        /// Contact's phone number, if known.
        public var phone: String?
    }

    /// Plain copy of a task.
    public struct CaseTaskDTO: Codable, Sendable {
        /// Short task title.
        public var title: String
        /// Longer task description.
        public var details: String
        /// Task progress state.
        public var status: TaskStatus
        /// How important the task is.
        public var priority: Priority
        /// Date the task is due, if set.
        public var dueDate: Date?
        /// Whether the user, Claude or an import created the task.
        public var source: DataSource
    }

    /// Plain copy of a deadline.
    public struct DeadlineDTO: Codable, Sendable {
        /// Short deadline title.
        public var title: String
        /// Event the deadline is counted from.
        public var anchor: AnchorEvent
        /// Days between the anchor and the deadline.
        public var offsetDays: Int
        /// Whether the deadline falls before or after the anchor.
        public var direction: DeadlineDirection
        /// Deadline date after calculation.
        public var computedDate: Date
        /// Whether the deadline has been met.
        public var isSatisfied: Bool
        /// Rule or statute the deadline comes from, if any.
        public var ruleCitation: String?
    }

    /// Plain copy of a claim.
    public struct ClaimDTO: Codable, Sendable {
        /// Kind of claim.
        public var type: ClaimType
        /// User-supplied label when the claim type is custom.
        public var customLabel: String?
        /// Text describing what must be proven for the claim.
        public var elements: String
        /// Whether the claim carries treble damages.
        public var isTrebleable: Bool
        /// Whether the claim is expected to survive summary judgment.
        public var isSurvivingSummaryJudgment: Bool
        /// Date the statute of limitations runs out, if known.
        public var statuteOfLimitations: Date?
    }

    /// Plain copy of a note.
    public struct NoteDTO: Codable, Sendable {
        /// Note title, if it has one.
        public var title: String?
        /// Note body in Markdown.
        public var bodyMarkdown: String
        /// When the note was created.
        public var createdAt: Date
        /// When the note was last changed.
        public var updatedAt: Date
        /// Whether the user, Claude or an import created the note.
        public var source: DataSource
    }

    /// Plain copy of a chronology event.
    public struct ChronologyEventDTO: Codable, Sendable {
        /// Short event title.
        public var title: String
        /// Date of the event.
        public var date: Date
        /// Kind of event.
        public var type: EventType
        /// Short description of what happened.
        public var summary: String
        /// Whether the user, Claude or an import created the event.
        public var source: DataSource
        /// Titles of the documents linked to the event.
        public var documentTitles: [String]
        /// Names of the contacts linked to the event.
        public var contactNames: [String]
        /// Titles of the notes linked to the event.
        public var noteTitles: [String]
    }

    /// Plain copy of a damages scenario, with the inputs and last computed results.
    public struct DamagesScenarioDTO: Codable, Sendable {
        /// Name given to the scenario.
        public var name: String
        /// Assumption tier of the scenario.
        public var tier: DamagesTier
        /// Fund assets under management at the start of the model.
        public var startingAUM: Decimal
        /// Yearly growth rate of the fund's assets.
        public var annualGrowthRate: Double
        /// Yearly management fee rate.
        public var managementFeeRate: Double
        /// Fraction of the management fee that goes to the claimant.
        public var claimantFeeShare: Double
        /// Carried interest rate.
        public var carryRate: Double
        /// Fraction of the carry allocated to partners.
        public var partnerAllocation: Double
        /// Fraction of the partner carry that goes to the claimant.
        public var claimantCarryShare: Double
        /// Rate used to discount cash flows.
        public var discountRate: Double
        /// Number of years modeled.
        public var horizonYears: Int
        /// Growth rate of cash flow after the modeled years.
        public var terminalGrowthRate: Double
        /// Flat lost distributions amount added to the result.
        public var lostDistributions: Decimal
        /// Flat governance premium amount added to the result.
        public var governancePremium: Decimal
        /// Net present value from the last calculation, if one was saved.
        public var cachedNPV: Decimal?
        /// Trebled net present value from the last calculation, if one was saved.
        public var cachedTrebledNPV: Decimal?
        /// When the saved results were calculated.
        public var computedAt: Date?
    }

    /// Plain copy of a settlement offer.
    public struct SettlementOfferDTO: Codable, Sendable {
        /// Date the offer was received.
        public var receivedAt: Date
        /// Party that made the offer.
        public var fromParty: String
        /// Total nominal amount offered.
        public var totalAmount: Decimal
        /// Cash paid at closing.
        public var cashAtClose: Decimal
        /// Amount of each yearly installment, if any.
        public var installmentAmount: Decimal?
        /// Number of yearly installments, if any.
        public var installmentYears: Int?
        /// Restrictive covenants attached to the offer.
        public var restrictiveCovenants: [String]
        /// Contingencies attached to the offer.
        public var contingencies: [String]
        /// Markdown summary of the offer's score, if it was scored.
        public var scoreSummaryMarkdown: String?
    }

    /// Plain copy of a discovery item.
    public struct DiscoveryItemDTO: Codable, Sendable {
        /// Kind of discovery request.
        public var category: DiscoveryCategory
        /// Whether the item was propounded by us or received.
        public var direction: DiscoveryDirection
        /// Number of the discovery set the item belongs to.
        public var setNumber: Int
        /// Number of the item within its set, if any.
        public var itemNumber: Int?
        /// What the item is about.
        public var subject: String
        /// Date the item was served.
        public var servedAt: Date
        /// Date a response is due, if set.
        public var dueAt: Date?
        /// Response state of the item.
        public var status: DiscoveryStatus
        /// Text of the response.
        public var responseText: String
        /// Free-text notes on the item.
        public var notes: String
        /// Titles of the documents linked to the item.
        public var linkedDocumentTitles: [String]
        /// Names of the contacts linked to the item.
        public var linkedContactNames: [String]
    }

    /// Plain copy of a motion.
    public struct MotionDTO: Codable, Sendable {
        /// Title of the motion.
        public var title: String
        /// Kind of motion.
        public var motionType: MotionType
        /// Which side filed the motion.
        public var filedBy: MotionFiler
        /// Date the motion was filed.
        public var filedAt: Date
        /// Date the response is due, if set.
        public var responseDueAt: Date?
        /// Date the reply is due, if set.
        public var replyDueAt: Date?
        /// Date and time of the hearing, if set.
        public var hearingAt: Date?
        /// Where the motion stands.
        public var status: MotionStatus
        /// Text of the court's ruling.
        public var ruling: String
        /// Free-text notes on the motion.
        public var notes: String
        /// Titles of the documents linked to the motion.
        public var linkedDocumentTitles: [String]
    }
}

/// Reads the case records and exports them.
public enum CaseExporter {

    /// Builds an export of the single case in the store, throwing if no case exists.
    @MainActor
    public static func export(from context: ModelContext) throws -> CaseExportDTO {
        let cases = try context.fetch(FetchDescriptor<Case>())
        guard let kase = cases.first else {
            throw CaseExporterError.noCase
        }

        let dto = CaseExportDTO(
            exportedAt: Date(),
            case: .init(
                name: kase.name,
                caseNumber: kase.caseNumber,
                court: kase.court,
                judge: kase.judge,
                courtroom: kase.courtroom,
                filingDate: kase.filingDate
            ),
            parties: kase.parties.map {
                .init(
                    name: $0.name,
                    role: $0.role,
                    organization: $0.organization,
                    email: $0.email,
                    phone: $0.phone
                )
            },
            tasks: kase.tasks.map {
                .init(
                    title: $0.title,
                    details: $0.details,
                    status: $0.status,
                    priority: $0.priority,
                    dueDate: $0.dueDate,
                    source: $0.source
                )
            },
            deadlines: kase.deadlines.map {
                .init(
                    title: $0.title,
                    anchor: $0.anchor,
                    offsetDays: $0.offsetDays,
                    direction: $0.direction,
                    computedDate: $0.computedDate,
                    isSatisfied: $0.isSatisfied,
                    ruleCitation: $0.ruleCitation
                )
            },
            claims: kase.claims.map {
                .init(
                    type: $0.type,
                    customLabel: $0.customLabel,
                    elements: $0.elements,
                    isTrebleable: $0.isTrebleable,
                    isSurvivingSummaryJudgment: $0.isSurvivingSummaryJudgment,
                    statuteOfLimitations: $0.statuteOfLimitations
                )
            },
            notes: kase.notes.map {
                .init(
                    title: $0.title,
                    bodyMarkdown: $0.bodyMarkdown,
                    createdAt: $0.createdAt,
                    updatedAt: $0.updatedAt,
                    source: $0.source
                )
            },
            events: kase.events.map { event in
                .init(
                    title: event.title,
                    date: event.date,
                    type: event.type,
                    summary: event.summary,
                    source: event.source,
                    documentTitles: event.documents.map(\.title),
                    contactNames: event.contacts.map(\.name),
                    noteTitles: event.notes.compactMap(\.title)
                )
            },
            damagesScenarios: kase.damagesScenarios.map { scenario in
                .init(
                    name: scenario.name,
                    tier: scenario.tier,
                    startingAUM: scenario.startingAUM,
                    annualGrowthRate: scenario.annualGrowthRate,
                    managementFeeRate: scenario.managementFeeRate,
                    claimantFeeShare: scenario.claimantFeeShare,
                    carryRate: scenario.carryRate,
                    partnerAllocation: scenario.partnerAllocation,
                    claimantCarryShare: scenario.claimantCarryShare,
                    discountRate: scenario.discountRate,
                    horizonYears: scenario.horizonYears,
                    terminalGrowthRate: scenario.terminalGrowthRate,
                    lostDistributions: scenario.lostDistributions,
                    governancePremium: scenario.governancePremium,
                    cachedNPV: scenario.cachedNPV,
                    cachedTrebledNPV: scenario.cachedTrebledNPV,
                    computedAt: scenario.computedAt
                )
            },
            settlementOffers: kase.settlementOffers.map { offer in
                .init(
                    receivedAt: offer.receivedAt,
                    fromParty: offer.fromParty,
                    totalAmount: offer.totalAmount,
                    cashAtClose: offer.cashAtClose,
                    installmentAmount: offer.installmentAmount,
                    installmentYears: offer.installmentYears,
                    restrictiveCovenants: offer.restrictiveCovenants,
                    contingencies: offer.contingencies,
                    scoreSummaryMarkdown: offer.scoreSummaryMarkdown
                )
            },
            discoveryItems: kase.discoveryItems.map { item in
                .init(
                    category: item.category,
                    direction: item.direction,
                    setNumber: item.setNumber,
                    itemNumber: item.itemNumber,
                    subject: item.subject,
                    servedAt: item.servedAt,
                    dueAt: item.dueAt,
                    status: item.status,
                    responseText: item.responseText,
                    notes: item.notes,
                    linkedDocumentTitles: item.documents.map(\.title),
                    linkedContactNames: item.contacts.map(\.name)
                )
            },
            motions: kase.motions.map { motion in
                .init(
                    title: motion.title,
                    motionType: motion.motionType,
                    filedBy: motion.filedBy,
                    filedAt: motion.filedAt,
                    responseDueAt: motion.responseDueAt,
                    replyDueAt: motion.replyDueAt,
                    hearingAt: motion.hearingAt,
                    status: motion.status,
                    ruling: motion.ruling,
                    notes: motion.notes,
                    linkedDocumentTitles: motion.documents.map(\.title)
                )
            }
        )
        return dto
    }

    /// Encodes an export as pretty-printed JSON with sorted keys and ISO 8601 dates.
    public static func encode(_ dto: CaseExportDTO) throws -> Data {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        e.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try e.encode(dto)
    }

    /// Exports the case from the store and writes it to a file as JSON, replacing any existing file in one step.
    @MainActor
    public static func writeExport(from context: ModelContext, to url: URL) throws {
        let dto = try export(from: context)
        let data = try encode(dto)
        try data.write(to: url, options: .atomic)
    }
}

/// Errors thrown while exporting a case.
public enum CaseExporterError: Error, CustomStringConvertible {
    case noCase

    /// Human-readable message for the error case.
    public var description: String {
        switch self {
        case .noCase: return "No Case row found in store"
        }
    }
}
