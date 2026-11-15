// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { createServer, get, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { edgeCompresses, startEdge } from './edge.ts';

test('the edge gzips what Cloudflare compresses by default, and nothing else', () => {
  const gz = 'gzip, deflate, br';
  assert.equal(edgeCompresses('GET', 200, gz, { 'content-type': 'text/javascript; charset=utf-8' }), true);
  assert.equal(edgeCompresses('GET', 200, gz, { 'content-type': 'text/html' }), true);
  assert.equal(edgeCompresses('GET', 200, gz, { 'content-type': 'application/json' }), true);
  assert.equal(edgeCompresses('GET', 200, gz, { 'content-type': 'application/pdf' }), false, 'a PDF is not on the list');
  assert.equal(edgeCompresses('GET', 200, gz, { 'content-type': 'image/png' }), false);
  assert.equal(edgeCompresses('GET', 200, gz, { 'content-type': 'text/event-stream' }), false, 'a stream passes through');
  assert.equal(edgeCompresses('GET', 200, gz, { 'content-type': 'text/css', 'content-encoding': 'br' }), false, 'already encoded');
  assert.equal(edgeCompresses('GET', 200, 'identity', { 'content-type': 'text/css' }), false, 'the client takes no gzip');
  assert.equal(edgeCompresses('HEAD', 200, gz, { 'content-type': 'text/css' }), false);
  assert.equal(edgeCompresses('GET', 304, gz, { 'content-type': 'text/css' }), false);
});

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
}

function fetchRaw(port: number, path: string): Promise<{ headers: Record<string, unknown>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    get({ host: '127.0.0.1', port, path, headers: { 'accept-encoding': 'gzip', host: 'localhost:8789' } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

test('through the edge: script gzipped, PDF raw, Host kept', async (t) => {
  const script = 'console.log("Doe v. Harbor Labs");'.repeat(200);
  const hosts: string[] = [];
  const worker = createServer((req, res) => {
    hosts.push(String(req.headers.host));
    if (req.url === '/a.js') res.writeHead(200, { 'content-type': 'text/javascript', 'content-length': Buffer.byteLength(script) }).end(script);
    else res.writeHead(200, { 'content-type': 'application/pdf' }).end('%PDF-1.7');
  });
  const upstream = await listen(worker);
  const edge = await startEdge(0, upstream);
  t.after(() => { edge.close(); worker.close(); });
  const port = (edge.address() as AddressInfo).port;

  const js = await fetchRaw(port, '/a.js');
  assert.equal(js.headers['content-encoding'], 'gzip');
  assert.equal(js.headers['content-length'], undefined);
  assert.ok(js.body.length < script.length / 10, `${js.body.length} bytes on the wire`);
  assert.equal(gunzipSync(js.body).toString(), script);

  const pdf = await fetchRaw(port, '/f.pdf');
  assert.equal(pdf.headers['content-encoding'], undefined);
  assert.equal(pdf.body.toString(), '%PDF-1.7');
  assert.deepEqual(hosts, ['localhost:8789', 'localhost:8789']);
});
