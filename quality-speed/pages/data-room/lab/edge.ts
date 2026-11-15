// SPDX-License-Identifier: Apache-2.0
// The lab's stand-in for Cloudflare's edge. A room's members reach it through Cloudflare, which compresses a Worker's
// responses on the way out (developers.cloudflare.com/workers/runtime-apis/fetch, "How the Accept-Encoding header is
// handled"); `wrangler dev --local` sends every byte raw. Without this step the lab's slow-4G clock and byte rows count
// files several times larger than a member downloads.
//
// It compresses the content types Cloudflare compresses by default (developers.cloudflare.com/speed/optimization/content/
// compression, read 2026-11-05) and passes everything else through: PDFs, images and the file API's bytes stay raw, as at
// the edge. Gzip at level 6, never brotli: the edge picks brotli for Chrome, so the lab claims no more than the edge sends.
import { createServer, request as forward, type IncomingHttpHeaders, type Server } from 'node:http';
import { constants, createGzip } from 'node:zlib';

/** Cloudflare's default list, as its Zstandard compression-rule example quotes it. */
const COMPRESSED = new Set([
  'text/html', 'text/richtext', 'text/plain', 'text/css', 'text/x-script', 'text/x-component', 'text/x-java-source', 'text/x-markdown',
  'application/javascript', 'application/x-javascript', 'text/javascript', 'text/js', 'image/x-icon', 'image/vnd.microsoft.icon',
  'application/x-perl', 'application/x-httpd-cgi', 'text/xml', 'application/xml', 'application/rss+xml', 'application/vnd.api+json',
  'application/x-protobuf', 'application/json', 'multipart/bag', 'multipart/mixed', 'application/xhtml+xml', 'font/ttf', 'font/otf',
  'font/x-woff', 'image/svg+xml', 'application/vnd.ms-fontobject', 'application/ttf', 'application/x-ttf', 'application/otf',
  'application/x-otf', 'application/truetype', 'application/opentype', 'application/x-opentype', 'application/font-woff',
  'application/eot', 'application/font', 'application/font-sfnt', 'application/wasm', 'application/javascript-binast',
  'application/manifest+json', 'application/ld+json', 'application/graphql+json', 'application/geo+json',
]);

/** Whether the edge would gzip this response for a client that accepts gzip. */
export function edgeCompresses(method: string, status: number, accept: string | undefined, headers: IncomingHttpHeaders): boolean {
  if (method === 'HEAD' || status === 204 || status === 304 || status < 200) return false;
  if (headers['content-encoding']) return false;
  if (!/\bgzip\b/i.test(accept ?? '')) return false;
  const type = String(headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
  return COMPRESSED.has(type);
}

/** Listens on `port` and forwards every request, its Host header untouched, to the Worker on `upstream`. */
export function startEdge(port: number, upstream: number): Promise<Server> {
  const server = createServer((req, res) => {
    const out = forward({ host: 'localhost', port: upstream, method: req.method, path: req.url, headers: req.headers }, (reply) => {
      const headers = { ...reply.headers };
      if (!edgeCompresses(req.method ?? 'GET', reply.statusCode ?? 0, req.headers['accept-encoding'], headers)) {
        res.writeHead(reply.statusCode ?? 502, headers);
        reply.pipe(res);
        return;
      }
      delete headers['content-length'];
      headers['content-encoding'] = 'gzip';
      headers.vary = headers.vary ? `${String(headers.vary)}, Accept-Encoding` : 'Accept-Encoding';
      res.writeHead(reply.statusCode ?? 200, headers);
      // A sync flush after each chunk, so a streamed page reaches the browser as the Worker writes it.
      reply.pipe(createGzip({ level: 6, flush: constants.Z_SYNC_FLUSH })).pipe(res);
    });
    out.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(out);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    // Every address, as wrangler's own server: the browser may reach localhost over IPv6 or IPv4.
    server.listen(port, () => resolve(server));
  });
}
