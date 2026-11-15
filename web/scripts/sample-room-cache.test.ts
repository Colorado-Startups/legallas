// SPDX-License-Identifier: Apache-2.0
// The sample room seeds on Linux from committed extractor output, one entry per fixture PDF or image, keyed by the file's
// sha256 (quality-speed/pages/data-room/lab/extract-cache.ts). This fails in `checks` when a change to the fixture or to
// EXTRACTOR_VERSION leaves that cache behind, with what to do about it, rather than leaving the next lab run to find out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CACHE_DIR, coverage, coverageProblem, everyRecordFile } from '../../quality-speed/pages/data-room/lab/extract-cache.ts';

test('the sample room extract cache covers exactly its records, at this extractor version', async () => {
  assert.equal(coverageProblem(await coverage(await everyRecordFile(), CACHE_DIR)), null);
});
