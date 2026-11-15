// SPDX-License-Identifier: Apache-2.0
// The regulator's nav item in Room.astro. Its label comes from the gitignored room config (`regulatorLabel`, default
// "Regulator"). An acronym label is spelled out on hover and to screen readers from `regulatorName` in the same
// config. With no name there is no title at all: the source names no regulator, and a page never shows a guessed or
// empty one.

/** The two config keys this reads (src/scripts/room-config.ts RoomBuildConfig). */
export interface RegulatorConfig {
  regulatorLabel?: string;
  regulatorName?: string;
}

/** The nav label and, for an acronym label with a configured name, its title; otherwise title is undefined. */
export function regulatorNav(config: RegulatorConfig | undefined): { label: string; title: string | undefined } {
  const label = config?.regulatorLabel?.trim() || 'Regulator';
  const name = config?.regulatorName?.trim();
  return { label, title: /^[A-Z]{2,6}$/.test(label) && name ? name : undefined };
}
