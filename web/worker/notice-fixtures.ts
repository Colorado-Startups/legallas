// SPDX-License-Identifier: Apache-2.0
// Tests only: testDb and schemaDb members have ticked the full notice (notice-gate.ts). notice-gate.test.ts drops this.
import { NOTICE_VERSION } from './full-notice.ts';

export const TICKED_TRIGGER = 'fixture_members_ticked';

export function tickEveryMember(db: { exec(sql: string): void }): void {
  db.exec(
    `CREATE TRIGGER ${TICKED_TRIGGER} AFTER INSERT ON members BEGIN ` +
      `INSERT OR IGNORE INTO notice_acks (email, version) VALUES (NEW.email, '${NOTICE_VERSION}'); END;`,
  );
}
