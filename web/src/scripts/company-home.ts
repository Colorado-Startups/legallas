// SPDX-License-Identifier: Apache-2.0
// Fills a company room's "Where your documents live": a link per top folder, in the Documents index's order and words.
import { buildIndex, type ListedTree } from './documents-table-data.ts';
import { FOLDERS_FAILED } from './company-home-boot.ts';
import { getJson } from './files-api.ts';

async function fill(status: HTMLElement, list: HTMLElement): Promise<void> {
  const tree = await getJson<{ root: ListedTree }>('/api/documents');
  if (!tree.ok) {
    status.textContent = FOLDERS_FAILED;
    return;
  }
  const folders = buildIndex(tree.value.root).filter((folder) => folder.count > 0);
  status.textContent = folders.length ? '' : 'No documents yet; folders appear here once your documents sync.';
  list.replaceChildren(
    ...folders.map((folder) => {
      const link = document.createElement('a');
      link.className = 'company-folder';
      link.href = `/documents/#${encodeURIComponent(folder.path)}`;
      link.textContent = `${folder.label} (${folder.count})`;
      const item = document.createElement('li');
      item.append(link);
      return item;
    }),
  );
}

const status = document.querySelector<HTMLElement>('[data-company-status]');
const list = document.querySelector<HTMLElement>('[data-company-folders]');
// A response the index cannot read throws in fill; it shows the same error line rather than leaving Loading up.
if (status && list) fill(status, list).catch(() => void (status.textContent = FOLDERS_FAILED));
