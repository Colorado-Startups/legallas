// SPDX-License-Identifier: Apache-2.0
// worker/ and mcp/ modules declare Workers binding types that the scripts tsconfig cannot resolve, so scripts load
// them at runtime through `loadModule` and use them through narrow shapes of their own.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const WEB_DIR = path.resolve(import.meta.dirname, '..');

/** Imports a module under web/ by its path, untyped (see the header). */
export function loadModule<T>(relative: string): Promise<T> {
  return import(pathToFileURL(path.join(WEB_DIR, relative)).href) as Promise<T>;
}
