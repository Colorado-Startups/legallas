// SPDX-License-Identifier: Apache-2.0
// The ids of a view page's two JSON blocks, shared by the server that writes them (mcp/apps/views.ts) and the page that
// reads them (bridge.ts). No DOM here, so both type-check it.

/** The room's config: the tool names the page calls and the stored name (views.ts ViewConfig). */
export const CONFIG_ID = 'legallas-view-config';
/** A saved tool result, in a page made for the binder (views.ts viewDocument). */
export const DATA_ID = 'legallas-view-data';
