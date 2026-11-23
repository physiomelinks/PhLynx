/**
 * The order modules are drawn in: by name, and along a row of slots as the user ordered them.
 */

/** Sorts node ids by their node's name, then by id. */
export const byName = (nodes) => (a, b) =>
  (nodes.get(a)?.data?.name ?? a).localeCompare(nodes.get(b)?.data?.name ?? b) || a.localeCompare(b)

/**
 * Orders the nodes in one row of slots: those the user ordered first, by their order, then the rest by name.
 *
 * @param {string[]} ids
 * @param {Map<string, Object>} nodes
 * @returns {string[]}
 */
export function inSlotOrder(ids, nodes) {
  const ordered = (id) => Number.isInteger(nodes.get(id)?.data?.bioView?.order)
  const placed = ids
    .filter(ordered)
    .sort((a, b) => nodes.get(a).data.bioView.order - nodes.get(b).data.bioView.order || byName(nodes)(a, b))
  return [...placed, ...ids.filter((id) => !ordered(id)).sort(byName(nodes))]
}
