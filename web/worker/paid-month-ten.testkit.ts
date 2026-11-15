// SPDX-License-Identifier: Apache-2.0
// For tests of the paid month's mechanics: this process's room set a $10 paid month (worker/room-settings.ts
// paidMonthlyUsd), as one customer did (2026-10-31). Import it first, before anything that loads worker/budget.ts: the
// setting is read once, when room-settings.ts loads. node --test runs each test file in its own process, so it never
// reaches a file that doesn't import it, where the default, $0, stands.
(globalThis as Record<string, unknown>).ROOM_PAID_MONTHLY_USD = '10';
