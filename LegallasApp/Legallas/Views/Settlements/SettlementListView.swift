// SPDX-License-Identifier: Apache-2.0
import SwiftUI
import SwiftData
import LegallasCore

struct SettlementListView: View {

    @Environment(\.modelContext) private var modelContext
    @Query(sort: \SettlementOffer.receivedAt, order: .reverse) private var offers: [SettlementOffer]
    @Query private var scenarios: [DamagesScenario]
    @Query(sort: \Case.createdAt) private var cases: [Case]

    @State private var creating = false
    @State private var editing: SettlementOffer?

    var body: some View {
        NavigationStack {
            Group {
                if offers.isEmpty {
                    ContentUnavailableView(
                        "No offers yet",
                        systemImage: "scalemass",
                        description: Text("Log an offer to see its present value against the base-tier damages model.")
                    )
                } else {
                    List {
                        ForEach(offers) { offer in
                            Button {
                                editing = offer
                            } label: {
                                row(for: offer)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .navigationTitle("Settlements")
            .toolbar {
                ToolbarItem {
                    Button { creating = true } label: {
                        Label("New Offer", systemImage: "plus")
                    }
                    .disabled(cases.first == nil)
                }
            }
            .sheet(isPresented: $creating) {
                SettlementEditor(existing: nil, caseOwner: cases.first, baseScenario: baseScenario)
            }
            .sheet(item: $editing) { offer in
                SettlementEditor(existing: offer, caseOwner: cases.first, baseScenario: baseScenario)
            }
        }
    }

    private var baseScenario: DamagesScenario? {
        scenarios.first(where: { $0.tier == .base })
    }

    private func row(for offer: SettlementOffer) -> some View {
        let ratio = liveAdjustedRatio(for: offer)
        return HStack(alignment: .top, spacing: 14) {
            chip(ratio: ratio)
            VStack(alignment: .leading, spacing: 3) {
                Text(offer.fromParty)
                    .font(.subheadline.weight(.semibold))
                Text(Formatters.displayDate.string(from: offer.receivedAt))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                HStack(spacing: 12) {
                    Text("Total \(Formatters.formatMoney(offer.totalAmount))")
                    Text("Cash at close \(Formatters.formatMoney(offer.cashAtClose))")
                }
                .font(.caption)
            }
            Spacer()
            if let ratio {
                Text(String(format: "%.0f%%", ratio * 100))
                    .font(.headline)
                    .monospacedDigit()
            }
        }
        .padding(.vertical, 4)
    }

    private func chip(ratio: Double?) -> some View {
        Circle()
            .fill(color(for: ratio))
            .frame(width: 12, height: 12)
            .padding(.top, 6)
    }

    private func color(for ratio: Double?) -> Color {
        guard let ratio else { return .gray }
        switch ratio {
        case 0.80...: return .green
        case 0.50..<0.80: return .yellow
        case 0.25..<0.50: return .orange
        default: return .red
        }
    }

    private func liveAdjustedRatio(for offer: SettlementOffer) -> Double? {
        guard let base = baseScenario else { return nil }
        let score = SettlementScorer.score(
            offer: SettlementInputs(from: offer),
            against: DamagesInputs(from: base)
        )
        return score.adjustedRatio
    }
}
