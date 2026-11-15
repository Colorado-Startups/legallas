// SPDX-License-Identifier: Apache-2.0
import { mcpHost } from './room-settings.ts';
// Old room paths that moved in the redesign (card P5a). Case files and Inbox both became /documents/: the old
// tree is its folder index, and Inbox is the counsel-uploads folder, selected by the #from-counsel hash.
//
// /connect is the one target on another host: Connect AI lives on legallas-mcp (mcp/contract.ts MCP_ORIGIN and
// CONNECT_PATH), whose /connect is a public setup page. The target is a fixed https URL on the same site, never
// built from the request, so this is no open redirect; and index.ts reaches redirectFor() only after the Access
// token and the members row are checked, so the redirect itself is for members only.

/** Connect AI's setup page on legallas-mcp; the header's "Connect AI" link points at the same URL (Room.astro). */
export const CONNECT_URL = `https://${mcpHost}/connect`;

/** Exact paths (with and without the trailing slash) mapped to their new home: a room path, or CONNECT_URL. */
export const REDIRECTS: Readonly<Record<string, string>> = {
  '/case-files': '/documents/',
  '/case-files/': '/documents/',
  '/inbox': '/documents/#from-counsel',
  '/inbox/': '/documents/#from-counsel',
  '/connect': CONNECT_URL,
  '/connect/': CONNECT_URL,
};

/**
 * The new location for `url`, keeping its query and hash, or null when the path has not moved. A target with
 * its own hash keeps that hash unless the old URL carried one (an old /case-files/#<folder> link still lands
 * on that folder).
 */
export function redirectFor(url: URL, table: Readonly<Record<string, string>> = REDIRECTS): string | null {
  const target = table[url.pathname];
  if (!target) return null;
  const hashAt = target.indexOf('#');
  const path = hashAt === -1 ? target : target.slice(0, hashAt);
  const hash = url.hash || (hashAt === -1 ? '' : target.slice(hashAt));
  return `${path}${url.search}${hash}`;
}
