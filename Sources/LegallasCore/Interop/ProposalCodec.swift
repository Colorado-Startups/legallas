// SPDX-License-Identifier: Apache-2.0
import Foundation

/// Proposed task, as carried inside a proposal file.
public struct TaskPayload: Codable, Sendable {
    /// Short task title.
    public var title: String
    /// Longer task description, if given.
    public var details: String?
    /// Task progress state, if given.
    public var status: TaskStatus?
    /// Task priority, if given.
    public var priority: Priority?
    /// Date the task is due, if given.
    public var dueDate: Date?
    /// Id of the proposed deadline this task belongs to, if any.
    public var deadlineExternalId: UUID?

    /// Creates a task payload; everything except the title is optional.
    public init(
        title: String,
        details: String? = nil,
        status: TaskStatus? = nil,
        priority: Priority? = nil,
        dueDate: Date? = nil,
        deadlineExternalId: UUID? = nil
    ) {
        self.title = title
        self.details = details
        self.status = status
        self.priority = priority
        self.dueDate = dueDate
        self.deadlineExternalId = deadlineExternalId
    }
}

/// Proposed deadline, as carried inside a proposal file.
public struct DeadlinePayload: Codable, Sendable {
    /// Short deadline title.
    public var title: String
    /// Event the deadline is counted from.
    public var anchor: AnchorEvent
    /// Date of the anchor event, if known.
    public var anchorDate: Date?
    /// Label for the anchor when it is a custom event.
    public var customAnchorLabel: String?
    /// Days between the anchor and the deadline.
    public var offsetDays: Int
    /// Whether the deadline falls before or after the anchor.
    public var direction: DeadlineDirection
    /// Rule or statute the deadline comes from, if any.
    public var ruleCitation: String?
    /// Free-text notes on the deadline.
    public var notes: String?

    /// Creates a deadline payload; direction defaults to after the anchor.
    public init(
        title: String,
        anchor: AnchorEvent,
        anchorDate: Date? = nil,
        customAnchorLabel: String? = nil,
        offsetDays: Int,
        direction: DeadlineDirection = .after,
        ruleCitation: String? = nil,
        notes: String? = nil
    ) {
        self.title = title
        self.anchor = anchor
        self.anchorDate = anchorDate
        self.customAnchorLabel = customAnchorLabel
        self.offsetDays = offsetDays
        self.direction = direction
        self.ruleCitation = ruleCitation
        self.notes = notes
    }
}

/// Proposed chronology event, as carried inside a proposal file.
public struct EventPayload: Codable, Sendable {
    /// Short event title.
    public var title: String
    /// Date of the event.
    public var date: Date
    /// Kind of event.
    public var type: EventType
    /// Short description of what happened.
    public var summary: String

    /// Creates an event payload from its four fields.
    public init(title: String, date: Date, type: EventType, summary: String) {
        self.title = title
        self.date = date
        self.type = type
        self.summary = summary
    }
}

/// Proposed note, as carried inside a proposal file.
public struct NotePayload: Codable, Sendable {
    /// Note title, if it has one.
    public var title: String?
    /// Note body in Markdown.
    public var bodyMarkdown: String

    /// Creates a note payload; the title is optional.
    public init(title: String? = nil, bodyMarkdown: String) {
        self.title = title
        self.bodyMarkdown = bodyMarkdown
    }
}

/// Proposed change to an existing contact, as carried inside a proposal file.
public struct ContactUpdatePayload: Codable, Sendable {
    /// Name of the contact to change.
    public var contactName: String
    /// Contact fields to change, keyed by field name, with their new text values.
    public var fields: [String: String]

    /// Creates a contact update payload.
    public init(contactName: String, fields: [String: String]) {
        self.contactName = contactName
        self.fields = fields
    }
}

/// Proposed discovery item, as carried inside a proposal file.
public struct DiscoveryItemPayload: Codable, Sendable {
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
    /// Date a response is due, if known.
    public var dueAt: Date?
    /// Response state of the item, if given.
    public var status: DiscoveryStatus?
    /// Text of the response, if given.
    public var responseText: String?
    /// Free-text notes, if given.
    public var notes: String?
    /// Titles of the documents to link to the item.
    public var documentTitles: [String]?
    /// Names of the contacts to link to the item.
    public var contactNames: [String]?

    /// Creates a discovery item payload; fields after the subject and served date are optional.
    public init(
        category: DiscoveryCategory,
        direction: DiscoveryDirection,
        setNumber: Int,
        itemNumber: Int? = nil,
        subject: String,
        servedAt: Date,
        dueAt: Date? = nil,
        status: DiscoveryStatus? = nil,
        responseText: String? = nil,
        notes: String? = nil,
        documentTitles: [String]? = nil,
        contactNames: [String]? = nil
    ) {
        self.category = category
        self.direction = direction
        self.setNumber = setNumber
        self.itemNumber = itemNumber
        self.subject = subject
        self.servedAt = servedAt
        self.dueAt = dueAt
        self.status = status
        self.responseText = responseText
        self.notes = notes
        self.documentTitles = documentTitles
        self.contactNames = contactNames
    }
}

/// Proposed motion, as carried inside a proposal file.
public struct MotionPayload: Codable, Sendable {
    /// Title of the motion.
    public var title: String
    /// Kind of motion.
    public var motionType: MotionType
    /// Which side filed the motion.
    public var filedBy: MotionFiler
    /// Date the motion was filed.
    public var filedAt: Date
    /// Date the response is due, if known.
    public var responseDueAt: Date?
    /// Date the reply is due, if known.
    public var replyDueAt: Date?
    /// Date and time of the hearing, if known.
    public var hearingAt: Date?
    /// Where the motion stands, if given.
    public var status: MotionStatus?
    /// Text of the court's ruling, if given.
    public var ruling: String?
    /// Free-text notes, if given.
    public var notes: String?
    /// Titles of the documents to link to the motion.
    public var documentTitles: [String]?

    /// Creates a motion payload; fields after the filing date are optional.
    public init(
        title: String,
        motionType: MotionType,
        filedBy: MotionFiler,
        filedAt: Date,
        responseDueAt: Date? = nil,
        replyDueAt: Date? = nil,
        hearingAt: Date? = nil,
        status: MotionStatus? = nil,
        ruling: String? = nil,
        notes: String? = nil,
        documentTitles: [String]? = nil
    ) {
        self.title = title
        self.motionType = motionType
        self.filedBy = filedBy
        self.filedAt = filedAt
        self.responseDueAt = responseDueAt
        self.replyDueAt = replyDueAt
        self.hearingAt = hearingAt
        self.status = status
        self.ruling = ruling
        self.notes = notes
        self.documentTitles = documentTitles
    }
}

/// One proposal as written to or read from a proposal file: id, type, status and the typed payload.
public struct ProposalEnvelope: Sendable {
    /// Unique id of the proposal, also used in its file name.
    public let id: UUID
    /// Kind of record the proposal would create or change.
    public let type: ProposalType
    /// When the proposal was made.
    public let proposedAt: Date
    /// Who made the proposal; defaults to claude.
    public let source: String
    /// Reason given for the proposal, if any.
    public let rationale: String?
    /// Review state of the proposal.
    public let status: ProposalStatus
    /// Proposed content, matching the proposal type.
    public let payload: Payload

    /// The proposed content, one case for each proposal type.
    public enum Payload: Sendable {
        case task(TaskPayload)
        case deadline(DeadlinePayload)
        case event(EventPayload)
        case note(NotePayload)
        case contactUpdate(ContactUpdatePayload)
        case discoveryItem(DiscoveryItemPayload)
        case motion(MotionPayload)
    }

    /// Creates an envelope; id, time, source and status default to a new id, now, claude and pending.
    public init(
        id: UUID = UUID(),
        type: ProposalType,
        proposedAt: Date = Date(),
        source: String = "claude",
        rationale: String? = nil,
        status: ProposalStatus = .pending,
        payload: Payload
    ) {
        self.id = id
        self.type = type
        self.proposedAt = proposedAt
        self.source = source
        self.rationale = rationale
        self.status = status
        self.payload = payload
    }
}

extension ProposalEnvelope: Codable {
    private enum CodingKeys: String, CodingKey {
        case id, type, proposedAt, source, rationale, status, payload
    }

    /// Decodes an envelope, choosing the payload type from the proposal type field.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try c.decode(UUID.self, forKey: .id)
        self.type = try c.decode(ProposalType.self, forKey: .type)
        self.proposedAt = try c.decode(Date.self, forKey: .proposedAt)
        self.source = try c.decode(String.self, forKey: .source)
        self.rationale = try c.decodeIfPresent(String.self, forKey: .rationale)
        self.status = try c.decode(ProposalStatus.self, forKey: .status)

        switch self.type {
        case .task:
            self.payload = .task(try c.decode(TaskPayload.self, forKey: .payload))
        case .deadline:
            self.payload = .deadline(try c.decode(DeadlinePayload.self, forKey: .payload))
        case .event:
            self.payload = .event(try c.decode(EventPayload.self, forKey: .payload))
        case .note:
            self.payload = .note(try c.decode(NotePayload.self, forKey: .payload))
        case .contactUpdate:
            self.payload = .contactUpdate(try c.decode(ContactUpdatePayload.self, forKey: .payload))
        case .discoveryItem:
            self.payload = .discoveryItem(try c.decode(DiscoveryItemPayload.self, forKey: .payload))
        case .motion:
            self.payload = .motion(try c.decode(MotionPayload.self, forKey: .payload))
        }
    }

    /// Encodes an envelope, writing the payload under the key payload.
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(type, forKey: .type)
        try c.encode(proposedAt, forKey: .proposedAt)
        try c.encode(source, forKey: .source)
        try c.encodeIfPresent(rationale, forKey: .rationale)
        try c.encode(status, forKey: .status)
        switch payload {
        case .task(let p):           try c.encode(p, forKey: .payload)
        case .deadline(let p):       try c.encode(p, forKey: .payload)
        case .event(let p):          try c.encode(p, forKey: .payload)
        case .note(let p):           try c.encode(p, forKey: .payload)
        case .contactUpdate(let p):  try c.encode(p, forKey: .payload)
        case .discoveryItem(let p):  try c.encode(p, forKey: .payload)
        case .motion(let p):         try c.encode(p, forKey: .payload)
        }
    }
}

/// Reads and writes proposal files as JSON.
public enum ProposalCodec {

    /// Returns a JSON encoder that writes ISO 8601 dates, pretty-printed with sorted keys.
    public static func encoder() -> JSONEncoder {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        e.outputFormatting = [.prettyPrinted, .sortedKeys]
        return e
    }

    /// Returns a JSON decoder that reads ISO 8601 dates.
    public static func decoder() -> JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }

    /// Encodes a proposal envelope to JSON data.
    public static func encode(_ envelope: ProposalEnvelope) throws -> Data {
        try encoder().encode(envelope)
    }

    /// Decodes JSON data into a proposal envelope.
    public static func decode(_ data: Data) throws -> ProposalEnvelope {
        try decoder().decode(ProposalEnvelope.self, from: data)
    }

    /// Encodes a proposal envelope to a JSON string.
    public static func payloadJSONString(_ envelope: ProposalEnvelope) throws -> String {
        let data = try encode(envelope)
        return String(decoding: data, as: UTF8.self)
    }
}
