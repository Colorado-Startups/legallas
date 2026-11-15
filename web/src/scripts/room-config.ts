// SPDX-License-Identifier: Apache-2.0
// The room's gitignored config at build time, for Astro pages only (import.meta.glob is Vite's; plain Node cannot
// load this file). web/room.config.json wins; web/legallas.config.json, the older name, is the fallback. scripts/config.ts tries the
// same two names in the same order for the scripts (scripts/config.test.ts checks they agree). With neither file, as
// in CI and fresh clones, the build uses each page's generic defaults, and the names worker/room-names.ts's.
import { roomNames, type RoomNames } from '../../worker/room-names.ts';

/** The keys the pages read. Paths and other keys in the file stay with the scripts. */
export interface RoomBuildConfig {
  banner?: string;
  controlPrefix?: string;
  regulatorLabel?: string;
  regulatorName?: string;
  /** The room's own name (worker/room-names.ts); default "Legallas". */
  instanceName?: string;
  /** The AI character's name (worker/room-names.ts); default "Legallas". */
  assistantName?: string;
}

const configs = import.meta.glob<RoomBuildConfig>(['../../room.config.json', '../../legallas.config.json'], {
  eager: true,
  import: 'default',
});

/** The room's build config from room.config.json or legallas.config.json, when either exists. */
export const roomConfig: RoomBuildConfig | undefined =
  configs['../../room.config.json'] ?? configs['../../legallas.config.json'];

/** The instance and assistant names, each falling back to today's default. */
export const names: RoomNames = roomNames(roomConfig ?? {});
