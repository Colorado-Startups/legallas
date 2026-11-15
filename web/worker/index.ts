// SPDX-License-Identifier: Apache-2.0
// The room with pro: the core's gate and router (room.ts) plus Ask, the research
// chat, the case manifest and the visual binder, added through extensions.ts and served behind the same gate. Tests
// that reach a pro route load this file; core's own tests load room.ts. Like room.ts, it must never import
// cloudflare:workers or agents: tests load it under plain Node, and the Worker entries export the Durable Object class
// instead (worker/entry-pro.ts, worker/config.test.ts).
import { routes as researchRoutes } from './agent/routes.ts';
import { extendRoom } from './extensions.ts';
import { routes as askRoutes } from './routes/ask.ts';
import { routes as matterRoutes } from './routes/matter.ts';
import { routes as visualsRoutes } from './routes/visuals.ts';

extendRoom({ routes: [...visualsRoutes, ...matterRoutes, ...askRoutes, ...researchRoutes] });

export { CORE_ROUTES, handle, roomRoutes } from './room.ts';
export { default } from './room.ts';
