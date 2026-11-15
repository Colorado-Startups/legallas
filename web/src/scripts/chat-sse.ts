// SPDX-License-Identifier: Apache-2.0
// Reads a server-sent event stream (Ask's /api/ask, an MCP server's replies): `event: <name>` and `data: <json>`
// lines, frames split by a blank line.
// Text arrives in arbitrary network chunks, so partial frames are buffered until complete.

/** One server-sent event: its name and its data. */
export interface SseEvent {
  event: string;
  data: unknown;
}

/** An incremental event parser: push streamed text in, and read the complete events out. */
export interface SseParser {
  push(text: string): SseEvent[];
  end(): SseEvent[];
}

function parseFrame(frame: string): SseEvent | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  if (data.length === 0) return null;
  try {
    return { event, data: JSON.parse(data.join('\n')) };
  } catch {
    return null;
  }
}

/** Creates a parser that buffers streamed text and returns each complete event. */
export function sseParser(): SseParser {
  let buffer = '';
  const take = (final: boolean): SseEvent[] => {
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = final ? '' : (frames.pop() ?? '');
    return frames.map(parseFrame).filter((e): e is SseEvent => e !== null);
  };
  return {
    push(text) {
      buffer += text;
      return take(false);
    },
    end() {
      return take(true);
    },
  };
}
