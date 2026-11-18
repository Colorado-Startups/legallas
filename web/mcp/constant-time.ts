// SPDX-License-Identifier: Apache-2.0
// The one compare for values an attacker may guess at (a form token, a consent binding). Both sides are hashed to
// SHA-256 first, so the compare always runs over two 32-byte digests: neither where the values differ nor how long
// either is shows in the time it takes (Cloudflare Workers Best Practices; Web Crypto, timingSafeEqual).

export type TimingSafeEqual = (a: ArrayBuffer, b: ArrayBuffer) => boolean;

/** `crypto.subtle.timingSafeEqual`: the Workers runtime's own, not standard Web Crypto. Undefined in plain Node, where the tests run. */
function runtimeCompare(): TimingSafeEqual | undefined {
  const subtle = crypto.subtle as { timingSafeEqual?: TimingSafeEqual };
  return subtle.timingSafeEqual?.bind(crypto.subtle);
}

/** True when `a` and `b` are the same string. `compare` is injectable for tests. */
export async function constantTimeEqual(a: string, b: string, compare: TimingSafeEqual | undefined = runtimeCompare()): Promise<boolean> {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([crypto.subtle.digest('SHA-256', encoder.encode(a)), crypto.subtle.digest('SHA-256', encoder.encode(b))]);
  if (compare) return compare(left, right);
  // Outside the Workers runtime: the same compare by hand, every byte of both digests.
  const other = new Uint8Array(right);
  let difference = 0;
  for (const [index, byte] of new Uint8Array(left).entries()) difference |= byte ^ (other[index] ?? 0);
  return difference === 0;
}
