// SPDX-License-Identifier: Apache-2.0
// What a room adds to the core without the core importing it (the Legallas plan, step 2: the route registry).
// A package calls extendRoom once, when its module loads: pro adds its routes (worker/index.ts), and a room with a
// brand of its own adds its mark and assistant signature from its Worker entries. The core reads them per request
// and never at module load, so the order of an entry's imports does not matter. The remote MCP server's tools and
// pages have their own registry (mcp/extensions.ts); the signature registered here signs its alerts too.
import { neutralSignature, type Signature } from './email-signature.ts';
import { neutralMarkSvg, type MarkSvg } from './mark.ts';
import type { RoomNames } from './room-names.ts';
import type { Route } from './router.ts';

export interface RoomExtension {
  /** Routes served behind the same gate, after the core's (room.ts). Their paths must not overlap the core's. */
  routes?: readonly Route[];
  /** The mark on the Worker's own pages (the 403 page). The Astro pages take theirs from the brand pack. */
  mark?: MarkSvg;
  /** The assistant's signature on every email either Worker sends. */
  signature?: Signature;
}

const routes: Route[] = [];
let mark: MarkSvg | undefined;
let signature: Signature | undefined;

/** Adds routes, in order after any added before, and sets the mark and signature when given (the last one wins). */
export function extendRoom(extension: RoomExtension): void {
  routes.push(...(extension.routes ?? []));
  mark = extension.mark ?? mark;
  signature = extension.signature ?? signature;
}

/** Every route a package added, in the order added. */
export function extensionRoutes(): readonly Route[] {
  return routes;
}

/** The registered mark, else the neutral one (mark.ts). */
export function roomMark(): MarkSvg {
  return mark ?? neutralMarkSvg;
}

/** The registered signature, else the neutral one for these names. */
export function roomSignature(names: Pick<RoomNames, 'assistantName' | 'instanceName'>): Signature {
  return signature ?? neutralSignature(names);
}
