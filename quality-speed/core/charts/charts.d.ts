// SPDX-License-Identifier: Apache-2.0
// Types for the pure helpers in charts.js.

export function wholeScore(exact: number): number;
export function totalOf(q: number, s: number, c?: number): number;
/** A base with any part missing (null) comes back unchanged, whatever is ticked. */
export function roadState<B extends { q: number | null; s: number | null; c?: number | null; total: number | null }>(
  base: B,
  fixes: { id: string; q: number; s: number; c?: number }[],
  onIds: string[],
): (B extends { q: number; s: number; total: number } ? { q: number; s: number; c?: number; total: number } : { q: number | null; s: number | null; c?: number | null; total: number | null });
export function compareCells(a: string, b: string, numeric: boolean, direction: 'ascending' | 'descending'): number;
export function shareLoad<T>(load: () => Promise<T>): () => Promise<T>;
export function replayRow(figs: Iterable<unknown>, row: { rings: Record<string, { q: number | null; s: number | null; c?: number | null; total: number | null }> }): void;
export function builtRow(figs: Iterable<unknown>): { rings: Record<string, { q: number; s: number; c?: number; total: number }> };
