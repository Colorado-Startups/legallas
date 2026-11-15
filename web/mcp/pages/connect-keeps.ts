// SPDX-License-Identifier: Apache-2.0
// "What each AI keeps" on /connect, and the same table in connect/README.md (card 12.2; docs/design/ai-connectors.md,
// Decision 9 and section 1). One list, so the page and the README cannot drift (connect-keeps.test.ts).
import { escapeHtml } from './html.ts';

/** Which AI, what its provider keeps, and whether a zero-retention room can use it. */
export const KEEPS: readonly (readonly [string, string, string])[] = [
  ['Claude apps', '30 days to 5 years; Enterprise: indefinitely', 'No'],
  ['Claude Code, zero retention', 'Nothing', 'Yes'],
  ['Microsoft 365 Copilot', 'Your mailbox', 'No'],
  ['Harvey', "Your firm's policy", 'Partly'],
  ['OpenCode, open weights', 'Nothing', 'Yes'],
];

export const KEEPS_HEADS = ['AI', 'Provider keeps', 'Zero-retention room'] as const;

/** The page section: a short lead, then the table. */
export const KEEPS_SECTION = `<section class="cx-tool prose" id="keeps" aria-labelledby="keeps-title">
<h2 id="keeps-title">What each AI keeps</h2>
<div class="table-wrap"><table><thead><tr>${KEEPS_HEADS.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${KEEPS.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
</section>`;

/** The same table for connect/README.md. */
export const KEEPS_MARKDOWN = [`| ${KEEPS_HEADS.join(' | ')} |`, '|---|---|---|', ...KEEPS.map((row) => `| ${row.join(' | ')} |`)].join('\n');
