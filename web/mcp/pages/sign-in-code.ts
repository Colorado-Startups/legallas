// SPDX-License-Identifier: Apache-2.0
// Who sends the counsel room's sign-in code (Cloudflare Access one-time PIN), for the shared "If the sign-in code
// doesn't arrive" block on /connect and the per-tool IT steps that link to it. Its own module so connect.ts and the
// tool modules it imports (connect-copilot.ts) can share it without an import cycle.
// Source: developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/, read 2026-10-20.

/** The sign-in code's sender. */
export const CODE_SENDER = 'noreply@notify.cloudflare.com';
/** The IPs Cloudflare documents for that mail, for the firm's allowlist. */
export const CODE_SENDER_IPS = '104.30.16.2 to 104.30.16.7';
/** The shared block's id on /connect. The per-tool guides link to `#sign-in-code`, so it stays fixed. */
export const SIGN_IN_CODE_ID = 'sign-in-code';
/** The same block in the setup kit: its heading's anchor in web/connect/README.md. */
export const SIGN_IN_CODE_GUIDE = 'README.md#if-the-sign-in-code-doesnt-arrive';
