// SPDX-License-Identifier: Apache-2.0
import SwiftUI
import SwiftData
import LegallasCore

struct DamagesEditor: View {

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    let existing: DamagesScenario?
    let caseOwner: Case?

    @State private var name: String = ""
    @State private var tier: DamagesTier = .base
    @State private var startingAUM: Decimal = 0
    @State private var annualGrowthRate: Double = 0.08
    @State private var managementFeeRate: Double = 0.02
    @State private var claimantFeeShare: Double = AppSettings.newScenarioClaimantFeeShare
    @State private var carryRate: Double = 0.20
    @State private var partnerAllocation: Double = AppSettings.newScenarioPartnerAllocation
    @State private var claimantCarryShare: Double = AppSettings.newScenarioClaimantCarryShare
    @State private var discountRate: Double = 0.10
    @State private var horizonYears: Int = 10
    @State private var terminalGrowthRate: Double = 0.02
    @State private var lostDistributions: Decimal = 0
    @State private var governancePremium: Decimal = 0

    var body: some View {
        Form {
            Section("Identity") {
                TextField("Name", text: $name)
                Picker("Tier", selection: $tier) {
                    Text("Conservative").tag(DamagesTier.conservative)
                    Text("Base").tag(DamagesTier.base)
                    Text("Aggressive").tag(DamagesTier.aggressive)
                }
            }
            Section("Fund model") {
                moneyField("Starting AUM", value: $startingAUM)
                percentField("Annual AUM growth", value: $annualGrowthRate)
                percentField("Management fee rate", value: $managementFeeRate)
                percentField(AppSettings.claimantFeeShareLabel, value: $claimantFeeShare)
            }
            Section("Carry model") {
                percentField("Carry rate", value: $carryRate)
                percentField(AppSettings.partnerAllocationLabel, value: $partnerAllocation)
                percentField(AppSettings.claimantCarryShareLabel, value: $claimantCarryShare)
            }
            Section("Discounting and horizon") {
                percentField("Discount rate", value: $discountRate)
                Stepper("Horizon: \(horizonYears) years", value: $horizonYears, in: 1...30)
                percentField("Terminal growth rate", value: $terminalGrowthRate)
            }
            Section("Adjustments (present value)") {
                moneyField("Lost distributions", value: $lostDistributions)
                moneyField("Governance premium", value: $governancePremium)
            }
        }
        .formStyle(.grouped)
        .frame(minWidth: 520, minHeight: 600)
        .onAppear(perform: bootstrap)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { dismiss() }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button(existing == nil ? "Create" : "Save", action: save)
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
    }

    private func bootstrap() {
        guard let scenario = existing else { return }
        name = scenario.name
        tier = scenario.tier
        startingAUM = scenario.startingAUM
        annualGrowthRate = scenario.annualGrowthRate
        managementFeeRate = scenario.managementFeeRate
        claimantFeeShare = scenario.claimantFeeShare
        carryRate = scenario.carryRate
        partnerAllocation = scenario.partnerAllocation
        claimantCarryShare = scenario.claimantCarryShare
        discountRate = scenario.discountRate
        horizonYears = scenario.horizonYears
        terminalGrowthRate = scenario.terminalGrowthRate
        lostDistributions = scenario.lostDistributions
        governancePremium = scenario.governancePremium
    }

    private func save() {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        let scenario: DamagesScenario
        if let existing {
            scenario = existing
            scenario.name = trimmed
            scenario.tier = tier
            scenario.startingAUM = startingAUM
            scenario.annualGrowthRate = annualGrowthRate
            scenario.managementFeeRate = managementFeeRate
            scenario.claimantFeeShare = claimantFeeShare
            scenario.carryRate = carryRate
            scenario.partnerAllocation = partnerAllocation
            scenario.claimantCarryShare = claimantCarryShare
            scenario.discountRate = discountRate
            scenario.horizonYears = horizonYears
            scenario.terminalGrowthRate = terminalGrowthRate
            scenario.lostDistributions = lostDistributions
            scenario.governancePremium = governancePremium
        } else {
            scenario = DamagesScenario(
                name: trimmed,
                tier: tier,
                startingAUM: startingAUM,
                annualGrowthRate: annualGrowthRate,
                managementFeeRate: managementFeeRate,
                claimantFeeShare: claimantFeeShare,
                carryRate: carryRate,
                partnerAllocation: partnerAllocation,
                claimantCarryShare: claimantCarryShare,
                discountRate: discountRate,
                horizonYears: horizonYears,
                terminalGrowthRate: terminalGrowthRate,
                lostDistributions: lostDistributions,
                governancePremium: governancePremium
            )
            modelContext.insert(scenario)
            caseOwner?.damagesScenarios.append(scenario)
        }

        let result = DamagesCalculator.compute(DamagesInputs(from: scenario))
        scenario.cachedNPV = result.npv
        scenario.cachedTrebledNPV = result.trebledNPV
        scenario.computedAt = Date()
        try? modelContext.save()
        dismiss()
    }

    private func moneyField(_ title: String, value: Binding<Decimal>) -> some View {
        let formatter: NumberFormatter = {
            let f = NumberFormatter()
            f.numberStyle = .decimal
            f.maximumFractionDigits = 2
            return f
        }()
        return TextField(title, value: value, formatter: formatter)
            .multilineTextAlignment(.trailing)
    }

    private func percentField(_ title: String, value: Binding<Double>) -> some View {
        let formatter: NumberFormatter = {
            let f = NumberFormatter()
            f.numberStyle = .percent
            f.minimumFractionDigits = 2
            f.maximumFractionDigits = 4
            return f
        }()
        return TextField(title, value: value, formatter: formatter)
            .multilineTextAlignment(.trailing)
    }
}
