// SPDX-License-Identifier: Apache-2.0
import SwiftUI
import SwiftData
import LegallasCore

struct MotionListView: View {

    @Environment(\.modelContext) private var modelContext
    @Query(sort: \Motion.filedAt) private var motions: [Motion]
    @Query(sort: \Case.createdAt) private var cases: [Case]

    @State private var creating = false
    @State private var editing: Motion?

    var body: some View {
        NavigationStack {
            Group {
                if motions.isEmpty {
                    ContentUnavailableView(
                        "No motions yet",
                        systemImage: "doc.text.below.ecg",
                        description: Text("Track MTDs, MSJs, motions to compel, motions in limine, and every ruling.")
                    )
                } else {
                    List {
                        let parts = MotionListLogic.partitioned(motions)
                        if !parts.ours.isEmpty {
                            Section("Our Motions") {
                                ForEach(parts.ours) { motion in
                                    Button {
                                        editing = motion
                                    } label: {
                                        MotionRow(motion: motion)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                        if !parts.theirs.isEmpty {
                            Section("Their Motions") {
                                ForEach(parts.theirs) { motion in
                                    Button {
                                        editing = motion
                                    } label: {
                                        MotionRow(motion: motion)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Motions")
            .toolbar {
                ToolbarItem {
                    Button { creating = true } label: {
                        Label("New Motion", systemImage: "plus")
                    }
                    .disabled(cases.first == nil)
                }
            }
            .sheet(isPresented: $creating) {
                MotionEditor(existing: nil, caseOwner: cases.first)
            }
            .sheet(item: $editing) { motion in
                MotionEditor(existing: motion, caseOwner: cases.first)
            }
        }
    }
}

private struct MotionRow: View {
    let motion: Motion

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(motion.title)
                    .font(.subheadline.weight(.semibold))
                HStack(spacing: 8) {
                    badge(text: motion.motionType.shortLabel, style: .informational)
                    badge(
                        text: motion.status.displayName,
                        style: MotionListLogic.statusStyle(for: motion.status)
                    )
                }
                Text("Filed \(Formatters.displayDate.string(from: motion.filedAt))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if !motion.ruling.isEmpty {
                    Text(motion.ruling)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
            Spacer()
            hearingView
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    private func badge(text: String, style: StatusStyle) -> some View {
        Text(text)
            .font(.caption2.weight(.medium))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(style.color.opacity(0.2), in: Capsule())
            .foregroundStyle(style.color)
    }

    @ViewBuilder
    private var hearingView: some View {
        if let countdown = MotionListLogic.hearingCountdown(to: motion.hearingAt) {
            VStack(alignment: .trailing, spacing: 2) {
                Text(countdown.days >= 0 ? "\(countdown.days)d" : "past")
                    .font(.headline.monospacedDigit())
                    .foregroundStyle(countdown.urgency.color)
                if let hearing = motion.hearingAt {
                    Text(Formatters.displayDate.string(from: hearing))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        } else {
            Text("No hearing")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
    }
}
