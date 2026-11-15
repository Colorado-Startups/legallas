// SPDX-License-Identifier: Apache-2.0
import SwiftUI
import SwiftData
import Charts
import LegallasCore

struct DamagesDetailView: View {

    @Environment(\.modelContext) private var modelContext
    @Bindable var scenario: DamagesScenario
    @State private var editing = false

    private var computation: DamagesComputation {
        DamagesCalculator.compute(DamagesInputs(from: scenario))
    }

    private var sensitivity: [SensitivityCell] {
        DamagesCalculator.sensitivity(DamagesInputs(from: scenario))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                summaryCard
                waterfallCard
                sensitivityCard
            }
            .padding(20)
        }
        .navigationTitle(scenario.name.isEmpty ? "Scenario" : scenario.name)
        .toolbar {
            ToolbarItem {
                Button { editing = true } label: {
                    Label("Edit", systemImage: "pencil")
                }
            }
            ToolbarItem {
                Button("Recompute", action: recompute)
            }
        }
        .sheet(isPresented: $editing) {
            DamagesEditor(existing: scenario, caseOwner: scenario.case)
        }
    }

    private var summaryCard: some View {
        let c = computation
        return VStack(alignment: .leading, spacing: 12) {
            Text("Summary")
                .font(.headline)
            HStack(spacing: 24) {
                stat("NPV", value: c.npv)
                stat("Trebled NPV", value: c.trebledNPV, prominent: true)
            }
            HStack(spacing: 24) {
                stat("Terminal value (PV)", value: c.terminalValuePresentValue)
                stat("Lost distributions", value: c.lostDistributionsAdjustment)
                stat("Governance premium", value: c.governancePremiumAdjustment)
            }
            if c.terminalValueClamped {
                Label(
                    "Terminal growth exceeded discount rate; clamped with a 25 basis point spread.",
                    systemImage: "exclamationmark.triangle"
                )
                .foregroundStyle(.orange)
                .font(.caption)
            }
        }
        .padding(14)
        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 10))
    }

    private var waterfallCard: some View {
        let rows = computation.perYear
        return VStack(alignment: .leading, spacing: 12) {
            Text("Cash flow waterfall")
                .font(.headline)
            if rows.isEmpty {
                Text("Horizon is zero; no cash flows.")
                    .foregroundStyle(.secondary)
                    .padding(.vertical, 12)
            } else {
                Chart(rows, id: \.year) { row in
                    BarMark(
                        x: .value("Year", row.year),
                        y: .value("Present value", NSDecimalNumber(decimal: row.presentValue).doubleValue)
                    )
                    .foregroundStyle(Color.accentColor)
                }
                .frame(height: 240)
                yearsTable(rows)
            }
        }
        .padding(14)
        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 10))
    }

    private func yearsTable(_ rows: [DamagesComputation.YearRow]) -> some View {
        VStack(spacing: 4) {
            HStack {
                Text("Year").font(.caption2.bold())
                Spacer()
                Text("Cash flow").font(.caption2.bold())
                Spacer()
                Text("Present value").font(.caption2.bold())
            }
            ForEach(rows, id: \.year) { row in
                HStack {
                    Text("\(row.year)").frame(width: 40, alignment: .leading)
                    Spacer()
                    Text(Formatters.formatMoney(row.cashFlowToClaimant))
                        .monospacedDigit()
                    Spacer()
                    Text(Formatters.formatMoney(row.presentValue))
                        .monospacedDigit()
                }
                .font(.caption)
            }
        }
    }

    private var sensitivityCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Sensitivity (NPV)")
                .font(.headline)
            Text("Rows: discount rate delta. Columns: growth rate delta.")
                .font(.caption)
                .foregroundStyle(.secondary)

            let cells = sensitivity
            let discountDeltas = Array(Set(cells.map(\.discountRateDelta))).sorted()
            let growthDeltas = Array(Set(cells.map(\.growthRateDelta))).sorted()

            VStack(spacing: 4) {
                HStack {
                    Text("").frame(width: 80, alignment: .leading)
                    ForEach(growthDeltas, id: \.self) { gd in
                        Text(bpsLabel(gd)).font(.caption2.bold())
                            .frame(maxWidth: .infinity)
                    }
                }
                ForEach(discountDeltas, id: \.self) { dd in
                    HStack {
                        Text(bpsLabel(dd)).font(.caption2.bold())
                            .frame(width: 80, alignment: .leading)
                        ForEach(growthDeltas, id: \.self) { gd in
                            if let cell = cells.first(where: { $0.discountRateDelta == dd && $0.growthRateDelta == gd }) {
                                Text(Formatters.formatMoney(cell.npv))
                                    .font(.caption)
                                    .monospacedDigit()
                                    .frame(maxWidth: .infinity)
                            }
                        }
                    }
                }
            }
        }
        .padding(14)
        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 10))
    }

    private func bpsLabel(_ bps: Int) -> String {
        let sign = bps > 0 ? "+" : ""
        return "\(sign)\(bps) bps"
    }

    private func stat(_ label: String, value: Decimal, prominent: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(Formatters.formatMoney(value))
                .font(prominent ? .title2.bold() : .title3)
                .monospacedDigit()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func recompute() {
        let c = computation
        scenario.cachedNPV = c.npv
        scenario.cachedTrebledNPV = c.trebledNPV
        scenario.computedAt = Date()
        try? modelContext.save()
    }
}
