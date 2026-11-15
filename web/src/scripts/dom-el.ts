// SPDX-License-Identifier: Apache-2.0
// createElement with attributes and children, for Activity, comments and the litigation pack's views. Strings
// become text nodes and attribute values are set with setAttribute, never parsed; nothing here uses innerHTML.

type Child = Node | string | null | undefined | false;

/** createElement with attributes and children. Attribute values are set with setAttribute, never parsed. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) if (value !== undefined) node.setAttribute(name, value);
  for (const child of children) if (child) node.append(child);
  return node;
}
