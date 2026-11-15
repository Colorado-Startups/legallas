// SPDX-License-Identifier: Apache-2.0
// The automated dynamic scan's tools, pinned in one place. run.ts pulls the image by digest and refuses the add-on
// unless its SHA-256 matches. Both are Apache-2.0 (README.md, "Tools"), run only inside the CI job, and never ship.

/** OWASP ZAP's official image: the `stable` tag on 2026-11-05, which is 2.17.0, rebuilt 2026-11-03. The digest wins over the tag. */
export const ZAP_IMAGE = 'ghcr.io/zaproxy/zaproxy:2.17.0@sha256:9624669db72f54d86c4b46a7064518bd9bf79d8c61a4c31befa9923489f328af';
export const ZAP_VERSION = '2.17.0';

/**
 * ZAP's MCP add-on, which imports an MCP server's tools so the active scanner can attack each tool's arguments. It is
 * alpha, so the stable image leaves it out; it loads from ZAP's home folder.
 */
export const MCP_ADDON = {
  version: '0.4.0',
  file: 'mcp-alpha-0.4.0.zap',
  url: 'https://github.com/zaproxy/zap-extensions/releases/download/mcp-v0.4.0/mcp-alpha-0.4.0.zap',
  sha256: '4aef855074cdc1e19bc40d281fa52d72d8f73a249d4cada73c0aab808f4d12c0',
} as const;
