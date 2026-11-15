// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData
import LegallasCore

public struct ServerContext: Sendable {
    public let storeURL: URL
    public let inboxPaths: InboxPaths
}

@MainActor
public final class ContainerProvider {

    public let container: ModelContainer
    public let context: ModelContext
    public let serverContext: ServerContext

    public init(serverContext: ServerContext) throws {
        self.serverContext = serverContext
        self.container = try ModelContainerFactory.makeReadOnlyContainer(storeURL: serverContext.storeURL)
        self.context = ModelContext(self.container)
    }

    public init(serverContext: ServerContext, container: ModelContainer) {
        self.serverContext = serverContext
        self.container = container
        self.context = ModelContext(container)
    }
}
