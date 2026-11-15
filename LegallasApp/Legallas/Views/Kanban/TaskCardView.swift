// SPDX-License-Identifier: Apache-2.0
import SwiftUI
import LegallasCore

struct TaskCardView: View {
    let task: CaseTask

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .top) {
                Text(task.title)
                    .font(.body.weight(.medium))
                    .lineLimit(3)
                Spacer()
                priorityBadge
            }
            if !task.details.isEmpty {
                Text(task.details)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            HStack(spacing: 8) {
                if let due = task.dueDate {
                    Label(Formatters.displayDate.string(from: due), systemImage: "calendar")
                        .labelStyle(.titleAndIcon)
                        .font(.caption2)
                        .foregroundStyle(due < Date() && task.status != .done ? .red : .secondary)
                }
                if task.source == .claude {
                    Label("Claude", systemImage: "sparkle")
                        .labelStyle(.titleAndIcon)
                        .font(.caption2)
                        .foregroundStyle(.purple)
                }
                Spacer()
            }
        }
        .padding(8)
        .background(Color(.textBackgroundColor), in: RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color.secondary.opacity(0.2), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityDescription)
    }

    private var accessibilityDescription: String {
        var parts: [String] = ["\(priorityAbbreviation) priority", task.title]
        if let due = task.dueDate {
            parts.append("due \(Formatters.displayDate.string(from: due))")
        }
        if task.source == .claude {
            parts.append("suggested by Claude")
        }
        return parts.joined(separator: ", ")
    }

    private var priorityBadge: some View {
        Text(priorityAbbreviation)
            .font(.caption2.weight(.bold))
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .background(priorityColor.opacity(0.2), in: Capsule())
            .foregroundStyle(priorityColor)
    }

    private var priorityAbbreviation: String {
        switch task.priority {
        case .low: return "LOW"
        case .medium: return "MED"
        case .high: return "HIGH"
        case .critical: return "CRIT"
        }
    }

    private var priorityColor: Color {
        switch task.priority {
        case .low: return .secondary
        case .medium: return .blue
        case .high: return .orange
        case .critical: return .red
        }
    }
}
