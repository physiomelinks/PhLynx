/**
 * An instance's connections for the physiology view's Connections menu: the other instances its diagram edges
 * couple it to, and each coupling's two ports. Only an edge's active couplings count, never its kept manual ones.
 */

import { annotationChips } from '../annotations/display.js'
import { isAnnotatedPort, portDisplayName } from '../../utils/portIdentity.js'

/**
 * A coupled port as the menu shows it: its name, and its annotation's species and property when annotated.
 *
 * @param {Object} port - As an edge's coupling stores it.
 * @returns {{ name: string, annotation: string|null }}
 */
export function portSummary(port) {
  const name = portDisplayName(port) || (port?.variables ?? []).join(', ')
  if (!isAnnotatedPort(port)) return { name, annotation: null }
  const texts = annotationChips(port.annotation)
    .filter((chip) => chip.kind !== 'location')
    .map((chip) => chip.text)
  return { name, annotation: texts.length ? texts.join(' · ') : null }
}

/**
 * The instances an instance is coupled to, by name, each with its couplings from this instance's side.
 *
 * @param {string} id - The instance's node id.
 * @param {Array<Object>} nodes - The diagram's nodes.
 * @param {Array<Object>} edges - The diagram's edges.
 * @returns {Array<{ id: string, name: string, edgeIds: string[],
 *   couplings: Array<{ outgoing: boolean, mine: Object, theirs: Object }> }>}
 */
export function connectionsOf(id, nodes, edges) {
  const names = new Map(nodes.map((node) => [node.id, node.data?.name ?? node.id]))
  const byOther = new Map()
  for (const edge of edges) {
    const outgoing = edge.source === id
    if (!outgoing && edge.target !== id) continue
    const other = outgoing ? edge.target : edge.source
    if (other === id || !names.has(other)) continue
    if (!byOther.has(other)) byOther.set(other, { id: other, name: names.get(other), edgeIds: [], couplings: [] })
    byOther.get(other).edgeIds.push(edge.id)
    for (const { sourcePort, targetPort } of edge.data?.couplings ?? []) {
      byOther.get(other).couplings.push({
        outgoing,
        mine: portSummary(outgoing ? sourcePort : targetPort),
        theirs: portSummary(outgoing ? targetPort : sourcePort),
      })
    }
  }
  return [...byOther.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The Connections menu item: a submenu of the coupled instances, each opening its couplings as one panel item
 * ({ connection: { ownName, id, name, couplings } }) the menu's item template draws. Choosing an instance or its
 * panel opens the connection between the two.
 *
 * @param {string} id - The instance's node id.
 * @param {Array<Object>} nodes - The diagram's nodes.
 * @param {Array<Object>} edges - The diagram's edges.
 * @param {(edgeId: string) => void} [open] - Opens a connection, e.g. in the edge connection dialog.
 * @returns {Object} A PrimeVue menu item.
 */
export function connectionsMenu(id, nodes, edges, open) {
  const name = nodes.find((node) => node.id === id)?.data?.name ?? id
  const connections = connectionsOf(id, nodes, edges)
  return {
    label: 'Connections',
    icon: 'pi pi-arrow-right-arrow-left',
    items: connections.length
      ? connections.map((connection) => ({
          label: `${connection.name} (${connection.couplings.length || 'no couplings'})`,
          command: open ? () => open(connection.edgeIds[0]) : undefined,
          items: [
            {
              label: `${name} – ${connection.name}`,
              connection: { ownName: name, ...connection },
              class: 'bio-connection-item',
              command: open ? () => open(connection.edgeIds[0]) : undefined,
            },
          ],
        }))
      : [{ label: 'No connections', disabled: true }],
  }
}
