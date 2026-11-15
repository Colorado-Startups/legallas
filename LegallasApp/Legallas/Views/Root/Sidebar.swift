// SPDX-License-Identifier: Apache-2.0
import SwiftUI

struct Sidebar: View {
    @Binding var selection: SidebarSection?
    let pendingCount: Int

    var body: some View {
        List(selection: $selection) {
            ForEach(SidebarSection.allCases, id: \.self) { section in
                Label {
                    HStack {
                        Text(section.title)
                        Spacer()
                        if section == .inbox, pendingCount > 0 {
                            Text("\(pendingCount)")
                                .font(.caption)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.accentColor.opacity(0.2), in: Capsule())
                        }
                    }
                } icon: {
                    Image(systemName: section.systemImage)
                }
                .tag(section)
            }
        }
        .listStyle(.sidebar)
    }
}
