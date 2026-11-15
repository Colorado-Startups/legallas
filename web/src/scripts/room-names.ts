// SPDX-License-Identifier: Apache-2.0
// The room's names in the browser (worker/room-names.ts). Room.astro sets <html data-instance-name> and
// data-assistant-name only for a renamed room, so an absent attribute means the default. There is no document at all
// while Astro builds a page, so what a page draws at build time (connect-first.ts AI_CARDS) reads the room's own name
// from its settings, and a Node test, which sets none, gets the default.
import { DEFAULT_ASSISTANT_NAME } from '../../worker/room-names.ts';
import { instanceName as configuredInstanceName } from '../../worker/room-settings.ts';

function rootData(): DOMStringMap | undefined {
  return typeof document === 'undefined' ? undefined : document.documentElement.dataset;
}

/** The room's own name: "Legallas" unless the room is renamed. */
export function instanceName(): string {
  return rootData()?.instanceName || configuredInstanceName;
}

/** The AI character's name: "Legallas" unless the room renames it. */
export function assistantName(): string {
  return rootData()?.assistantName || DEFAULT_ASSISTANT_NAME;
}

/** A page title in the room's form, "<title> | Legallas", as Room.astro writes it. */
export function pageTitle(title: string): string {
  return `${title} | ${instanceName()}`;
}
