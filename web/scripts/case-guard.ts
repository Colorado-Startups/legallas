// SPDX-License-Identifier: Apache-2.0
// The room's case-data guard (.github/scripts/guard-case-data.sh) spells out the words that name its matter, so it
// stays with the room's own repo: a copy of the product has no such file, or one that reads its words from
// elsewhere. Tests that prove the fictional fixture names no real matter read the words from the guard when the
// checkout has it, so no test has to spell them out.
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const CASE_GUARD = path.resolve(import.meta.dirname, '..', '..', '.github', 'scripts', 'guard-case-data.sh');

/**
 * The guard's matter pattern, case-insensitive as the guard applies it (`git grep -iE`), or null when the checkout
 * has no guard or the guard holds no literal pattern.
 */
export function caseGuardPattern(file = CASE_GUARD): RegExp | null {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const source = /^matter='(.+)'$/m.exec(text)?.[1];
  return source ? new RegExp(source, 'i') : null;
}
