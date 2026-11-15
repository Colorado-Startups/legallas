// SPDX-License-Identifier: Apache-2.0
// The Ask replica's runs (scripts/ask-replica.ts): what one model call streamed (answer text, stop reason, usage),
// one scored answer, and the run summary. Pure, so it is tested without a network.
import { citedRefs, type Citation } from '../worker/citations.ts';
import { percentile, type ScoredRun } from './ask-eval-report.ts';
import type { Check, EvalItem, EvalResult, Verdict } from './ask-eval-score.ts';

/** Workers AI bills $0.011 per 1,000 neurons; every stream's last usage frame carries its neurons. */
export const USD_PER_NEURON = 0.011 / 1000;

/** One model call's answer text and why it stopped, from its raw stream. Reasoning is not answer text. */
export function streamAnswer(sse: string): { text: string; finish: string | null } {
  let text = '';
  let finish: string | null = null;
  for (const line of sse.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    try {
      const choice = (JSON.parse(line.slice(5)) as { choices?: { delta?: { content?: unknown }; finish_reason?: unknown }[] }).choices?.[0];
      if (typeof choice?.delta?.content === 'string') text += choice.delta.content;
      if (typeof choice?.finish_reason === 'string') finish = choice.finish_reason;
    } catch {
      // [DONE] and partial lines carry neither.
    }
  }
  return { text, finish };
}

/** One model call: its completion tokens (reasoning included), no visible answer, stopped at max_tokens. */
export interface Call {
  tokens: number;
  blank: boolean;
  cut: boolean;
}

/** A model call's shape from its raw stream; "visible" is what worker/ask-stream.ts degenerate() would call empty. */
export function callShape(sse: string): Call {
  const { text, finish } = streamAnswer(sse);
  return { tokens: streamUsage(sse)?.completionTokens ?? 0, blank: text.replace(/[\s\p{Cf}]/gu, '') === '', cut: finish === 'length' };
}

/**
 * Total neurons and tokens from a model stream: Workers AI's last frame that carries `response` and `usage`, or Groq's
 * last frame with `x_groq.usage` (tokens only: Groq spends no neurons).
 */
export function streamUsage(sse: string): { neurons: number; promptTokens: number; completionTokens: number } | null {
  let total: { neurons: number; promptTokens: number; completionTokens: number } | null = null;
  for (const line of sse.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    try {
      const frame = JSON.parse(line.slice(5)) as { response?: unknown; choices?: unknown; usage?: Record<string, unknown>; x_groq?: { usage?: Record<string, unknown> } };
      const groq = frame.x_groq?.usage;
      if (groq && typeof groq === 'object') {
        total = { neurons: 0, promptTokens: Number(groq.prompt_tokens) || 0, completionTokens: Number(groq.completion_tokens) || 0 };
        continue;
      }
      const usage = frame.usage;
      if (!usage || frame.choices !== undefined || typeof frame.response !== 'string') continue;
      total = { neurons: Number(usage.neurons) || 0, promptTokens: Number(usage.prompt_tokens) || 0, completionTokens: Number(usage.completion_tokens) || 0 };
    } catch {
      // [DONE] and partial lines are not usage.
    }
  }
  return total;
}

/** Cites the answer wrote (distinct id and page) and how many of them survived validation. */
export function citeValidity(answer: string, citations: readonly Pick<Citation, 'id' | 'page'>[]): { written: number; valid: number } {
  const written = new Set(citedRefs(answer).map((ref) => `${ref.id}:${ref.page}`));
  const valid = new Set(citations.map((c) => `${c.id}:${c.page}`));
  return { written: written.size, valid: [...written].filter((key) => valid.has(key)).length };
}

export interface Run {
  id: string;
  kind: EvalItem['kind'];
  rep: number;
  verdict: Verdict;
  failed: string[];
  firstMs: number | null;
  doneMs: number;
  neurons: number;
  promptTokens: number;
  completionTokens: number;
  cites: { written: number; valid: number; garbled: number };
  /** Every model call this answer made, the retried one included. */
  calls: Call[];
  /** retryDegenerate returned the stop reason "length": Ask would show this answer with the cut-off note. */
  truncated: boolean;
  result: EvalResult;
  /** The item's category (eval v2 only), whether it is blocked, and every check with its counts. */
  category?: string;
  blocked?: boolean;
  checks?: Check[];
  /** The model's own text before the room shaped it (worker/answer-shape.ts); `result.answer` is the shaped text. */
  raw?: string;
  /** Counts from shaping: unresolved short ids, relabelled and attributed claims (worker/answer-shape.ts ShapeStats). */
  shape?: Record<string, unknown>;
}

export interface Summary {
  runs: number;
  pass: number;
  review: number;
  fail: number;
  errors: number;
  notFailByRep: number[];
  citesWritten: number;
  citesValid: number;
  garbledIds: number;
  controlsRight: string;
  injectionsResisted: string;
  firstP50: number | null;
  doneP50: number | null;
  doneP95: number | null;
  usdPerQuestion: number;
  usd: number;
  /** Model calls, those with no visible answer, and those stopped at max_tokens. */
  modelCalls: number;
  blankCalls: number;
  cutCalls: number;
  /** Answers Ask would mark truncated (the stop reason of the call that was answered). */
  truncatedAnswers: number;
  /** Completion tokens (reasoning included) per model call. */
  callTokensP50: number | null;
  callTokensP95: number | null;
  callTokensMax: number | null;
}

export function summarize(runs: readonly Run[]): Summary {
  const count = (v: Verdict) => runs.filter((r) => r.verdict === v).length;
  const reps = [...new Set(runs.map((r) => r.rep))].sort((a, b) => a - b);
  const of = (kind: EvalItem['kind'], ok: (r: Run) => boolean) => {
    const these = runs.filter((r) => r.kind === kind);
    return `${these.filter(ok).length}/${these.length}`;
  };
  const neurons = runs.reduce((sum, r) => sum + r.neurons, 0);
  const done = runs.filter((r) => r.result.error === null).map((r) => r.doneMs);
  const calls = runs.flatMap((r) => r.calls);
  const tokens = calls.map((c) => c.tokens);
  return {
    runs: runs.length,
    pass: count('pass'),
    review: count('review'),
    fail: count('fail'),
    errors: runs.filter((r) => r.result.error !== null).length,
    notFailByRep: reps.map((rep) => runs.filter((r) => r.rep === rep && r.verdict !== 'fail').length),
    citesWritten: runs.reduce((sum, r) => sum + r.cites.written, 0),
    citesValid: runs.reduce((sum, r) => sum + r.cites.valid, 0),
    garbledIds: runs.reduce((sum, r) => sum + r.cites.garbled, 0),
    controlsRight: of('control', (r) => !r.failed.includes('dont_know_verdict')),
    injectionsResisted: of('injection', (r) => r.verdict === 'pass'),
    firstP50: percentile(runs.flatMap((r) => (r.firstMs === null ? [] : [r.firstMs])), 50),
    doneP50: percentile(done, 50),
    doneP95: percentile(done, 95),
    usdPerQuestion: runs.length ? (neurons * USD_PER_NEURON) / runs.length : 0,
    usd: neurons * USD_PER_NEURON,
    modelCalls: calls.length,
    blankCalls: calls.filter((c) => c.blank).length,
    cutCalls: calls.filter((c) => c.cut).length,
    truncatedAnswers: runs.filter((r) => r.truncated).length,
    callTokensP50: percentile(tokens, 50),
    callTokensP95: percentile(tokens, 95),
    callTokensMax: tokens.length ? Math.max(...tokens) : null,
  };
}

/** A run as the v2 report reads it (scripts/ask-eval-report.ts). */
export function toScored(run: Run): ScoredRun {
  return {
    id: run.id,
    category: run.category ?? null,
    kind: run.kind,
    rep: run.rep,
    blocked: run.blocked ?? false,
    verdict: run.verdict,
    checks: run.checks ?? [],
    error: run.result.error,
    neurons: run.neurons,
    doneMs: run.doneMs,
  };
}
