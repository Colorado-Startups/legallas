// SPDX-License-Identifier: Apache-2.0
import Foundation

/// A matter to seed into an empty store: the `Case` row, its parties and its claims, plus
/// the documents folder `LegallasMCP` falls back to when it is given no `--inbox`.
public struct SeedMatter: Sendable {

    /// One contact the seed adds to the case's parties.
    public struct Party: Sendable {
        /// The contact's name.
        public var name: String
        /// The contact's role in the matter.
        public var role: ContactRole
        /// The organization the contact acts for, if any.
        public var organization: String?
        /// A one-line note shown with the contact.
        public var notesSummary: String?

        /// Creates a party.
        public init(name: String, role: ContactRole, organization: String? = nil, notesSummary: String? = nil) {
            self.name = name
            self.role = role
            self.organization = organization
            self.notesSummary = notesSummary
        }
    }

    /// One claim the seed adds to the case.
    public struct ClaimSeed: Sendable {
        /// The claim's type.
        public var type: ClaimType
        /// The claim's elements, as shown in the app.
        public var elements: String
        /// Whether damages on the claim can be trebled.
        public var isTrebleable: Bool

        /// Creates a claim seed.
        public init(type: ClaimType, elements: String, isTrebleable: Bool) {
            self.type = type
            self.elements = elements
            self.isTrebleable = isTrebleable
        }
    }

    /// The matter's caption.
    public var name: String
    /// What the case number field holds. Before filing, it says why there is no number
    /// instead of leaving it blank.
    public var caseNumber: String
    /// The court, or the expected forum before filing.
    public var court: String
    /// The assigned judge; empty before one is assigned.
    public var judge: String
    /// The assigned courtroom; empty before one is assigned.
    public var courtroom: String
    /// The filing date, or `Case.notFiledDate` for a matter not yet filed.
    public var filingDate: Date
    /// The contacts added to the case's parties, in order.
    public var parties: [Party]
    /// The claims added to the case, in order.
    public var claims: [ClaimSeed]
    /// The matter's documents folder, relative to the home folder (for example
    /// `Documents/Legallas`). `LegallasMCP` uses it when it is given no `--inbox`.
    public var documentsFolder: String

    /// Creates a seed matter.
    public init(
        name: String,
        caseNumber: String,
        court: String,
        judge: String,
        courtroom: String,
        filingDate: Date,
        parties: [Party],
        claims: [ClaimSeed],
        documentsFolder: String
    ) {
        self.name = name
        self.caseNumber = caseNumber
        self.court = court
        self.judge = judge
        self.courtroom = courtroom
        self.filingDate = filingDate
        self.parties = parties
        self.claims = claims
        self.documentsFolder = documentsFolder
    }
}

extension SeedMatter {

    /// The fictional sample matter, Doe v. Harbor Labs, Inc.: a complaint counsel has not yet
    /// filed, with a plaintiff, two defendants, the customer in the dispute and one trebleable
    /// claim. Every name is invented; the people and companies match the counsel
    /// room's fictional fixture (`web/fixtures/matter.example.json`, control prefix `DOE`).
    public static var sample: SeedMatter {
        SeedMatter(
            name: "Doe v. Harbor Labs, Inc.",
            caseNumber: "Not yet filed",
            court: "District Court, Example County",
            judge: "",
            courtroom: "",
            filingDate: Case.notFiledDate,
            parties: [
                Party(
                    name: "Jane Doe",
                    role: .plaintiff,
                    organization: "Harbor Labs, Inc.",
                    notesSummary: "Co-founder and former CEO of Harbor Labs, Inc."
                ),
                Party(name: "Richard Roe", role: .defendant, notesSummary: "Richard Roe and Harbor Labs, Inc."),
                Party(name: "Mark Moe", role: .defendant, notesSummary: "Mark Moe and Alder Peak Ventures, L.P."),
                Party(
                    name: "Copperline Restaurant Group, Inc.",
                    role: .other,
                    notesSummary: "A customer named in the sales forecast."
                )
            ],
            claims: [
                ClaimSeed(
                    type: .breachContract,
                    elements: "Removal at a meeting called on two days' notice where the bylaws require ten (Example Rev. Stat. § 7-108-204)",
                    isTrebleable: false
                ),
                ClaimSeed(
                    type: .breachContract,
                    elements: "Buying back unvested shares at cost despite the acceleration clause (Example Rev. Stat. § 7-108-206)",
                    isTrebleable: false
                ),
                ClaimSeed(
                    type: .custom,
                    elements: "Final wages left unpaid after the removal (Example Rev. Stat. § 8-4-109)",
                    isTrebleable: true
                )
            ],
            documentsFolder: "Documents/Legallas"
        )
    }

    /// A fixed, invented date for dated test fixtures: 2012-12-18, the day the fictional fixture
    /// (`web/fixtures/matter.example.json`) files its complaint. Built in the app's court
    /// calendar. The sample itself is not filed, so it does not use it.
    public static var fixtureDate: Date {
        var dc = DateComponents()
        dc.year = 2012
        dc.month = 12
        dc.day = 18
        dc.timeZone = DateMath.denverTimeZone
        return DateMath.denverCalendar.date(from: dc) ?? Date()
    }
}
