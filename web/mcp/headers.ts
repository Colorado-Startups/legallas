// SPDX-License-Identifier: Apache-2.0
// The header every legallas-mcp response carries. Its HTML pages set it themselves (mcp/pages/index.ts htmlResponse),
// but the OAuth library's JSON answers (the RFC 8414 and RFC 9728 metadata, /register, /token) and /mcp set none.
// The automated dynamic scan reported the gap (quality-speed/pages/security/dast/).

/** Adds `X-Content-Type-Options: nosniff` when absent, so no browser reads a JSON answer as a page. A 101 passes untouched. */
export function withNosniff(response: Response): Response {
  if (response.status === 101 || response.headers.get('X-Content-Type-Options') === 'nosniff') return response;
  const out = new Response(response.body, response);
  out.headers.set('X-Content-Type-Options', 'nosniff');
  return out;
}
