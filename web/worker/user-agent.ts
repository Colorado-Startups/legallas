// SPDX-License-Identifier: Apache-2.0
// A short, human browser summary for sign-in emails and the activity page. No dependencies, so the
// browser can import it too (src/scripts/activity.ts).

/** "Safari on macOS" from a user agent string; "Unknown browser" when it cannot tell. */
export function summarizeUserAgent(userAgent: string | null): string {
  const ua = userAgent ?? '';
  const browser =
    /Edg(e|A|iOS)?\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) && /Version\//.test(ua) ? 'Safari'
    : null;
  const os =
    /iPhone|iPod/.test(ua) ? 'iPhone'
    : /iPad/.test(ua) ? 'iPad'
    : /Android/.test(ua) ? 'Android'
    : /CrOS/.test(ua) ? 'ChromeOS'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
    : /Windows/.test(ua) ? 'Windows'
    : /Linux/.test(ua) ? 'Linux'
    : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? (os ? `A browser on ${os}` : 'Unknown browser');
}
