// SPDX-License-Identifier: Apache-2.0
// Whether this page is a room with no matter: the Worker marks it on <html> (worker/room-shape.ts).

/** Whether the page is a company room, read from the root element's room-shape attribute. */
export function isCompanyRoom(root: { dataset: DOMStringMap } | undefined = globalThis.document?.documentElement): boolean {
  return root?.dataset.roomShape === 'company';
}
