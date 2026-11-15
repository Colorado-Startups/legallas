// SPDX-License-Identifier: Apache-2.0
// Card F4. Test helpers: the fictional Doe v. Harbor Labs fixture (fixtures/source and fixtures/fragments) and the
// live mirror rows a fake D1 returns for it. Nothing here is matter content.
import { cp, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** The folder of the matter fixtures. */
export const FIXTURES = path.join(import.meta.dirname, 'fixtures');
/** The fixture source folder. */
export const SOURCE_ROOT = path.join(FIXTURES, 'source');
/** The fixture fragments folder. */
export const FRAGMENTS = path.join(FIXTURES, 'fragments');

/** documents.id by documents.path for the mirror rows of the fixture room. */
export const IDS: Record<string, string> = {
  '00-Orientation/Document_Catalog.csv': '00000000-0000-4000-8000-000000000000',
  '01-Corporate-Records/Stock_Agreement_SA__20110607__Harbor-Labs__Countersigned.pdf': '00000000-0000-4000-8000-000000000001',
  '08-Court-Pleadings/Complaint_FAC__20130409__Jane-Doe__First-Amended.pdf': '00000000-0000-4000-8000-000000000002',
  '04-Letters/Email_EML__20120507__Mark-Moe__Meeting-Plan.pdf': '00000000-0000-4000-8000-000000000003',
  '04-Letters/Letter_LTR.pdf': '00000000-0000-4000-8000-000000000004',
  '06-Cap-Table/Bank_Statement_BS__20120730__Harbor-Labs__July.pdf': '00000000-0000-4000-8000-000000000005',
  '07-Lawyer-Notes-PRIVILEGED/Memo_MEM__20120528__Lisa-Low__Removal-Summary.pdf': '00000000-0000-4000-8000-000000000006',
  '10-Lawyer-Analysis/Claim_Chart__WP__20130312.xlsx': '00000000-0000-4000-8000-000000000007',
};

/** The fixture document id of a path; throws when the path has none. */
export const id = (docPath: string): string => {
  const value = IDS[docPath];
  if (!value) throw new Error(`no fixture id for ${docPath}`);
  return value;
};

/** A fake d1Query answering MIRROR_ROWS_SQL with the fixture rows, recording every statement. */
export function fakeD1(rows: Record<string, string> = IDS): { d1Query: (sql: string) => Promise<Record<string, unknown>[]>; sql: string[] } {
  const sql: string[] = [];
  return {
    sql,
    d1Query: async (statement) => {
      sql.push(statement);
      if (!/FROM documents WHERE source = 'mirror'/.test(statement)) throw new Error('unexpected SQL');
      return Object.entries(rows).map(([docPath, docId]) => ({ id: docId, path: docPath, sha256: 'x', size: 1, kind: 'pdf', pages: 1, r2_key: docId, source: 'mirror', removed_at: null }));
    },
  };
}

/** A fresh cache folder outside the repo with the fixture fragments copied into matter/fragments. */
export async function tempCache(withFragments = true): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'legallas-matter-'));
  if (withFragments) await cp(FRAGMENTS, path.join(dir, 'matter', 'fragments'), { recursive: true });
  return dir;
}

/** The fixed time that the tests treat as now. */
export const NOW = new Date('2026-10-01T12:00:00.000Z');
