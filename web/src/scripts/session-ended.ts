// SPDX-License-Identifier: Apache-2.0
// The room's sign-in can end while a page is open (Cloudflare Access sessions last six hours). A room fetch that then
// follows Access's redirect to its login, on another origin, fails with nothing to say why. Room fetches send
// X-Requested-With: XMLHttpRequest, so Access answers 401 instead, and a 401 shows one notice at the top of the page:
// "Your session ended. Reload to sign in.", the link being this page. Never an automatic reload: the reader chooses,
// and nothing can loop through the login. No imports, so any room helper can use it.

/** The header that turns Access's login redirect into a plain 401 for a room fetch. */
export const ROOM_FETCH_HEADERS: Readonly<Record<string, string>> = { 'X-Requested-With': 'XMLHttpRequest' };

/** Thrown (or returned as a cause) when a room request answers 401: the sign-in has ended. */
export class SessionEndedError extends Error {
  constructor(what = 'room') {
    super(`${what}: 401, the session ended`);
    this.name = 'SessionEndedError';
  }
}

/** True for a SessionEndedError, including one wrapped as another error's cause. */
export function isSessionEnded(error: unknown): boolean {
  for (let e = error, depth = 0; e && depth < 4; e = (e as { cause?: unknown }).cause, depth++) {
    if (e instanceof SessionEndedError || (e as { name?: unknown }).name === 'SessionEndedError') return true;
  }
  return false;
}

/** The few DOM calls the notice needs, so tests can pass a stand-in for document. */
export interface NoticeDoc {
  querySelector(selector: string): { prepend(node: unknown): void } | null;
  createElement(tag: string): { className: string; textContent: string | null; setAttribute(name: string, value: string): void; append(...nodes: unknown[]): void; href?: string };
  createTextNode(text: string): unknown;
  location?: { href: string };
}

/**
 * Shows the notice once per page, at the top of <main>. Returns true when it is (newly or already) on the page;
 * false without a document or a <main> (a test, the Worker).
 */
export function showSessionEnded(doc: NoticeDoc | undefined = globalThis.document as unknown as NoticeDoc | undefined): boolean {
  if (!doc) return false;
  if (doc.querySelector('[data-session-ended]')) return true;
  const main = doc.querySelector('main');
  if (!main) return false;
  const notice = doc.createElement('p');
  notice.className = 'c-callout';
  notice.setAttribute('role', 'alert');
  notice.setAttribute('data-session-ended', '');
  const link = doc.createElement('a');
  link.setAttribute('href', doc.location?.href ?? '');
  link.textContent = 'Reload to sign in.';
  notice.append(doc.createTextNode('Your session ended. '), link);
  main.prepend(notice);
  return true;
}
