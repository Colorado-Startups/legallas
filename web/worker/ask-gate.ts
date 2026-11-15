// SPDX-License-Identifier: Apache-2.0
// The one gate in front of every model backend outside the room's own Cloudflare account: Groq (ASK_GROQ,
// ask-provider.ts groqGate) and the room's own OpenAI-compatible host (ASK_HOST, ask-host.ts hostGate). Case text
// reaches such a backend only when all of these hold, checked in this order so the log names the first thing missing:
// - the room config (a Worker var in wrangler.jsonc) says `enabled`;
// - it says `zdr_confirmed`: the owner's word that the backend keeps no inputs or outputs (Zero Data Retention). The
//   code cannot read a provider's settings, so the flag is the gate (SECURITY.md: case content goes only to
//   zero-data-retention processors);
// - it names in `eval_runs` the Replica eval workflow runs that passed the release gate on that backend
//   (.github/workflows/replica-eval.yml; web/README.md "Production releases");
// - for a backend the room describes itself (ASK_HOST), its URL, model and extra fields are usable;
// - the request is not local development without the remote-AI opt-in (LEGALLAS_DEV_REMOTE_AI, the same one the
//   billed bindings need, spend.ts);
// - the backend's key is set as a Worker secret.
// Anything else, an unset or malformed var included, keeps the backend closed and Ask answers as before.
//
// Pure, with no Workers types, so worker/ and scripts/ both import it.

/** The fields every outside backend's room config shares, read strictly: only `true` is true. */
export interface BackendConfig {
  enabled: boolean;
  zdr_confirmed: boolean;
  /** GitHub Actions run ids of passing Replica eval runs on this backend. */
  eval_runs: string[];
}

/** A GitHub Actions run id. */
const RUN_ID = /^[1-9][0-9]{5,19}$/;

/** A JSON object var as wrangler hands it over, or the same as a JSON string; anything else is an empty record. */
export function configRecord(value: unknown): Record<string, unknown> {
  let raw = value;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = null;
    }
  }
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

/** The shared fields of a backend's room config; anything malformed is all off. */
export function backendConfig(value: unknown): BackendConfig {
  const record = configRecord(value);
  const runs = Array.isArray(record.eval_runs) ? record.eval_runs.map((run) => String(run)).filter((run) => RUN_ID.test(run)) : [];
  return { enabled: record.enabled === true, zdr_confirmed: record.zdr_confirmed === true, eval_runs: runs };
}

/** Why a backend is closed, as a log word. `bad_host` is only ASK_HOST's: its URL, model or extra fields are unusable. */
export type GateClosed = 'off' | 'zdr_unconfirmed' | 'no_eval' | 'bad_host' | 'local' | 'no_key';

export type Gate = { open: true; apiKey: string } | { open: false; reason: GateClosed };

export interface GateOptions {
  /** Local development without LEGALLAS_DEV_REMOTE_AI (routes/ask.ts): never reaches an outside backend. */
  local?: boolean;
  /** Whether the backend's own description (ASK_HOST's URL, model, body) is usable; Groq's is fixed in code. */
  usable?: boolean;
}

/** The gate: open only with every condition above met, the key trimmed. */
export function backendGate(config: BackendConfig, key: string | undefined, options: GateOptions = {}): Gate {
  if (!config.enabled) return { open: false, reason: 'off' };
  if (!config.zdr_confirmed) return { open: false, reason: 'zdr_unconfirmed' };
  if (config.eval_runs.length === 0) return { open: false, reason: 'no_eval' };
  if (options.usable === false) return { open: false, reason: 'bad_host' };
  if (options.local) return { open: false, reason: 'local' };
  const apiKey = key?.trim() ?? '';
  if (!apiKey) return { open: false, reason: 'no_key' };
  return { open: true, apiKey };
}
