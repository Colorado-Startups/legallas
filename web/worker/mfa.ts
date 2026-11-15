// SPDX-License-Identifier: Apache-2.0
// REQUIRE_MFA: the room's own check that a person's Cloudflare Access sign-in had a second factor no email can deliver:
// a security key, or a biometric such as Touch ID, Face ID or Windows Hello. Access can prompt for one itself
// ("independent MFA"); with this setting on, the room (room.ts) and the AI sign-in (mcp/authorize.ts) also refuse any
// session whose Access token shows none, so an Access setting turned off by mistake lets no email-only sign-in in. Off
// unless "1".
//
// What the sources say (read 2026-11-06):
// - Cloudflare, "Enforce MFA", "Authentication methods in the JWT" (updated 2026-11-02): an IdP may share the MFA method
//   a user presented, and "Access can add these values into the JWT", as RFC 8176 values. Nothing about Access's own prompt.
//   https://developers.cloudflare.com/cloudflare-one/access-controls/policies/mfa-requirements/
// - Cloudflare, "Independent MFA", "Supported AMR values" (updated 2026-08-13): hwk, swk mean Security key; otp means
//   Authenticator application; face, fpt, iris, retina, vbm mean Biometrics. Access ignores pwd, sms, tel, geo, kba, sc,
//   pin, user, mca, rba and wia.
//   https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/independent-mfa/
// - Cloudflare, "One-time PIN login" (updated 2026-08-31): nothing on amr or the JWT.
//   https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/
// - Cloudflare, "Application token" (updated 2026-06-25): no claim names the login method or an independent MFA result.
//   https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/
// - RFC 8176, section 2: otp covers HOTP and TOTP (RFC 4226, RFC 6238); mfa names no method; email isn't mentioned.
//   https://www.rfc-editor.org/rfc/rfc8176.html
// - Microsoft Entra, "Access token claims reference": otp is "One-time passcode using an email or a text message". Its
//   "Optional claims reference" lists the Email method as emailotp plus mfa.
//   https://learn.microsoft.com/entra/identity-platform/access-token-claims-reference
//   https://learn.microsoft.com/entra/identity-platform/optional-claims-reference
//
// So only SECOND_FACTOR_METHODS count, whatever else the claim holds:
// - otp never counts. No claim says which login method wrote it, Cloudflare doesn't say what its emailed PIN writes, and
//   Entra writes otp for an emailed code. An authenticator app's code can't be told apart from one.
// - mfa never counts. It names no method, and Entra writes it beside an emailed code.
// - Cloudflare documents no claim of its own for independent MFA. If it adds one, read that before amr.
// - A missing claim, any other shape, or only other values reads as no second factor (fail closed).
// The live check: web/README.md, "Turning on REQUIRE_MFA".
import type { Env } from './env.ts';

/**
 * The RFC 8176 values that prove a factor no email can deliver: Cloudflare's "Security key" (hwk, swk) and "Biometrics"
 * (face, fpt, iris, retina, vbm: Touch ID, Face ID, Windows Hello) mappings. Never otp or mfa (see above).
 */
export const SECOND_FACTOR_METHODS: ReadonlySet<string> = new Set(['hwk', 'swk', 'face', 'fpt', 'iris', 'retina', 'vbm']);

/** Cloudflare's enrollment page on the team domain ("Independent MFA", section "Enroll authenticators"). */
export const ENROLL_PATH = '/AddMfaDevice';

/** The most `amr` values read; a longer claim is no Access token this room expects. */
const MAX_METHODS = 16;

export type MfaSetting = Pick<Env, 'REQUIRE_MFA'>;

/** The values REQUIRE_MFA may hold; unset reads as "0". worker/config.test.ts and mcp/config.test.ts hold the configs to them. */
export const MFA_SETTINGS: readonly string[] = ['0', '1'];

/** Whether this isolate has logged mfa_setting_invalid, so a typo logs once, not on every request. */
let warnedInvalid = false;

/**
 * Whether the room requires a second factor: REQUIRE_MFA is exactly "1". Any value but "0", "1" or unset (such as
 * "true" or " 1") leaves it off, and logs mfa_setting_invalid once per isolate (never the value), so a typo that
 * leaves MFA off shows in the Worker's logs.
 */
export function mfaRequired(env: MfaSetting): boolean {
  const value = env.REQUIRE_MFA;
  if (value !== undefined && !MFA_SETTINGS.includes(value) && !warnedInvalid) {
    warnedInvalid = true;
    console.warn('mfa_setting_invalid');
  }
  return value === '1';
}

/**
 * Whether a verified token's `amr` claim names a security key or a biometric. Fails closed on any shape but a short string
 * array, and on every other value, otp and mfa included.
 */
export function hasSecondFactor(amr: unknown): boolean {
  if (!Array.isArray(amr) || amr.length > MAX_METHODS) return false;
  return amr.some((method) => typeof method === 'string' && SECOND_FACTOR_METHODS.has(method));
}

/**
 * Whether REQUIRE_MFA refuses this identity. `secondFactor` is null only for the localhost dev identity (auth.ts), which
 * has no Access token and is never refused.
 */
export function lacksSecondFactor(identity: { secondFactor: boolean | null }, env: MfaSetting): boolean {
  return mfaRequired(env) && identity.secondFactor === false;
}

/** Where a person adds an authenticator: https://<team>.cloudflareaccess.com/AddMfaDevice, or null for a bad TEAM_DOMAIN. */
export function enrollUrl(teamDomain: string | undefined): string | null {
  try {
    const url = new URL(ENROLL_PATH, teamDomain?.trim());
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
