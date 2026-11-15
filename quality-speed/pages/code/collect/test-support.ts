// SPDX-License-Identifier: Apache-2.0
// Tests that parse TypeScript use the compiler web/ installs. Without an install they skip with the reason, so the
// rest of this folder's tests still run in seconds on a bare checkout.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type * as TS from 'typescript';

function load(): typeof TS | undefined {
  try {
    return createRequire(fileURLToPath(new URL('../../../../web/package.json', import.meta.url)))('typescript') as typeof TS;
  } catch {
    return undefined;
  }
}

export const ts = load();
/** Pass as a test's `skip` option: false when the compiler is present, else the reason. */
export const needsTs: false | string = ts ? false : 'typescript is not installed (npm ci --ignore-scripts in web/)';
