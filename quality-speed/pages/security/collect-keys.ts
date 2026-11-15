// SPDX-License-Identifier: Apache-2.0
// The keys lane: how old the repository's stored keys are, from the admin job's read-outs, because the built-in token can't
// list them. GitHub gives each key's name and when it was last set, never its value, and only the age leaves here. Until
// the admin job exists its files are absent, and this reports `missing`, never a good number.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { finish, record, runContext } from './lane.ts';
import { keysFromReadOut, oldestKeyDays, parseReadOut, requiredKeyReadOuts } from './readings.ts';

/** One night's read-outs, plus room for a run that was late. */
const MAX_AGE_HOURS = 30;
if (import.meta.main) {
  const now = Date.now();
  const dir = path.join(process.env.KEY_JOB_OUTPUT_DIR ?? '', 'admin-read');
  const read = (name: string) => {
    const file = path.join(dir, name);
    return process.env.KEY_JOB_OUTPUT_DIR && existsSync(file) ? parseReadOut(readFileSync(file, 'utf8')) : null;
  };
  const required = requiredKeyReadOuts(read('repository-environments.txt'));
  const readOuts = (required ?? []).map(read);
  const lists = readOuts.map((readOut) => readOut && keysFromReadOut(readOut, now, MAX_AGE_HOURS));
  // A list that is missing, refused or old means some keys went unread, so the whole reading is unproven.
  const dates = required && lists.every((list) => list !== null) ? lists.flatMap((list) => list as string[]) : [];
  finish([record(runContext(), 'key_age_max_days', oldestKeyDays(dates, now), dates.length || 1)], { checks: {}, readings: {} });
}
