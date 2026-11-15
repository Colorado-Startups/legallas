// SPDX-License-Identifier: Apache-2.0
// The /doc/ page's first script, in <head> after the boot guard (doc.astro fills Room.astro's head slot). Module scripts run
// in page order, each once every script before it has loaded. doc-page.ts comes after the guide's and the discussion's,
// so on slow 4G it asked for the document seconds after the page arrived. This one has a small graph and runs first.
import { dropPdfWorker, loadPdfViewer } from './doc-pdf-start.ts';
import { startDocPage } from './doc-open.ts';

startDocPage(location, { warm: () => void loadPdfViewer().catch(() => undefined), cool: dropPdfWorker });
