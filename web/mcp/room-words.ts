// SPDX-License-Identifier: Apache-2.0
// The room's noun in the MCP server's own text: "counsel room" for a case room, "company room" for a room with no
// published matter (worker/room-shape.ts, card 12.1). Applied to the server's fixed strings only, never to a
// document's text or a caller's words.

/** `text` as a room of this shape names itself. A case room's text is returned as it is. */
export function roomWords(text: string, company: boolean): string {
  return company ? text.replace(/\ba litigation counsel room\b/g, 'a company room').replace(/\bcounsel room\b/g, 'company room') : text;
}
