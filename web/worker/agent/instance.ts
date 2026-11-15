// SPDX-License-Identifier: Apache-2.0
// Which research Durable Objects belong to whom (D10, D12): the member's own instance and one per thread, all named
// from the verified email only. worker/index.ts passes the member row's email (auth.ts verified the Access JWT and
// normalized it), never anything from the URL, a header or a message, so no request can name another member's
// instance.

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The member's own instance: sha256("research:" + email) in hex, so the email itself is never a name. It holds the
 * member's thread index (threads.ts).
 */
export function researchInstanceName(email: string): Promise<string> {
  return sha256Hex(`research:${email}`);
}

/**
 * One thread's instance, from the same verified email and a server-minted thread id. A thread id from another member
 * names an instance of the asker's own, so it can never reach someone else's thread (and the index refuses it first).
 */
export function researchThreadName(email: string, threadId: string): Promise<string> {
  return sha256Hex(`research:${email}\nthread:${threadId}`);
}
