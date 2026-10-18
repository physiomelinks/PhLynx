/**
 * Orders a CA module array so CA wires it as PhLynx does. CA connects the rows in order, each row's out_instances in
 * order, and gives each connection the first free slot of each repeated port (see caSimulate.js), so the order of
 * rows and of out_instances decides which slot each connection takes. Slots are counted in CA's groups: a source's
 * exit and general ports of one label together, and a target's entrance and general ports.
 */
import { parseModuleRef } from '../../utils/config'
import { slotOf } from '../../utils/edges'
import { HEART_PORT, isHeart } from '../caRules'
import { caPortLists } from './caSimulate'

/**
 * Lists each edge's couplings as the port slots they pair, and the couplings whose ports have changed since they
 * were made (stale): the port at their slot now differs, or no longer exists.
 *
 * @param {Array} nodes - Workspace nodes.
 * @param {Array} edges - Workspace edges.
 * @returns {{ pairs: Map<Object, Array<{source: number, target: number}>>, stale: Array<{edge: Object,
 *   coupling: Object, gone: boolean}> }} pairs: each edge's pairs as indices into its ends' ports, each pair once;
 *   stale: gone when the coupling's port was not found, so it has no pair.
 */
export function couplingPairs(nodes, edges) {
  const portsOf = new Map(nodes.map((node) => [node.id, node.data?.ports ?? []]))
  const pairs = new Map()
  const stale = []
  for (const edge of edges) {
    if (!portsOf.has(edge.source) || !portsOf.has(edge.target)) continue
    const list = []
    for (const coupling of edge.data?.couplings ?? []) {
      const source = portIndexOf(portsOf.get(edge.source), coupling.sourcePort, coupling.sourceSlot)
      const target = portIndexOf(portsOf.get(edge.target), coupling.targetPort, coupling.targetSlot)
      if (source === -1 || target === -1) {
        stale.push({ edge, coupling, gone: true })
        continue
      }
      const changed =
        differs(portsOf.get(edge.source)[source], coupling.sourcePort) || differs(portsOf.get(edge.target)[target], coupling.targetPort)
      if (changed) stale.push({ edge, coupling, gone: false })
      if (!list.some((pair) => pair.source === source && pair.target === target)) list.push({ source, target })
    }
    pairs.set(edge, list)
  }
  return { pairs, stale }
}

/**
 * Gets a coupling's port's index in a node's ports, through its slot (see slotOf).
 *
 * @param {Array} ports
 * @param {Object} port - The coupling's port.
 * @param {number} [slot] - Its recorded slot.
 * @returns {number} -1 when the slot holds no port.
 */
export function portIndexOf(ports, port, slot) {
  if (!port) return -1
  const group = ports.flatMap((p, index) => (p.portType === port.portType && p.label === port.label ? [index] : []))
  const found = slotOf(ports, port, slot)
  return found >= 0 && found < group.length ? group[found] : -1
}

/**
 * Whether a node's port differs from a coupling's copy of it in what the export writes.
 *
 * @param {Object} port
 * @param {Object} copy
 * @returns {boolean}
 */
function differs(port, copy) {
  if (port === copy) return false
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  return !same(port.variables, copy.variables) || !same(port.multiportType, copy.multiportType) || !same(port.multiplyFactor, copy.multiplyFactor)
}

/**
 * Orders the rows, and each row's out_instances and inp_instances, so CA reproduces the slots the edges' pairs hold.
 * A row comes before another whose connection holds a later slot of a target group they both connect to, and an
 * out_instance before one holding a later slot of the row's own group; inp_instances follow their slots too. A
 * heart's vessel_port inputs come first, in slot order, as CA gives its ivc, svc and pulmonary slots by place in its
 * inp_vessels (two inputs being svc and pulmonary). Otherwise the workspace order is kept.
 *
 * @param {Array} nodes - Workspace nodes.
 * @param {Array} edges - Workspace edges.
 * @param {Object} options
 * @param {(id: string) => Array} options.portsOf - Each node's ports, as exported.
 * @param {Map<Object, Array<{source: number, target: number}>>} options.pairs - Each edge's slot pairs, as port
 *   indices (see couplingPairs).
 * @returns {{ rows: Array, outEdges: Map<string, Array>, inpEdges: Map<string, Array> }} rows: the nodes in order;
 *   outEdges and inpEdges: each node's edges in list order.
 */
export function orderCaLists(nodes, edges, { portsOf, pairs }) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const hearts = new Set(nodes.filter((node) => isHeart(parseModuleRef(node.data?.moduleRef ?? ':').moduleType ?? '')).map((node) => node.id))
  const isHeartNode = (id) => hearts.has(id)
  const conduits = edges.filter((edge) => nodeById.has(edge.source) && nodeById.has(edge.target))
  const groupSlots = new Map(nodes.map((node) => [node.id, mergedSlots(portsOf(node.id))]))
  const pairsOf = (edge) => pairs.get(edge) ?? []

  // Each edge's slot in each CA group it pairs, on each side, by label; withHeart counts a heart's pinned slots too.
  const slots = new Map(
    conduits.map((edge) => {
      const source = new Map()
      const target = new Map()
      const withHeart = new Map()
      for (const pair of pairsOf(edge)) {
        const targetPort = portsOf(edge.target)[pair.target]
        const targetSlot = groupSlots.get(edge.target).target.get(pair.target)
        keepFirst(source, portsOf(edge.source)[pair.source]?.label, groupSlots.get(edge.source).source.get(pair.source))
        keepFirst(withHeart, targetPort?.label, targetSlot)
        if (!(isHeartNode(edge.target) && isHeartPort(targetPort))) keepFirst(target, targetPort?.label, targetSlot)
      }
      return [edge, { source, target, withHeart }]
    })
  )
  const edgesAt = (key, id) => conduits.filter((edge) => edge[key] === id)

  const targetPairs = nodes.flatMap((node) => slotPairs(edgesAt('target', node.id), (edge) => slots.get(edge).target))
  const rows = orderAfter(
    nodes,
    targetPairs.map(([a, b]) => [nodeById.get(a.source), nodeById.get(b.source)])
  )
  const rowIndex = new Map(rows.map((node, index) => [node.id, index]))

  const outEdges = new Map(
    rows.map((node) => {
      const out = edgesAt('source', node.id)
      return [node.id, orderAfter(out, slotPairs(out, (edge) => slots.get(edge).source))]
    })
  )
  const inpEdges = new Map(
    rows.map((node) => {
      const inp = edgesAt('target', node.id).sort((a, b) => rowIndex.get(a.source) - rowIndex.get(b.source))
      if (!isHeartNode(node.id)) return [node.id, orderAfter(inp, slotPairs(inp, (edge) => slots.get(edge).target))]
      const venous = inp.filter((edge) => pairsOf(edge).some((pair) => isHeartPort(portsOf(edge.target)[pair.target])))
      const others = inp.filter((edge) => !venous.includes(edge))
      const slotsOf = (edge) => slots.get(edge).withHeart
      const venousOrder = orderAfter(venous, slotPairs(venous, slotsOf))
      return [node.id, [...venousOrder, ...orderAfter(others, slotPairs(others, slotsOf))]]
    })
  )
  return { rows, outEdges, inpEdges }
}

/**
 * Gets each port's slot in its CA group: its place among the ports of its label in the node's source list (exit then
 * general ports) and target list (entrance then general).
 *
 * @param {Array} ports
 * @returns {{ source: Map<number, number>, target: Map<number, number> }} Port index to slot.
 */
function mergedSlots(ports) {
  const { source, target } = caPortLists(ports)
  const slotsIn = (list) => {
    const counts = new Map()
    return new Map(
      list.map((index) => {
        const label = ports[index].label
        counts.set(label, (counts.get(label) ?? -1) + 1)
        return [index, counts.get(label)]
      })
    )
  }
  return { source: slotsIn(source), target: slotsIn(target) }
}

/**
 * Sets a group's slot unless it has an earlier one.
 *
 * @param {Map<string, number>} slots
 * @param {string|undefined} label
 * @param {number|undefined} slot
 */
function keepFirst(slots, label, slot) {
  if (label === undefined || slot === undefined) return
  if (!slots.has(label) || slot < slots.get(label)) slots.set(label, slot)
}

/**
 * Lists the pairs [a, b] where a holds an earlier slot than b in a group both hold, so a must come first.
 *
 * @param {Array} items
 * @param {Function} slotsOf - item to its Map of group to slot.
 * @returns {Array<Array>}
 */
function slotPairs(items, slotsOf) {
  return items.flatMap((a) =>
    items.flatMap((b) => {
      const later = [...slotsOf(a)].some(([group, slot]) => slot < (slotsOf(b).get(group) ?? -1))
      return a !== b && later ? [[a, b]] : []
    })
  )
}

/**
 * Orders items so each pair's first comes before its second, otherwise keeping their order. Pairs that contradict
 * each other are broken in that order.
 *
 * @param {Array} items
 * @param {Array<Array>} pairs - [before, after] pairs.
 * @returns {Array}
 */
function orderAfter(items, pairs) {
  const befores = new Map(items.map((item) => [item, []]))
  pairs.forEach(([before, after]) => befores.get(after)?.push(before))
  const remaining = new Set(items)
  const ordered = []
  while (remaining.size) {
    const isReady = (item) => !befores.get(item).some((before) => before !== item && remaining.has(before))
    const next = [...remaining].find(isReady) ?? remaining.values().next().value
    ordered.push(next)
    remaining.delete(next)
  }
  return ordered
}

/**
 * Whether a port is a heart's entrance vessel_port, whose slots CA gives by place in the heart's inp_vessels.
 *
 * @param {Object} port
 * @returns {boolean}
 */
function isHeartPort(port) {
  return port?.portType === 'entrance_ports' && port.label === HEART_PORT
}
