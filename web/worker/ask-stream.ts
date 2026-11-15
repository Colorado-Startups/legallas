// SPDX-License-Identifier: Apache-2.0
// Server-sent events for /api/ask. The browser may first get one `reading` event (how many documents and
// pages were retrieved, counts only), then `delta` events with answer text as the model writes it, then one
// `citations` event (validated server-side), then `done`. An `error` event ends a failed stream.
// `done` carries `truncated: true` when the model stopped at max_tokens, so the browser can say the answer was
// cut off; the citations still cover the text that arrived. The model's own reasoning is never forwarded.
import type { Citation } from './citations.ts';
import type { LawCitation } from './law.ts';

export type AskEvent =
  | { event: 'reading'; data: { documents: number; pages: number; law?: true } }
  | { event: 'delta'; data: { text: string } }
  | { event: 'citations'; data: { citations: Citation[]; law?: LawCitation[] } }
  | { event: 'done'; data: { dontKnow: boolean; truncated?: true } }
  | { event: 'error'; data: { error: string } };

const encoder = new TextEncoder();
/**
 * Enough for any answer under max_tokens (ask.ts MAX_TOKENS, 16,384, at about 4 characters a token, with room);
 * text past this is still streamed but not scanned for citations.
 */
const MAX_SCANNED = 96_000;

/** One SSE frame. JSON.stringify escapes newlines, so the data is always a single line. */
export function sseFrame(e: AskEvent): string {
  return `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`;
}

/**
 * Why the model stopped: `choices[0].finish_reason`, "stop" for a finished answer and "length" when max_tokens ran
 * out (reasoning counts against it). Both glm-5.3-flash and gpt-oss-120b send it on a late frame, gpt-oss with a
 * last piece of content beside it (probed 2026-10-04). Null when the stream never said.
 */
export type StopReason = string | null;

/** Answer text and stop reason from one parsed model event: OpenAI-style deltas, or the classic Workers AI `response`. */
function frameOf(event: unknown): { text: string; stop: StopReason } {
  if (!event || typeof event !== 'object') return { text: '', stop: null };
  const record = event as { choices?: { delta?: { content?: unknown }; finish_reason?: unknown }[]; response?: unknown };
  const choice = record.choices?.[0];
  const stop = typeof choice?.finish_reason === 'string' ? choice.finish_reason : null;
  const content = choice?.delta?.content;
  if (typeof content === 'string') return { text: content, stop };
  return { text: typeof record.response === 'string' ? record.response : '', stop };
}

/**
 * Text deltas from the model's text/event-stream; the generator returns the stop reason (the last one sent).
 * Lines are buffered across reads, so a frame split between two network chunks still parses. Non-JSON lines,
 * `[DONE]` and reasoning fields are skipped. Stopped early (a closed tab, a retried answer), it cancels the stream,
 * so the metered binding underneath settles what the call cost (spend.ts tapUsage).
 */
export async function* modelDeltas(stream: ReadableStream<Uint8Array>): AsyncGenerator<string, StopReason> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let stop: StopReason = null;
  let ended = false;
  const lineFrame = (line: string): { text: string; stop: StopReason } => {
    const none = { text: '', stop: null };
    if (!line.startsWith('data:')) return none;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') return none;
    try {
      return frameOf(JSON.parse(payload));
    } catch {
      return none;
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = done ? '' : (lines.pop() ?? '');
      for (const line of lines) {
        const frame = lineFrame(line);
        stop = frame.stop ?? stop;
        if (frame.text) yield frame.text;
      }
      if (done) {
        ended = true;
        return stop;
      }
    }
  } finally {
    if (!ended) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Visible characters read before deciding whether an answer is degenerate. */
const DEGENERATE_PROBE = 16;
/** Whitespace and invisible format characters (zero-width space, BOM): text made only of these shows nothing. */
const INVISIBLE = /[\s\p{Cf}]/gu;

/** The text with nothing invisible left in it. */
const visible = (text: string): string => text.replace(INVISIBLE, '');

/**
 * Why an answer's opening is not an answer, or null when it is one. `empty`: the stream ended with nothing
 * visible, as when glm-5.3-flash at high effort spends all of max_tokens reasoning (2026-10-04). `bang`: nothing
 * but "!", gpt-oss's failure.
 */
export function degenerate(opening: string): 'empty' | 'bang' | null {
  const text = visible(opening);
  if (text === '') return 'empty';
  return /^!+$/.test(text) ? 'bang' : null;
}

/** Both attempts were degenerate. The message is `degenerate`'s reason; answerStream logs only the name. */
export class DegenerateAnswer extends Error {
  override name = 'DegenerateAnswer';
}

/**
 * Text deltas from `start()`, asked once more when the answer is degenerate: nothing visible at all, or nothing
 * but "!" (gpt-oss on Workers AI now and then writes only "!" until max_tokens, 4 of 110 eval runs, 2026-10-02).
 * The first deltas are held back until DEGENERATE_PROBE visible characters arrive, so a bad stream never
 * reaches the browser. A retry logs its reason only. A second bad stream throws DegenerateAnswer, which
 * answerStream turns into an `error` event. Returns the stop reason of the stream that was answered.
 */
export async function* retryDegenerate(start: () => Promise<ReadableStream<Uint8Array>>): AsyncGenerator<string, StopReason> {
  for (let attempt = 1; ; attempt++) {
    const stream = await start();
    const deltas = modelDeltas(stream);
    let answered = false;
    try {
      let held = '';
      let next = await deltas.next();
      while (!next.done && visible(held).length < DEGENERATE_PROBE) {
        held += next.value;
        next = await deltas.next();
      }
      const reason = degenerate(held);
      if (reason) {
        await deltas.return(null);
        await stream.cancel().catch(() => undefined);
        if (attempt === 2) throw new DegenerateAnswer(reason);
        console.error('ask_answer_retried', reason);
        continue;
      }
      if (held) yield held;
      for (; !next.done; next = await deltas.next()) yield next.value;
      answered = true;
      return next.value;
    } finally {
      // A reader that leaves mid-answer (answerStream's cancel) closes the model stream too.
      if (!answered) await deltas.return(null);
    }
  }
}

export interface Finish {
  citations: Citation[];
  /** Validated law citations; absent when the law library is off, so the event is unchanged then. */
  law?: LawCitation[];
  dontKnow: boolean;
}

/** A stop reason as it may be logged: the API's short lowercase word, never anything longer. */
const loggable = (stop: string): string => (/^[a-z_]{1,24}$/.test(stop) ? stop : 'other');

/**
 * Pipes text deltas to the browser as SSE, then asks `finish` (with the whole answer) for the citations
 * and the verdict. Any failure becomes an `error` event; only the error's type is logged, never text. An
 * answer with nothing visible is a failure too, so the browser never shows a blank reply as done.
 * When `deltas` returns the stop reason "length", `done` says `truncated: true` and the reason is logged; the
 * text that arrived is still validated and shown. `opening`, when given, is sent before the first delta.
 * `failed`, when given, runs once with the error before the `error` event (routes/ask.ts gives the question back
 * when the failure was ours); its own failure is logged and does not stop the event.
 */
export function answerStream(
  deltas: AsyncIterable<string, StopReason | void>,
  finish: (answer: string) => Promise<Finish> | Finish,
  opening?: AskEvent,
  failed?: (error: unknown) => Promise<void>,
): ReadableStream<Uint8Array> {
  let answer = '';
  const iterator = deltas[Symbol.asyncIterator]();
  let finished = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (opening) controller.enqueue(encoder.encode(sseFrame(opening)));
    },
    async pull(controller) {
      if (finished) return;
      try {
        const next = await iterator.next();
        if (!next.done) {
          if (answer.length < MAX_SCANNED) answer += next.value;
          controller.enqueue(encoder.encode(sseFrame({ event: 'delta', data: { text: next.value } })));
          return;
        }
        if (visible(answer) === '') throw new DegenerateAnswer('empty');
        const stop = typeof next.value === 'string' ? next.value : null;
        if (stop !== null && stop !== 'stop') console.error('ask_answer_stopped', loggable(stop));
        const result = await finish(answer);
        const data = result.law ? { citations: result.citations, law: result.law } : { citations: result.citations };
        controller.enqueue(encoder.encode(sseFrame({ event: 'citations', data })));
        // Absent unless cut, so a finished answer's `done` is unchanged.
        const done = stop === 'length' ? { dontKnow: result.dontKnow, truncated: true as const } : { dontKnow: result.dontKnow };
        controller.enqueue(encoder.encode(sseFrame({ event: 'done', data: done })));
      } catch (error) {
        console.error('ask_stream_failed', error instanceof Error ? error.name : typeof error);
        await failed?.(error).catch((refund: unknown) => console.error('ask_refund_failed', refund instanceof Error ? refund.name : typeof refund));
        controller.enqueue(encoder.encode(sseFrame({ event: 'error', data: { error: 'answer_failed' } })));
      }
      finished = true;
      controller.close();
    },
    async cancel() {
      finished = true;
      await iterator.return?.();
    },
  });
}

/** A fixed reply streamed through the same framing, for answers that need no model call. */
export async function* fixedText(text: string): AsyncGenerator<string> {
  yield text;
}

export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
} as const;
