// SPDX-License-Identifier: Apache-2.0
// Card F4. The one place the build calls the manifest validator: card F2's parseMatter, the same function the
// Worker runs on every read. A MatterError names a field, never a value, so its message may be printed.
import { MatterError, parseMatter } from '../../worker/matter.ts';
import type { Matter } from '../../worker/matter-types.ts';

/** The result of validating a built manifest: the matter, or an error message. */
export type Validation = { matter: Matter; error: null } | { matter: null; error: string };

/** Validates a built manifest against the contract at build time `now`. Other errors still throw. */
export function validateMatter(raw: unknown, now: Date): Validation {
  try {
    return { matter: parseMatter(raw, { now }), error: null };
  } catch (error) {
    if (error instanceof MatterError) return { matter: null, error: error.message };
    throw error;
  }
}
