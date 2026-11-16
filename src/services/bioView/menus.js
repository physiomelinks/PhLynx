/**
 * Menu entries shared with the diagram, whose context menu (PaneContextMenu) takes `{label, action, checked, items}`,
 * as the physiology view's PrimeVue context menu takes them.
 */

/**
 * Gives diagram menu entries as PrimeVue menu items: `action` runs as `command`, a checked entry shows a tick, and a
 * submenu keeps its entries the same way.
 *
 * @param {Array<{label: string, action?: Function, checked?: boolean, items?: Array}>} entries
 * @param {Object<string, string>} [icons] - A top-level entry's icon class, by its label.
 * @returns {Array<Object>}
 */
export function primeMenuItems(entries, icons = {}) {
  return entries.map(({ label, action, checked, items }) => ({
    label,
    icon: icons[label] ?? (checked ? 'pi pi-check' : undefined),
    ...(items ? { items: primeMenuItems(items) } : { command: () => action?.() }),
  }))
}
