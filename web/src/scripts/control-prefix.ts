// SPDX-License-Identifier: Apache-2.0
// The control-number prefix a room shows when its config sets none. Its own module, with no imports, so Room.astro's
// build step and the page's scripts read the same value.

/**
 * Neutral on purpose: `DOE` is the fictional fixture's prefix, so a room that set none must never number its documents
 * as the fixture does. The same as mcp/contract.ts and scripts/config.ts (control-prefix.test.ts holds them together),
 * so a cite written in a comment links on the page and matches what a connected AI reads.
 */
export const CONTROL_PREFIX_FALLBACK = 'DOC';
