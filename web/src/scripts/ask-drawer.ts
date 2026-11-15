// SPDX-License-Identifier: Apache-2.0
// The Ask drawer's always-loaded part (card P7): the header's kbd hint (⌘K on Apple platforms, Ctrl K
// elsewhere; a script because CSP blocks inline script, R36), the Ask button and the shortcut. The drawer
// itself (chat-drawer.ts) loads on first use, so pages that never ask pay only for this file.
//
// On the Ask page the button and shortcut go to the page's own question box instead of a drawer. Other
// scripts (the Legallas guide's orders) call openAsk(question) to open Ask with a question filled in.

/** True on macOS, iOS and iPadOS, where the shortcut is ⌘K. */
export function isApple(nav: Pick<Navigator, 'userAgent'> & { userAgentData?: { platform?: string } } = navigator): boolean {
  const platform = nav.userAgentData?.platform ?? nav.userAgent;
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}

/** The kbd hint and the event check for this platform's shortcut. */
export function shortcut(apple: boolean): { hint: string; matches(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>): boolean } {
  return {
    hint: apple ? '⌘K' : 'Ctrl K',
    matches: (event) =>
      event.key.toLowerCase() === 'k' && !event.altKey && !event.shiftKey && (apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey),
  };
}

/**
 * A prefilled question as the box should show it: control characters dropped, trimmed, at most `max`
 * characters (counted as code points, like the Ask box's own count).
 */
export function cleanQuestion(text: string, max: number): string {
  const clean = text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();
  return [...clean].slice(0, max).join('');
}

/**
 * Opens Ask: on the Ask page, its own question box; elsewhere, the drawer (loaded on first use). A `question`
 * fills the box before focus, replacing what was there. Never sends; the reader presses Ask.
 */
export function openAsk(question?: string, trigger: HTMLElement | null = null): void {
  const pageInput = document.querySelector<HTMLTextAreaElement>('[data-chat-input]');
  if (pageInput) {
    if (question !== undefined) {
      pageInput.value = cleanQuestion(question, pageInput.maxLength > 0 ? pageInput.maxLength : Infinity);
      // The page's count and companion follow the box through its input event.
      pageInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    pageInput.focus();
    pageInput.setSelectionRange(pageInput.value.length, pageInput.value.length);
    pageInput.scrollIntoView({ block: 'nearest' });
    return;
  }
  void import('./chat-drawer.ts').then((drawer) => drawer.openDrawer(trigger, question));
}

function start(): void {
  if (typeof document === 'undefined') return;
  const keys = shortcut(isApple());
  for (const button of document.querySelectorAll<HTMLElement>('[data-ask-open]')) {
    const kbd = button.querySelector('kbd');
    if (kbd) kbd.textContent = keys.hint;
    button.setAttribute('aria-keyshortcuts', isApple() ? 'Meta+K' : 'Control+K');
    button.addEventListener('click', () => openAsk(undefined, button));
  }
  document.addEventListener('keydown', (event) => {
    if (!keys.matches(event) || event.defaultPrevented) return;
    event.preventDefault();
    openAsk(undefined, document.activeElement instanceof HTMLElement ? document.activeElement : null);
  });
}

start();
