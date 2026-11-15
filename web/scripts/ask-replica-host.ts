// SPDX-License-Identifier: Apache-2.0
// The Ask replica on the room's own model host (scripts/ask-replica.ts --provider host): the same retrieval, turn and
// scoring, with each answer's whole turn sent to the host that wrangler.jsonc's ASK_HOST describes (worker/ask-host.ts),
// as the room sends it once the host's gate is open (worker/ask-provider.ts). The gate must pass on the host before the
// room may use it: ASK_HOST.eval_runs then names the passing runs, as ASK_GROQ.eval_runs does for Groq.
//
// Case content reaches the host only under zero data retention (SECURITY.md), so a run refuses unless the evaluated
// commit's wrangler.jsonc says ASK_HOST.zdr_confirmed (the owner's word that the host keeps no inputs or outputs) and
// describes a usable host (an https url and a model). The key comes from REPLICA_EVAL_HOST_API_KEY (the replica-eval
// environment's secret), never an argument. On OpenRouter every request carries its zero-data-retention routing.
//
// A 429 stops the run (HostStop) and is never retried; the gate then reads INCOMPLETE. Any other failure is the
// answer's error (host_http_<n>), which also makes the gate INCOMPLETE. Every message here may print in the Replica
// eval workflow's log, so each matches SAFE_LINES in scripts/ask-eval-gate.ts (ask-eval-gate.test.ts checks them):
// never the host's URL, its error body or the key.
import { ChatRefused, ChatUnavailable, type Fetcher } from '../worker/ask-chat.ts';
import { hostChat, hostConfig, type HostTarget, type hostInput } from '../worker/ask-host.ts';
import { roomVar } from './ask-replica-groq.ts';

/** The secret's name in the Replica eval workflow. */
export const HOST_KEY_ENV = 'REPLICA_EVAL_HOST_API_KEY';

export const HOST_NO_ZDR = '--provider host needs ASK_HOST.zdr_confirmed true in wrangler.jsonc: the owner confirms the host keeps no inputs or outputs first';
export const HOST_UNUSABLE = '--provider host needs ASK_HOST.url (https) and ASK_HOST.model in wrangler.jsonc, and a body with no reserved field';
export const HOST_NO_KEY = `--provider host needs ${HOST_KEY_ENV} set`;
export const HOST_STOP_429 = "Stopped by the host's rate limit (HTTP 429). Nothing more was sent.";

/** The run stopped for the host's limits (a 429). Nothing more is sent. */
export class HostStop extends Error {
  override name = 'HostStop';
}

/** Holds the run's one stop: after a 429, every later call throws the same HostStop. */
export class HostHalt {
  private halted: HostStop | null = null;

  /** The HostStop that ended this run, or null while it may go on. */
  stopped(): HostStop | null {
    return this.halted;
  }

  stop(): HostStop {
    this.halted ??= new HostStop(HOST_STOP_429);
    return this.halted;
  }
}

/**
 * The host, its model and its key for a run, or an error with a fixed message: zero data retention unconfirmed, an
 * unusable description, or no key. `enabled` and `eval_runs` are not needed: this run is how a room earns them.
 */
export function hostRunTarget(env: Record<string, string | undefined> = process.env, value: unknown = roomVar('ASK_HOST')): HostTarget & { apiKey: string } {
  const config = hostConfig(value);
  if (!config.zdr_confirmed) throw new Error(HOST_NO_ZDR);
  if (config.url === null || config.model === null || config.body === null) throw new Error(HOST_UNUSABLE);
  const apiKey = env[HOST_KEY_ENV]?.trim() ?? '';
  if (!apiKey) throw new Error(HOST_NO_KEY);
  return { url: config.url, model: config.model, body: config.body, apiKey };
}

/**
 * A host streaming call for the replica, shaped like ask-replica.ts restGenerate: the stream for the turn, and the raw
 * text/event-stream for the call's shape. A 429 stops the run; any other failure throws its status word
 * (host_http_<n>), which scores as an errored answer and so makes the gate INCOMPLETE.
 */
export function hostGenerate(fetcher: Fetcher, target: { url: string; apiKey: string }, halt: HostHalt) {
  return async (input: Record<string, unknown>): Promise<{ stream: ReadableStream<Uint8Array>; sse: Promise<string> }> => {
    const stopped = halt.stopped();
    if (stopped) throw stopped;
    let body: ReadableStream<Uint8Array>;
    try {
      body = await hostChat(fetcher, target, input as ReturnType<typeof hostInput>);
    } catch (error) {
      if (error instanceof ChatRefused) throw halt.stop();
      throw new Error(error instanceof ChatUnavailable ? error.message : 'host_failed');
    }
    const [stream, copy] = body.tee();
    return { stream, sse: new Response(copy).text().catch(() => '') };
  };
}
