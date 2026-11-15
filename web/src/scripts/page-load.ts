// SPDX-License-Identifier: Apache-2.0
// A page's load, settled. Everything between a page script's first line and its first full drawing (wiring, the
// fetch of the matter, choosing what to show, drawing it) runs inside settle(), so the page always ends ready, empty
// or on its error line ("did not load; reload the page to try again"), never on its Loading line. A section drawn
// lazily afterwards keeps its own one sentence (whenNear in track-dom.ts). A page script that never runs at all,
// because one of its chunks failed to load, is the boot guard's (boot-guard.ts). A load that failed because the
// sign-in ended (a 401, session-ended.ts) also shows the page's "Your session ended. Reload to sign in." notice.
import { isSessionEnded, showSessionEnded } from './session-ended.ts';

/** Where a page's load ended. */
export type LoadState = 'ready' | 'empty' | 'error';

/**
 * Runs `load` and shows the state it ends in: the one it returns, or 'error' when any step throws or rejects. A
 * page that must be on screen before it draws shows 'ready' itself, draws, then returns 'ready'; a throw while
 * drawing still ends on the error line. `failed` hears the error once the error line shows.
 */
export async function settle(
  show: (state: LoadState) => void,
  load: () => Promise<Exclude<LoadState, 'error'>>,
  failed?: (error: unknown) => void,
): Promise<LoadState> {
  try {
    const state = await load();
    show(state);
    return state;
  } catch (error) {
    try {
      if (isSessionEnded(error)) showSessionEnded();
    } catch {
      // The notice is a courtesy; the error line below still shows.
    }
    show('error');
    failed?.(error);
    return 'error';
  }
}
