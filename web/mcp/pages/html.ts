// SPDX-License-Identifier: Apache-2.0
// Shared building blocks for the legallas-mcp pages: escaping, the page frame and small formatters. Every page
// is a self-contained HTML string (inline <style>, no scripts, no external assets) served by htmlResponse.
import { DEFAULT_INSTANCE_NAME, roomNamesOf, type RoomNameVars } from '../../worker/room-names.ts';
import { ROOM_ORIGIN } from '../contract.ts';
import { STYLES } from './styles.ts';
import { contactEmail, operatorName } from '../../worker/room-settings.ts';

/** Where counsel and their IT reach the owner from these pages (the security.txt contact the legal pages use). */
export const CONTACT = contactEmail;
/** The counsel room's front page, which the header's "Back to the room" link opens. */
export const ROOM_URL = `${ROOM_ORIGIN}/`;

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

/** Escapes text for HTML element content and quoted attribute values. Non-strings are stringified first. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"'`]/g, (ch) => ESCAPES[ch] ?? ch);
}

/** ISO date (YYYY-MM-DD, UTC) for a Unix-seconds time, or null when unset or invalid. */
export function isoDate(seconds: number | null | undefined): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

/** A <time> element for a Unix-seconds time, or the fallback text when there is none. */
export function timeCell(seconds: number | null | undefined, fallback: string): string {
  const iso = isoDate(seconds);
  return iso ? `<time class="u-mono" datetime="${iso}">${iso}</time>` : `<span class="u-quiet">${escapeHtml(fallback)}</span>`;
}

/** The instance name every frame shows (worker/room-names.ts). */
let instanceName = DEFAULT_INSTANCE_NAME;

/**
 * Sets the instance name the frame shows from the Worker's INSTANCE_NAME. mcp/index.ts calls it once per isolate,
 * from the module-level env: a Worker's vars are the same for every request of a deployment.
 */
export function usePageNames(env: Pick<RoomNameVars, 'INSTANCE_NAME'>): void {
  instanceName = roomNamesOf(env).instanceName;
}

interface FrameOptions {
  title: string;
  body: string;
  /** Shown in the header bar's right side ("Signed in as ..."). Escaped here. */
  who?: string;
  /** Links in the footer; the legal pages always appear. */
  nav?: { href: string; label: string }[];
}

/** The full document: lang, title, theme-color, the shared style sheet, a header bar (with the way back to the room), main and footer. */
export function frame(options: FrameOptions): string {
  const who = options.who ? `<p class="bar__who">Signed in as <span class="u-mono">${escapeHtml(options.who)}</span></p>` : '';
  const links = [...(options.nav ?? []), { href: '/privacy', label: 'Privacy' }, { href: '/terms', label: 'Terms' }]
    .map((l) => `<a href="${escapeHtml(l.href)}">${escapeHtml(l.label)}</a>`)
    .join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light">
<meta name="theme-color" content="#1F3A2E">
<title>${escapeHtml(options.title)} | ${escapeHtml(instanceName)} counsel room</title>
<style>${STYLES}</style>
</head>
<body>
<header class="bar"><div class="bar__inner"><p class="bar__brand">${SEAL}<span>${escapeHtml(instanceName)}</span></p><div class="bar__end">${who}<a class="bar__room" href="${ROOM_URL}">Back to the room</a></div></div></header>
<main class="page">
${options.body}
</main>
<footer class="foot"><nav aria-label="Site">${links}</nav><p>Operated by ${operatorName}</p></footer>
</body>
</html>`;
}

/** The seal: target rings with a leaf, single ink (currentColor), decorative. */
const SEAL = '<svg class="bar__seal" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10.25" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M9.5 7.5v7.5h5.5" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="square"/></svg>';

/** A hidden input with an escaped name and value. */
export function hidden(name: string, value: string): string {
  return `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`;
}
