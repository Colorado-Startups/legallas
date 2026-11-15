// SPDX-License-Identifier: Apache-2.0
// The lane for one deal room, `vc` or `angel`: its gate tests now. Its guest journeys join once deal rooms exist (#23).
import { collect } from './collect-lab.ts';

const room = process.argv[2];
if (room !== 'vc' && room !== 'angel') throw new Error('usage: collect-deal.ts vc|angel --out <file>');
collect(room, `raising-${room}`, []);
