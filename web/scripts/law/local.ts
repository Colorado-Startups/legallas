// SPDX-License-Identifier: Apache-2.0
// npm run law -- --only <units> --local: the built parts and their catalog into the local legallas-law bucket, the
// files `wrangler dev` reads, never Cloudflare. A local room and legallas-mcp with LAW_LIBRARY "1" then search and
// cite those units (mcp/dev-search.ts devLawSearch, the room's Entity choice page). The fixture room's law input
// runs it (.github/workflows/fixture-room.yml).
import { lawKey } from '../../worker/law-cite.ts';
import type { LocalBucket } from '../local-r2.ts';
import { CATALOG_KEY, catalogText } from './plan.ts';
import type { BuiltChunk } from './types.ts';

const encoder = new TextEncoder();

/** Puts every part under law/<track>/<id>.md, then catalog.json last, so the catalog never names a part not yet there. */
export async function putLocal(bucket: Pick<LocalBucket, 'put'>, chunks: readonly BuiltChunk[], built: string): Promise<void> {
  for (const chunk of chunks) await bucket.put(lawKey(chunk), encoder.encode(chunk.text), { httpMetadata: { contentType: 'text/markdown; charset=utf-8' } });
  await bucket.put(CATALOG_KEY, encoder.encode(catalogText(chunks, built)), { httpMetadata: { contentType: 'application/json' } });
}
