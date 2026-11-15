// SPDX-License-Identifier: Apache-2.0
// The Worker entry for a remote MCP server with pro: the core server (index.ts) with pro's tools and pages
// (pro.ts). A core-only server's entry is index.ts itself.
import './pro.ts';

export * from './index.ts';
export { default } from './index.ts';
