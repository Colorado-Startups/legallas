// SPDX-License-Identifier: Apache-2.0
// The audit log's chain (worker/audit-chain.ts has the why): one JSON line per row, each with the SHA-256 of the line
// before's chain and this row. No Worker types, so `npm run close-out` (scripts/close-out.ts) builds and checks the
// same chain as the room.
export const FIELDS = ['id', 'ts', 'email', 'action', 'document_id', 'ip', 'user_agent', 'via', 'room_id'] as const;
/** The columns each copy line carries, in chain order. */
export const AUDIT_COPY_FIELDS: readonly string[] = FIELDS;
export type AuditCopyRow = Record<(typeof FIELDS)[number], string | number | null>;

async function sha256(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

const link = (previous: string, row: AuditCopyRow) => sha256(`${previous}\n${JSON.stringify(FIELDS.map((f) => row[f] ?? null))}`);

/** The copy's lines for `rows` (in id order), chained on from `previous` ('' before the first row). */
export async function chainLines(rows: readonly AuditCopyRow[], previous = ''): Promise<{ lines: string[]; last: string }> {
  const lines: string[] = [];
  for (const row of rows) {
    previous = await link(previous, row);
    lines.push(JSON.stringify({ ...Object.fromEntries(FIELDS.map((f) => [f, row[f] ?? null])), chain: previous }));
  }
  return { lines, last: previous };
}

export type Verdict = { ok: true; rows: number } | { ok: false; line: number; id: number | null };

function parseLine(line: string): (AuditCopyRow & { chain: string }) | null {
  try {
    const value: unknown = JSON.parse(line);
    if (typeof value !== 'object' || value === null || typeof (value as { chain?: unknown }).chain !== 'string') return null;
    const row = value as Record<string, unknown>;
    if (!FIELDS.every((f) => row[f] === null || typeof row[f] === 'string' || typeof row[f] === 'number')) return null;
    return row as AuditCopyRow & { chain: string };
  } catch {
    return null;
  }
}

/**
 * Checks a copy line by line: each chain against its row and the chain before, and, given `room` (a fresh copy from
 * the room), against the room's chain for the same id. The first line that fails is named, by line and row id. `start`
 * is the chain before the copy's first line: '' for a copy from the log's first row, else the chain a purge ended on.
 */
export async function verifyCopy(copy: string, room?: string, start = ''): Promise<Verdict> {
  const roomChains = new Map<unknown, string>();
  for (const line of room?.split('\n') ?? []) {
    const row = line ? parseLine(line) : null;
    if (row) roomChains.set(row.id, row.chain);
  }
  const lines = copy.split('\n').filter((line) => line !== '');
  let previous = start;
  for (const [i, line] of lines.entries()) {
    const row = parseLine(line);
    if (!row) return { ok: false, line: i + 1, id: null };
    const id = typeof row.id === 'number' ? row.id : null;
    if (row.chain !== (await link(previous, row))) return { ok: false, line: i + 1, id };
    if (room !== undefined && roomChains.get(row.id) !== row.chain) return { ok: false, line: i + 1, id };
    previous = row.chain;
  }
  return { ok: true, rows: lines.length };
}
