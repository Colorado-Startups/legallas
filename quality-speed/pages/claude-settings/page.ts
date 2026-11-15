// SPDX-License-Identifier: Apache-2.0
// The Claude settings page: its metrics as tiles, and every declared row of expected.json, the repo's and the owner's.
import { readFileSync } from 'node:fs';
import type { PageContext, PageOutput } from '../../core/build.ts';
import { dataTable, metricTile, tileRow } from '../../core/charts/index.ts';
import type { Row } from './collect.ts';

const LABELS: Record<string, string> = { settings_match: 'Rows met', deny_rules_kept: 'Deny rules', drift_open_hours: 'Drift open', lane_minutes: 'Lane minutes', startup_tokens: 'Start tokens' };
const { rows } = JSON.parse(readFileSync(new URL('./expected.json', import.meta.url), 'utf8')) as { rows: Row[] };

/** What each row expects, with an owner row's place as a host and path, since the page links only into this repository. */
function expected(r: Row): string {
  if (r.read === 'owner') return `${r.expect} at ${r.where?.replace(/^https:\/\//, '')}`;
  return r.op === 'denied' ? `${r.values?.length} deny rules kept` : `allowed: ${r.values?.join(' ')}`;
}

export function render({ score, metrics }: PageContext): PageOutput {
  const tiles = metrics.map((m, i) => metricTile(m, LABELS[m.id] ?? m.id, { reading: score.metrics[i]?.reading ?? 'missing' }));
  const table = dataTable({
    caption: 'Declared',
    columns: [
      { key: 'row', label: 'row' },
      { key: 'read', label: 'read' },
      { key: 'expected', label: 'expected' },
    ],
    rows: rows.map((r) => ({ row: r.id, read: r.read, expected: expected(r) })),
  });
  return { body: tileRow(tiles) + table };
}
