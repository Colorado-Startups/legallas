// SPDX-License-Identifier: Apache-2.0
import Foundation
import Testing
@testable import Legallas

@Suite("SidebarRouting")
struct SidebarRoutingTests {

    @Test("SidebarSection.allCases contains the 11 expected sections in the expected order")
    func sidebarOrder() {
        let expected: [SidebarSection] = [
            .kanban, .deadlines, .chronology, .claims, .motions, .damages,
            .settlements, .discovery, .documents, .contacts, .inbox
        ]
        #expect(SidebarSection.allCases == expected)
    }

    @Test("Every SidebarSection has a non-empty title and systemImage")
    func titlesAndSymbols() {
        for section in SidebarSection.allCases {
            #expect(!section.title.isEmpty, "title empty for \(section)")
            #expect(!section.systemImage.isEmpty, "systemImage empty for \(section)")
        }
    }

    @Test("Phase 4 additions (discovery, motions) carry their expected SF Symbols")
    func phase4Symbols() {
        #expect(SidebarSection.discovery.systemImage == "magnifyingglass.circle")
        #expect(SidebarSection.motions.systemImage == "doc.text.below.ecg")
        #expect(SidebarSection.discovery.title == "Discovery")
        #expect(SidebarSection.motions.title == "Motions")
    }
}
