// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData

/// A to-do item on a case, with a status, a priority and an optional due date.
@Model
public final class CaseTask {
    /// Short task title.
    public var title: String = ""
    /// Longer task description.
    public var details: String = ""
    /// Stored raw value of the task status.
    public var statusRaw: String = TaskStatus.toDo.rawValue
    /// Stored raw value of the task priority.
    public var priorityRaw: String = Priority.medium.rawValue
    /// Free-text category label for the task.
    public var category: String?
    /// Date the task is due, if set.
    public var dueDate: Date?
    /// Position of the task in a sorted list.
    public var sortIndex: Double = 0
    /// When the task was created.
    public var createdAt: Date = Date()
    /// When the task was last changed.
    public var updatedAt: Date = Date()
    /// When the task was completed, if it has been.
    public var completedAt: Date?
    /// Stored raw value of where the task came from.
    public var sourceRaw: String = DataSource.user.rawValue

    /// Case the task belongs to.
    public var `case`: Case?
    /// Deadline the task is tied to, if any.
    public var deadline: Deadline?

    /// Notes linked to the task.
    @Relationship(deleteRule: .nullify, inverse: \Note.tasks)
    public var notes: [Note] = []

    /// Task progress state; an unreadable stored value reads as to do.
    public var status: TaskStatus {
        get { TaskStatus(rawValue: statusRaw) ?? .toDo }
        set { statusRaw = newValue.rawValue }
    }

    /// Task priority; an unreadable stored value reads as medium.
    public var priority: Priority {
        get { Priority(rawValue: priorityRaw) ?? .medium }
        set { priorityRaw = newValue.rawValue }
    }

    /// Whether the user, Claude or an import created the task; an unreadable stored value reads as user.
    public var source: DataSource {
        get { DataSource(rawValue: sourceRaw) ?? .user }
        set { sourceRaw = newValue.rawValue }
    }

    /// Creates a task; status defaults to to do, priority to medium and source to user.
    public init(
        title: String,
        details: String = "",
        status: TaskStatus = .toDo,
        priority: Priority = .medium,
        category: String? = nil,
        dueDate: Date? = nil,
        sortIndex: Double = 0,
        source: DataSource = .user
    ) {
        self.title = title
        self.details = details
        self.statusRaw = status.rawValue
        self.priorityRaw = priority.rawValue
        self.category = category
        self.dueDate = dueDate
        self.sortIndex = sortIndex
        self.createdAt = Date()
        self.updatedAt = Date()
        self.sourceRaw = source.rawValue
    }
}
