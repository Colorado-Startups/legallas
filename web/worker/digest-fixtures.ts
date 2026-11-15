// SPDX-License-Identifier: Apache-2.0
// Test support only (never imported by the Worker): Workers' crypto.DigestStream on Node, for tests that upload
// through the room (routes/files.ts hashes each upload as it streams). Importing this file installs it.
import { createHash } from 'node:crypto';

class NodeDigestStream extends WritableStream<ArrayBuffer | ArrayBufferView> {
  readonly digest: Promise<ArrayBuffer>;

  constructor(algorithm: string) {
    const hash = createHash(algorithm.replace('-', '').toLowerCase());
    let done: (value: ArrayBuffer) => void = () => undefined;
    const digest = new Promise<ArrayBuffer>((resolve) => {
      done = resolve;
    });
    super({
      write(chunk) {
        hash.update(ArrayBuffer.isView(chunk) ? new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength) : new Uint8Array(chunk));
      },
      close() {
        done(new Uint8Array(hash.digest()).buffer);
      },
    });
    this.digest = digest;
  }
}

if (!('DigestStream' in crypto)) Object.defineProperty(crypto, 'DigestStream', { value: NodeDigestStream });
