// SPDX-License-Identifier: Apache-2.0
// A node:test reporter that writes one JSON line per test and per file: the outcome and the time, nothing else.

interface Event {
  type: string;
  data: { file?: string; name?: string; nesting?: number; skip?: unknown; todo?: unknown; details?: { duration_ms?: number }; duration_ms?: number };
}

export default async function* reporter(source: AsyncIterable<Event>): AsyncGenerator<string> {
  for await (const { type, data } of source) {
    if ((type === 'test:pass' || type === 'test:fail') && !data.skip && !data.todo) {
      yield `${JSON.stringify({ file: data.file, name: `${data.nesting}:${data.name}`, passed: type === 'test:pass', ms: data.details?.duration_ms })}\n`;
    } else if (type === 'test:summary' && data.file) {
      yield `${JSON.stringify({ file: data.file, ms: data.duration_ms })}\n`;
    }
  }
}
