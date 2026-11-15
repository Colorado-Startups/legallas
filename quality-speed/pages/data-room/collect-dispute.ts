// SPDX-License-Identifier: Apache-2.0
// The lane for the dispute room's own pages, and for what every room reads, timed on the largest room.
import { collect } from './collect-lab.ts';

collect('dispute', 'dispute', ['filter-documents', 'doc-open', 'citation-to-page', 'load-chronology', 'connector-search']);
