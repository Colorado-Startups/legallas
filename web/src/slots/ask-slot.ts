// SPDX-License-Identifier: Apache-2.0
// The Ask slot, loaded on every page by Room.astro: the litigation
// pack's chat-signout.ts, which brings the Ask drawer's trigger and shortcut and forgets quick Ask history at sign-out.
// The glob matches it when the pack is in the tree and nothing in a core-only room, where this script does nothing
// and the Access sign-out link works as a plain link.
import.meta.glob('../scripts/chat-signout.ts', { eager: true });
