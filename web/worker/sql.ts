// SPDX-License-Identifier: Apache-2.0
// SQL literals for the CLI scripts. `wrangler d1 execute` has no parameter binding, so every value the
// scripts put into SQL (filenames above all) must go through sqlLiteral(). The Worker itself always uses
// D1's prepared statements with .bind() and never needs this.

// C0 control characters and DEL. Filenames and emails never legitimately contain them.
const CONTROL = /[\u0000-\u001f\u007f]/;

export function sqlLiteral(value: string | number | null): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('sqlLiteral: only safe integers are allowed');
    return String(value);
  }
  const text = value.normalize('NFC');
  if (CONTROL.test(text)) throw new Error('sqlLiteral: control characters are not allowed');
  return `'${text.replaceAll("'", "''")}'`;
}
