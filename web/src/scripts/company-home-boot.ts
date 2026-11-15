// SPDX-License-Identifier: Apache-2.0
// Starts a company room's folder list (company-home.ts) from CompanyHome.astro. The list loads as its own chunk, and
// the boot guard (boot-guard.ts) only hears a <script> that fails, not a dynamic import, so a chunk missing during a
// deploy would leave "Loading the folders." up for good (#219). This catches that and shows the list's own error line.
// It imports nothing, so a room that is not a company room pays only these few lines.

/** The folder list's error line, the same whether the chunk or the folder request failed. */
export const FOLDERS_FAILED = 'The folders did not load; reload the page to try again.';

/** The few DOM calls this makes, so a test can pass a stand-in for document. */
export interface BootDocument {
  documentElement: { dataset: DOMStringMap };
  querySelector(selectors: string): { textContent: string | null } | null;
}

/** Loads the folder list in a room with no matter; on a failed load, trades the Loading line for the error line. */
export async function bootCompanyHome(doc: BootDocument, load: () => Promise<unknown>): Promise<void> {
  if (doc.documentElement.dataset.roomShape !== 'company') return;
  try {
    await load();
  } catch {
    const status = doc.querySelector('[data-company-status]');
    if (status) status.textContent = FOLDERS_FAILED;
  }
}
