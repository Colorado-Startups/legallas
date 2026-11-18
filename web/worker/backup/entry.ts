// SPDX-License-Identifier: Apache-2.0
// legallas-backup: the room backup's Worker (wrangler.backup.example.jsonc). Only a Cloudflare Workflow: the owner starts
// it with `npm run backup` (scripts/backup.ts), or its own schedule does once the owner adds one. It has no route, no
// workers.dev URL and no preview URL, so nothing on the internet reaches it. The runs themselves: flow.ts.
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep, type WorkflowStepConfig } from 'cloudflare:workers';
import { parseParams, runWorkflow, type BackupEnv, type Step } from './flow.ts';
import { runIdAt } from './layout.ts';
import { digestBody } from './r2.ts';

/** A failed step tries three more times, waiting 30 s, 60 s and 120 s, before the run stops. */
const STEP: WorkflowStepConfig = { retries: { limit: 3, delay: '30 seconds', backoff: 'exponential' }, timeout: '30 minutes' };

/** The Workflow that runs a room's backup, drill or restore. */
export class RoomBackup extends WorkflowEntrypoint<BackupEnv, unknown> {
  async run(event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep): Promise<unknown> {
    const params = parseParams(event.payload);
    // Every step returns plain JSON (counts, hashes, cursors, table plans), which the Workflow persists.
    // `step` is an RPC stub in production: call step.do on it directly. Reading step.do.bind sends "bind" as an RPC
    // method, which fails with "The RPC receiver does not implement the method "bind"" (seen 2026-11-17).
    const durable = step as unknown as { do(name: string, config: WorkflowStepConfig, fn: () => Promise<unknown>): Promise<unknown> };
    const steps: Step = { do: <T>(name: string, fn: () => Promise<T>) => durable.do(name, STEP, fn) as Promise<T> };
    return runWorkflow(this.env, steps, params, runIdAt(event.timestamp, event.instanceId), { hash: digestBody, now: () => Date.now() });
  }
}

export default {
  async fetch(): Promise<Response> {
    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<BackupEnv>;
