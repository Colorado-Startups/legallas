// SPDX-License-Identifier: Apache-2.0
import SwiftUI
import SwiftData
import LegallasCore

struct DamagesListView: View {

    @Environment(\.modelContext) private var modelContext
    @Query(sort: \DamagesScenario.name) private var scenarios: [DamagesScenario]
    @Query(sort: \Case.createdAt) private var cases: [Case]

    @State private var creating = false
    @State private var selected: DamagesScenario?

    var body: some View {
        NavigationStack {
            ScrollView {
                HStack(alignment: .top, spacing: 16) {
                    column(for: .conservative)
                    column(for: .base)
                    column(for: .aggressive)
                }
                .padding(16)
            }
            .navigationTitle("Damages")
            .toolbar {
                ToolbarItem {
                    Button { creating = true } label: {
                        Label("New Scenario", systemImage: "plus")
                    }
                }
            }
            .sheet(isPresented: $creating) {
                DamagesEditor(existing: nil, caseOwner: cases.first)
            }
            .navigationDestination(item: $selected) { scenario in
                DamagesDetailView(scenario: scenario)
            }
        }
    }

    private func column(for tier: DamagesTier) -> some View {
        let filtered = scenarios.filter { $0.tier == tier }
        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(tier.displayName)
                    .font(.headline)
                Spacer()
                Text("\(filtered.count)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if filtered.isEmpty {
                Text("No scenarios")
                    .font(.footnote)
                    .foregroundStyle(.tertiary)
                    .padding(.vertical, 24)
                    .frame(maxWidth: .infinity, alignment: .center)
            } else {
                ForEach(filtered) { scenario in
                    DamagesCard(scenario: scenario) {
                        recompute(scenario)
                    } onOpen: {
                        selected = scenario
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }

    private func recompute(_ scenario: DamagesScenario) {
        let result = DamagesCalculator.compute(DamagesInputs(from: scenario))
        scenario.cachedNPV = result.npv
        scenario.cachedTrebledNPV = result.trebledNPV
        scenario.computedAt = Date()
        try? modelContext.save()
    }
}

private struct DamagesCard: View {
    @Bindable var scenario: DamagesScenario
    let onRecompute: () -> Void
    let onOpen: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(scenario.name.isEmpty ? "Untitled scenario" : scenario.name)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)

            VStack(alignment: .leading, spacing: 4) {
                row("NPV", value: scenario.cachedNPV)
                row("Trebled", value: scenario.cachedTrebledNPV, weight: .semibold)
                if let computed = scenario.computedAt {
                    Text("Computed \(Formatters.displayDateTime.string(from: computed))")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                } else {
                    Text("Not yet computed")
                        .font(.caption2)
                        .foregroundStyle(.orange)
                }
            }

            HStack {
                Button("Recompute", action: onRecompute)
                    .buttonStyle(.bordered)
                Spacer()
                Button("Open", action: onOpen)
                    .buttonStyle(.borderedProminent)
            }
        }
        .padding(12)
        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10).stroke(Color.secondary.opacity(0.15))
        )
    }

    private func row(_ label: String, value: Decimal?, weight: Font.Weight = .regular) -> some View {
        HStack {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value.map(Formatters.formatMoney) ?? "unset")
                .font(.callout.weight(weight))
                .monospacedDigit()
        }
    }
}

private extension DamagesTier {
    var displayName: String {
        switch self {
        case .conservative: return "Conservative"
        case .base: return "Base"
        case .aggressive: return "Aggressive"
        }
    }
}
