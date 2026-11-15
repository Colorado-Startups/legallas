// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData

/// Creates the starting matter in an empty store: the room's own matter when this build
/// has one (see `RoomSeed`), otherwise the fictional sample, `SeedMatter.sample`.
///
/// `seedIfNeeded` writes only when the store has no `Case` row, so a store seeded
/// earlier keeps its rows; nothing here migrates or rewrites them.
public enum Seeding {

    /// Inserts the room's matter, its parties and its claims when the store has no `Case` yet.
    @MainActor
    public static func seedIfNeeded(_ context: ModelContext) throws {
        try seedIfNeeded(context, with: roomMatter)
    }

    /// Inserts `matter`, its parties and its claims when the store has no `Case` yet.
    /// Tests pass `.sample`, so they run on the same fictional matter in every build.
    @MainActor
    public static func seedIfNeeded(_ context: ModelContext, with matter: SeedMatter) throws {
        let existing = try context.fetch(FetchDescriptor<Case>())
        guard existing.isEmpty else { return }

        let kase = Case(
            name: matter.name,
            caseNumber: matter.caseNumber,
            court: matter.court,
            judge: matter.judge,
            courtroom: matter.courtroom,
            filingDate: matter.filingDate
        )
        context.insert(kase)

        for party in matter.parties {
            let contact = Contact(
                name: party.name,
                role: party.role,
                organization: party.organization,
                notesSummary: party.notesSummary
            )
            context.insert(contact)
            kase.parties.append(contact)
        }

        for seed in matter.claims {
            let claim = Claim(type: seed.type, elements: seed.elements, isTrebleable: seed.isTrebleable)
            context.insert(claim)
            kase.claims.append(claim)
        }

        try context.save()
    }
}

/// Where a room's own matter plugs in. A room seeds its matter by giving `Seeding` a
/// `public static var roomMatter` in a file of its own (for example `Seeding+Room.swift`);
/// that member then answers for this protocol's default. A build without one seeds the
/// fictional sample.
public protocol RoomSeed {
    /// The matter an empty store starts with, and its default documents folder.
    static var roomMatter: SeedMatter { get }
}

extension RoomSeed {
    /// No room matter in this build: the fictional sample.
    public static var roomMatter: SeedMatter { .sample }
}

extension Seeding: RoomSeed {}
