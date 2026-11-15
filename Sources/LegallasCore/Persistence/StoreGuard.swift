// SPDX-License-Identifier: Apache-2.0
import CoreData
import Foundation
import SwiftData

/// Why a store was left unopened.
public enum StoreOpenError: Error, CustomStringConvertible, Equatable {
    /// The store holds a shape this build does not know, and opening it could lose stored fields.
    case unknownShape(path: String)
    /// This build's models could not be turned into a model to compare the store with.
    case noModel

    /// Message shown to the person when the store was not opened.
    public var description: String {
        switch self {
        case .unknownShape(let path):
            return "This version of \(AppSettings.appName) does not recognise the case data at \(path), so it did not open it and has not changed it. Install the version that wrote it, or ask whoever set up this app."
        case .noModel:
            return "This version of \(AppSettings.appName) could not check its case data, so it did not open it and has not changed it."
        }
    }

    /// What to tell the person when the app's store did not open, whatever the reason.
    public static func message(for error: any Error) -> String {
        if let refused = error as? StoreOpenError { return refused.description }
        return "\(AppSettings.appName) could not open its case data: \(error.localizedDescription)"
    }
}

/// Stops the app opening a store it would damage.
///
/// When a store's shape differs from the build's models, SwiftData infers a migration, and a stored field the
/// models no longer name is dropped with no error: the app opens normally and the values are gone. So before a
/// read-write open, the store must be in the shape of one of the given model sets: the versions in
/// `LegallasMigrationPlan`, whose stages then migrate it.
///
/// Anything else throws `StoreOpenError.unknownShape`, with the store unchanged, and that includes a change SwiftData
/// could have inferred safely, such as an added field: a change to the models needs a schema version, so an unknown
/// shape is never expected. A file that is not there passes: SwiftData creates it.
public enum StoreGuard {

    /// Throws unless the store at the URL matches one of the given model sets; a missing file passes.
    public static func check(storeURL: URL, modelSets: [[any PersistentModel.Type]]) throws {
        guard FileManager.default.fileExists(atPath: storeURL.path) else { return }
        let metadata = try NSPersistentStoreCoordinator.metadataForPersistentStore(type: .sqlite, at: storeURL)
        for models in modelSets {
            guard let model = NSManagedObjectModel.makeManagedObjectModel(for: models) else {
                throw StoreOpenError.noModel
            }
            if model.isConfiguration(withName: nil, compatibleWithStoreMetadata: metadata) { return }
        }
        throw StoreOpenError.unknownShape(path: storeURL.path)
    }
}
