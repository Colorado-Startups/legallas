// SPDX-License-Identifier: Apache-2.0
// Sign out also forgets quick Ask history on this browser and closes the member's research sockets. Loaded on every
// page (Room.astro), because a member can sign out from anywhere. Both run at once, and the browser goes to Access
// logout when they finish or after CLEAR_TIMEOUT_MS, whichever comes first: neither can hold sign-out up.
//
// The research call (worker/agent/routes.ts signout) closes every research socket the member holds, in every tab,
// before Access ends the session. It is a keepalive POST, so it completes even as the page leaves; any failure is
// ignored. Research threads themselves stay in the room (plan D12): sign-out does not delete them.
import { RESEARCH_PATHS } from '../../worker/agent/protocol.ts';
import { clearHistory } from './chat-store.ts';
// The Ask drawer's trigger and shortcut ride along: this is the chat script Room.astro loads on every page.
import './ask-drawer.ts';

/** The Cloudflare Access path that signs the member out. */
export const LOGOUT = '/cdn-cgi/access/logout';
/** Never hold sign-out hostage to a stuck database or request. */
export const CLEAR_TIMEOUT_MS = 1500;

/** Asks the room to close this member's research sockets. Resolves whatever happens, never rejects. */
export function researchSignout(doFetch: typeof fetch = fetch): Promise<void> {
  return Promise.resolve()
    .then(() => doFetch(RESEARCH_PATHS.signout, { method: 'POST', credentials: 'same-origin', keepalive: true }))
    .then(() => undefined, () => undefined);
}

/** What sign-out does before leaving; tests pass stand-ins. */
export interface SignoutSteps {
  clear(): Promise<void>;
  research(): Promise<void>;
  go(url: string): void;
}

const STEPS: SignoutSteps = {
  clear: clearHistory,
  research: () => researchSignout(),
  go: (url) => window.location.assign(url),
};

/** Clears quick Ask history and closes research sockets, then goes to Access logout, at the latest after `timeoutMs`. */
export async function signOut(steps: SignoutSteps = STEPS, timeoutMs = CLEAR_TIMEOUT_MS): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => (timer = setTimeout(resolve, timeoutMs)));
  const work = Promise.all([steps.clear().catch(() => undefined), steps.research().catch(() => undefined)]);
  await Promise.race([work, timeout]);
  clearTimeout(timer);
  steps.go(LOGOUT);
}

if (typeof document !== 'undefined') {
  for (const link of document.querySelectorAll<HTMLAnchorElement>(`a[href="${LOGOUT}"]`)) {
    link.addEventListener('click', (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      void signOut();
    });
  }
}
