// SPDX-License-Identifier: Apache-2.0
// Email normalization shared by the Worker and the CLI scripts, so a member added as
// "Founder@Example.com " matches the address Access puts in the JWT.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trimmed, NFC-normalized, lowercased email, or null if the value is not a plausible address. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().normalize('NFC').toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) return null;
  return email;
}
