// SPDX-License-Identifier: Apache-2.0
// The room's neutral mark as inline SVG: an arched doorway in a square wall, for a room that ships no brand of its own.
// A room with its own mark registers it (extensions.ts, for the Worker's 403 page) and puts it in its brand pack's
// mark.ts (src/scripts/brand.ts, for the Astro pages). It uses the seal-* classes, so public/welcome/door.css colors and
// draws it on the front door and src/styles/legallas-mark.css draws it in one ink in the room. The markup carries no
// style attribute (the page CSP has no 'unsafe-inline'). No imports, so the Worker, the scripts and the pages can use it.

/** A mark's markup; `animated` adds the `seal-animated` class, which door.css uses for the arrival motion. */
export type MarkSvg = (animated: boolean) => string;

export const neutralMarkSvg: MarkSvg = (animated) => {
  const classes = animated ? 'seal seal-animated' : 'seal';
  return (
    `<svg class="${classes}" viewBox="0 0 48 48" aria-hidden="true" focusable="false">` +
    '<rect class="seal-ring seal-ring-1" x="9" y="9" width="30" height="30" rx="5" pathLength="1"/>' +
    '<path class="seal-ring seal-ring-2" d="M18 39V24a6 6 0 0 1 12 0v15" pathLength="1"/>' +
    '<circle class="seal-dot" cx="26.5" cy="31" r="1.4"/>' +
    '</svg>'
  );
};
