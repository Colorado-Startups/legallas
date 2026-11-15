// SPDX-License-Identifier: Apache-2.0
import SwiftUI
import SwiftData
import LegallasCore

struct ClaimsListView: View {

    @Environment(\.modelContext) private var modelContext
    @Query(sort: \Claim.typeRaw) private var claims: [Claim]
    @Query(sort: \Case.createdAt) private var cases: [Case]

    @State private var creating = false
    @State private var editing: Claim?

    var body: some View {
        NavigationStack {
            Group {
                if claims.isEmpty {
                    ContentUnavailableView(
                        "No claims yet",
                        systemImage: "checkmark.seal",
                        description: Text("Log each claim with its treble flag, summary judgment view, and statute of limitations.")
                    )
                } else {
                    List {
                        ForEach(grouped, id: \.type) { section in
                            Section(section.type.displayName) {
                                ForEach(section.claims) { claim in
                                    Button {
                                        editing = claim
                                    } label: {
                                        ClaimRow(claim: claim)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Claims")
            .toolbar {
                ToolbarItem {
                    Button { creating = true } label: {
                        Label("New Claim", systemImage: "plus")
                    }
                    .disabled(cases.first == nil)
                }
            }
            .sheet(isPresented: $creating) {
                ClaimEditor(existing: nil, caseOwner: cases.first)
            }
            .sheet(item: $editing) { claim in
                ClaimEditor(existing: claim, caseOwner: cases.first)
            }
        }
    }

    private struct ClaimSection {
        let type: ClaimType
        let claims: [Claim]
    }

    private var grouped: [ClaimSection] {
        let byType = Dictionary(grouping: claims) { $0.type }
        return ClaimType.allCases.compactMap { type in
            guard let items = byType[type], !items.isEmpty else { return nil }
            return ClaimSection(type: type, claims: items)
        }
    }
}

private struct ClaimRow: View {
    let claim: Claim

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(displayLabel)
                    .font(.subheadline.weight(.semibold))
                if !claim.elements.isEmpty {
                    Text(claim.elements)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                HStack(spacing: 8) {
                    if claim.isTrebleable {
                        badge(text: "Trebleable", color: .purple)
                    }
                    if claim.isSurvivingSummaryJudgment {
                        badge(text: "Survives SJ", color: .green)
                    } else {
                        badge(text: "At-risk on SJ", color: .red)
                    }
                }
            }
            Spacer()
            solCountdownView
        }
        .padding(.vertical, 4)
    }

    private var displayLabel: String {
        if let custom = claim.customLabel, !custom.isEmpty { return custom }
        return claim.type.displayName
    }

    private func badge(text: String, color: Color) -> some View {
        Text(text)
            .font(.caption2.weight(.medium))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.2), in: Capsule())
            .foregroundStyle(color)
    }

    @ViewBuilder
    private var solCountdownView: some View {
        if let sol = claim.statuteOfLimitations {
            let days = DateMath.daysBetween(DateMath.startOfDay(Date()), DateMath.startOfDay(sol))
            VStack(alignment: .trailing, spacing: 2) {
                Text(days >= 0 ? "\(days)d" : "expired")
                    .font(.headline.monospacedDigit())
                    .foregroundStyle(days < 0 ? Color.red : days < 30 ? .orange : .primary)
                Text(Formatters.displayDate.string(from: sol))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        } else {
            Text("No SOL")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
    }
}

private extension ClaimType {
    var displayName: String {
        switch self {
        case .stateRacketeering: return AppSettings.stateRacketeeringLabel
        case .civilTheft: return "Civil theft"
        case .breachContract: return "Breach of contract"
        case .breachFiduciaryDuty: return "Breach of fiduciary duty"
        case .fraud: return "Fraud"
        case .conversion: return "Conversion"
        case .unjustEnrichment: return "Unjust enrichment"
        case .custom: return "Custom claim"
        }
    }
}
