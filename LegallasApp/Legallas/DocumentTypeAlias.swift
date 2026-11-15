// SPDX-License-Identifier: Apache-2.0
import LegallasCore

/// Pins `Document` in the app module to the SwiftData model in LegallasCore.
///
/// The macOS 27 SDK's SwiftUI exports its own `Document` protocol, which makes a bare
/// `Document` ambiguous in any file that imports both SwiftUI and LegallasCore. A
/// declaration in this module shadows both imports, so every existing use in the app
/// keeps resolving to `LegallasCore.Document` without per-file qualification.
public typealias Document = LegallasCore.Document
