// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData

/// Version 1.0.0 of the Legallas SwiftData schema: the baseline every store starts from.
///
/// What changed: nothing, this is the initial schema. It shipped in Phase 1 (2026-04-17)
/// with twelve models, and Phase 4 (2026-04-20) appended `DiscoveryItem` and `Motion`
/// to this same version rather than introducing a V2.
/// Why: a versioned baseline gives `LegallasMigrationPlan` a starting point, so future
/// model changes can land as a new `LegallasSchemaV2` plus a `MigrationStage` instead of
/// editing this list in place.
public enum LegallasSchemaV1: VersionedSchema {
    /// Version number of this schema, 1.0.0.
    public static var versionIdentifier: Schema.Version { Schema.Version(1, 0, 0) }

    /// Every model type stored under this schema version.
    public static var models: [any PersistentModel.Type] {
        [
            Case.self,
            CaseTask.self,
            Deadline.self,
            Reminder.self,
            Claim.self,
            Note.self,
            InboxProposal.self,
            Contact.self,
            Document.self,
            ChronologyEvent.self,
            DamagesScenario.self,
            SettlementOffer.self,
            DiscoveryItem.self,
            Motion.self
        ]
    }
}

/// Ordered history of Legallas schema versions and the stages that migrate between them.
///
/// Only `ModelContainerFactory.makeReadWriteContainer` passes this plan, because the app
/// is the sole writer. The MCP server's read-only container and the in-memory test
/// container open the current schema directly and never run a migration.
public enum LegallasMigrationPlan: SchemaMigrationPlan {
    // Every schema version the app has shipped, oldest first. V1 is the only version
    // so far; append each new version here when the schema changes.
    /// Every schema version the app has shipped, oldest first; currently only version one.
    public static var schemas: [any VersionedSchema.Type] {
        [LegallasSchemaV1.self]
    }

    // One stage per adjacent pair in `schemas`, explaining what it changes and why.
    // Empty because V1 is the only version, so there is nothing to migrate from yet.
    /// Migration stages between schema versions; empty because there is only one version.
    public static var stages: [MigrationStage] { [] }
}
