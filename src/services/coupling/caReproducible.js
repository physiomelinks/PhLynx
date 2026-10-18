/**
 * Finds the couplings circulatory_autogen (CA) can't reproduce. CA pairs a connection's ports by the order of its
 * module array, not by name: a source's exit then general ports of a label as one group, a target's entrance then
 * general ports as another, every label the two share, a vessel_port one slot to one slot and any other label each free
 * source slot to the target's first free slot (see services/export/caSimulate.js). The export can order the array
 * (services/export/caOrder.js); a coupling no order reproduces is a problem here, so it can be refused when made.
 *
 * Each problem is `{ edgeId, kind, message, label?, coupling? }`: edgeId a store edge's id; kind one of PROBLEM_KINDS;
 * coupling the store edge's coupling it concerns, when it concerns one.
 */
import { caSlotGroups, slotOf } from '../../utils/edges'
import { hasHierarchy, isModelEdge } from '../../utils/hierarchy'
import { isCompatible, SOURCE_PORT_TYPES, TARGET_PORT_TYPES, variableCount, VESSEL_PORT } from '../../utils/ports'
import { expandHierarchy } from '../hierarchy/expand'
import { couplingPairs, orderCaLists, portIndexOf } from '../export/caOrder'
import { protectedSlots } from '../export/caPairing'
import { comparePairs, simulateCaPairing } from '../export/caSimulate'

/** The kinds of problem, each a way CA pairs otherwise. */
export const PROBLEM_KINDS = Object.freeze({
  /** A source's entrance port or a target's exit port: CA couples exit or general into entrance or general. */
  role: 'role',
  /** More pairs of a label than CA makes on one connection. */
  superset: 'superset',
  /** Ports with different numbers of variables, which CA indexes one by the other. */
  variableCount: 'variableCount',
  /** A label both modules share left uncoupled, which CA couples all the same. */
  subset: 'subset',
  /** Slots CA's first-free order gives otherwise, whatever the module array's order. */
  order: 'order',
})

// Order failures the other kinds already explain, or CA's heart rule decides.
const EXPLAINED_FAILURES = new Set(['listCount', 'indexError', 'heartPin', 'misaligned'])
// Marks a model edge's couplings with the store edge and coupling they come from, through the expansion.
const ORIGIN = Symbol('couplingOrigin')

const typeName = (portType) => (portType ?? 'unknown_ports').replace(/_ports$/, '')
const quote = (text) => `"${text}"`

/**
 * Lists the labels two modules share that an edge between them leaves uncoupled: those of the source's exit and
 * general ports and the target's entrance and general ports, which CA couples all of.
 *
 * @param {Object} sourceNode
 * @param {Object} targetNode
 * @param {Array} couplings - The edge's couplings.
 * @returns {string[]} The labels, in the order of the source's ports.
 */
export function uncoupledSharedLabels(sourceNode, targetNode, couplings) {
  const targets = caSlotGroups(targetNode?.data?.ports ?? [], TARGET_PORT_TYPES)
  const coupled = new Set((couplings ?? []).flatMap(({ sourcePort, targetPort }) => [sourcePort?.label, targetPort?.label]))
  return [...caSlotGroups(sourceNode?.data?.ports ?? [], SOURCE_PORT_TYPES).keys()].filter(
    (label) => label && targets.has(label) && !coupled.has(label)
  )
}

/**
 * Says why CA can't pair two ports on an edge that already has some couplings: a role CA doesn't couple through,
 * different numbers of variables, or more pairs of the label than CA makes on one connection.
 *
 * @param {Object} sourcePort
 * @param {Object} targetPort
 * @param {Array<{sourcePort: Object, targetPort: Object}>} [others] - The edge's other couplings; a port is the same
 *   object here as there.
 * @param {Object} [options]
 * @param {boolean} [options.allowEmpty=false] - Let a port without variables yet, such as one being added, pair.
 * @returns {string|null} The reason, or null when CA can pair them.
 */
export function pairingRefusal(sourcePort, targetPort, others = [], { allowEmpty = false } = {}) {
  if (!isCompatible(sourcePort?.portType, targetPort?.portType)) return roleMessage(sourcePort, targetPort)
  const [from, to] = [variableCount(sourcePort), variableCount(targetPort)]
  if (from !== to && !(allowEmpty && (!from || !to))) return countMessage(sourcePort.label, from, to)
  const sameLabel = others.filter((other) => other.sourcePort?.label === sourcePort.label)
  if (sameLabel.some((other) => other.sourcePort === sourcePort && other.targetPort !== targetPort)) {
    return supersetMessage(sourcePort.label, 'source')
  }
  if (sourcePort.label === VESSEL_PORT && sameLabel.some((other) => other.sourcePort !== sourcePort || other.targetPort !== targetPort)) {
    return supersetMessage(sourcePort.label, 'vessel')
  }
  if (sameLabel.some((other) => other.targetPort !== targetPort)) return supersetMessage(sourcePort.label, 'target')
  return null
}

/**
 * Lists the problems with the edges' couplings: each coupling's role and variable counts, each edge's labels paired
 * more than CA pairs them or left uncoupled, and the slots CA's order gives otherwise. The order is checked on the
 * expanded model (see expandHierarchy), so an edge to a super instance is checked through the modules it couples; a
 * problem there is given on the store edge it comes from. A slot CA's heart, terminal, junction or volume-sum rule
 * wires (see protectedSlots) is left out of the variable-count and order checks.
 *
 * @param {Array} nodes - The store's nodes.
 * @param {Array} edges - The store's edges; an edge being edited with the couplings it would have.
 * @param {Object} [options]
 * @param {Iterable<string>} [options.edgeIds] - Only these edges' problems, and the order problems on other edges that
 *   their couplings cause, so problems elsewhere don't block editing them.
 * @param {{nodes: Array, edges: Array}} [options.baseline] - The workspace before these edges' edit, whose order
 *   problems on other edges they don't cause; without it, the workspace without these edges.
 * @returns {Array<{edgeId: string, kind: string, message: string, label?: string, coupling?: Object}>}
 */
export function couplingProblems(nodes, edges, { edgeIds, baseline } = {}) {
  const only = edgeIds ? new Set(edgeIds) : null
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const conduits = modelConduits(nodes, edges)
  const own = (id) => nodeById.get(id)?.data?.ports ?? []
  const guarded = protectedSlots(nodes, conduits, own)

  const problems = conduits.filter((edge) => !only || only.has(edge.id)).flatMap((edge) => edgeProblems(edge, nodeById, guarded))
  // One order problem per edge and label, left out where another problem explains it.
  const keyOf = (problem) => `${problem.edgeId}\0${problem.label ?? ''}`
  const seen = new Set(problems.map(keyOf))

  let order = orderProblems(nodes, conduits)
  if (only) {
    const earlier = baseline
      ? orderProblems(baseline.nodes, modelConduits(baseline.nodes, baseline.edges))
      : orderProblems(nodes, conduits.filter((edge) => !only.has(edge.id)))
    const before = new Set(earlier.map(keyOf))
    order = order.filter((problem) => only.has(problem.edgeId) || !before.has(keyOf(problem)))
  }
  for (const problem of order) {
    if (seen.has(keyOf(problem))) continue
    seen.add(keyOf(problem))
    problems.push(problem)
  }
  return problems
}

/** The edges between two of the nodes that couple them, not exposure edges. */
function modelConduits(nodes, edges) {
  const ids = new Set(nodes.map((node) => node.id))
  return edges.filter((edge) => isModelEdge(edge) && ids.has(edge.source) && ids.has(edge.target))
}

/**
 * Lists one edge's problems that its own couplings and ends show: role, variable count, superset and subset.
 *
 * @param {Object} edge
 * @param {Map<string, Object>} nodeById
 * @param {Map<string, string>} guarded - From protectedSlots.
 * @returns {Array<Object>}
 */
function edgeProblems(edge, nodeById, guarded) {
  const problems = []
  const add = (kind, message, label, coupling) =>
    problems.push({ edgeId: edge.id, kind, message, ...(label !== undefined && { label }), ...(coupling && { coupling }) })
  const [source, target] = [nodeById.get(edge.source), nodeById.get(edge.target)]
  const couplings = edge.data?.couplings ?? []
  const slotKey = (nodeId, port, slot) => `${port?.portType}\0${port?.label}\0${slotOf(nodeById.get(nodeId)?.data?.ports ?? [], port, slot)}`
  const isGuarded = (nodeId, port, slot) => {
    const index = portIndexOf(nodeById.get(nodeId)?.data?.ports ?? [], port, slot)
    return index !== -1 && guarded.has(`${nodeId}#${index}`)
  }

  // Each label's pairs so far, as slot keys, to find those past what CA pairs.
  const byLabel = new Map()
  for (const coupling of couplings) {
    const { sourcePort, targetPort, sourceSlot, targetSlot } = coupling
    const label = sourcePort?.label
    if (!isCompatible(sourcePort?.portType, targetPort?.portType)) {
      add(PROBLEM_KINDS.role, roleMessage(sourcePort, targetPort), label, coupling)
      continue
    }
    const [from, to] = [variableCount(sourcePort), variableCount(targetPort)]
    if (from !== to && !isGuarded(edge.source, sourcePort, sourceSlot) && !isGuarded(edge.target, targetPort, targetSlot)) {
      add(PROBLEM_KINDS.variableCount, countMessage(label, from, to), label, coupling)
    }
    const pair = { source: slotKey(edge.source, sourcePort, sourceSlot), target: slotKey(edge.target, targetPort, targetSlot) }
    const earlier = byLabel.get(label) ?? []
    const reason = earlier.some((other) => other.source === pair.source && other.target !== pair.target)
      ? 'source'
      : label === VESSEL_PORT && earlier.some((other) => other.source !== pair.source || other.target !== pair.target)
        ? 'vessel'
        : earlier.some((other) => other.target !== pair.target)
          ? 'target'
          : null
    if (reason) add(PROBLEM_KINDS.superset, supersetMessage(label, reason), label, coupling)
    else if (!earlier.some((other) => other.source === pair.source && other.target === pair.target)) byLabel.set(label, [...earlier, pair])
  }

  for (const label of uncoupledSharedLabels(source, target, couplings)) {
    add(
      PROBLEM_KINDS.subset,
      `CA couples every label two modules share, so it would also couple ${quote(label)}, left uncoupled here. Couple it, or change the module's ports in the instance editor.`,
      label
    )
  }
  return problems
}

/**
 * Lists the pairs CA's order gives otherwise: the expanded model's module array ordered as the export orders it, CA's
 * pairing simulated, and each pair it misses or adds, or connection it stops on, given on its store edge, once per
 * label. No port is relabelled, retyped or trimmed, as the export may.
 *
 * @param {Array} nodes - The store's nodes.
 * @param {Array} edges - The store's model edges.
 * @returns {Array<Object>}
 */
function orderProblems(nodes, edges) {
  const tagged = edges.map((edge) => ({
    ...edge,
    data: {
      ...edge.data,
      couplings: (edge.data?.couplings ?? []).map((coupling) => ({ ...coupling, [ORIGIN]: { edgeId: edge.id, coupling } })),
      [ORIGIN]: edge.id,
    },
  }))
  const model = hasHierarchy(nodes, tagged) ? expandHierarchy(nodes, tagged) : { nodes, edges: tagged }
  const nodeById = new Map(model.nodes.map((node) => [node.id, node]))
  const portsOf = (id) => nodeById.get(id)?.data?.ports ?? []
  const conduits = model.edges.filter(
    (edge) => isModelEdge(edge) && nodeById.has(edge.source) && nodeById.has(edge.target) && edge.data?.couplings?.length
  )
  if (!conduits.length) return []

  const { pairs: wanted } = couplingPairs(model.nodes, conduits)
  const guarded = protectedSlots(model.nodes, conduits, portsOf)
  const lists = orderCaLists(model.nodes, conduits, { portsOf, pairs: wanted })
  const ca = simulateCaPairing({ ...lists, portsOf })
  const { missing, spurious } = comparePairs(wanted, ca.pairs, { ruled: ca.ruled, portsOf })

  const problems = []
  const nameOf = (id) => quote(nodeById.get(id)?.data?.name ?? id)
  // A port by its place among the node's ports of its type and label, when there are more than one.
  const portName = (id, index) => {
    const port = portsOf(id)[index]
    const group = portsOf(id).filter((p) => p.portType === port?.portType && p.label === port?.label)
    const place = group.length > 1 ? `${ordinal(group.indexOf(port) + 1)} ` : ''
    return `${nameOf(id)}'s ${place}${typeName(port?.portType)} ${port?.label}`
  }
  const isGuarded = (edge, source, target) => guarded.has(`${edge.source}#${source}`) || guarded.has(`${edge.target}#${target}`)
  const couplingAt = (edge, source, target) =>
    (edge.data.couplings ?? []).find(
      (coupling) =>
        portIndexOf(portsOf(edge.source), coupling.sourcePort, coupling.sourceSlot) === source &&
        portIndexOf(portsOf(edge.target), coupling.targetPort, coupling.targetSlot) === target
    )
  const add = (edge, label, message, coupling) =>
    problems.push({
      edgeId: edge.data[ORIGIN] ?? edge.id,
      kind: PROBLEM_KINDS.order,
      message,
      label,
      ...(coupling?.[ORIGIN] && { coupling: coupling[ORIGIN].coupling }),
    })

  // Each edge and label's pairs CA misses and adds, so one message says what CA pairs instead.
  const byEdgeLabel = new Map()
  const collect = (list, key) => {
    for (const { edge, source, target } of list) {
      if (isGuarded(edge, source, target)) continue
      const label = portsOf(edge.source)[source]?.label
      const id = `${edge.id}\0${label}`
      if (!byEdgeLabel.has(id)) byEdgeLabel.set(id, { edge, label, missing: [], spurious: [] })
      byEdgeLabel.get(id)[key].push({ source, target })
    }
  }
  collect(missing, 'missing')
  collect(spurious, 'spurious')
  const pairText = ({ edge }, { source, target }) => `${portName(edge.source, source)} with ${portName(edge.target, target)}`
  for (const group of byEdgeLabel.values()) {
    const { edge, label, missing: lost, spurious: added } = group
    const what = added.length
      ? `it would pair ${added.map((pair) => pairText(group, pair)).join(' and ')}${lost.length ? ` instead of ${lost.map((pair) => pairText(group, pair)).join(' and ')}` : ''}`
      : `it wouldn't pair ${lost.map((pair) => pairText(group, pair)).join(' or ')}`
    const first = lost[0]
    add(
      edge,
      label,
      `CA gives each connection the first free ${label} slot, so on ${nameOf(edge.source)} → ${nameOf(edge.target)} ${what}.`,
      first && couplingAt(edge, first.source, first.target)
    )
  }
  const labelGuarded = (edge, label) =>
    [edge.source, edge.target].some((id) => portsOf(id).some((port, index) => port.label === label && guarded.has(`${id}#${index}`)))
  for (const error of ca.errors) {
    if (EXPLAINED_FAILURES.has(error.kind) || (error.label && labelGuarded(error.edge, error.label))) continue
    const message = {
      targetFull: `CA finds no free ${error.label} slot on ${nameOf(error.edge.target)} for ${nameOf(error.edge.source)} → ${nameOf(error.edge.target)}.`,
      sourceFull: `CA finds no free ${error.label} slot on ${nameOf(error.edge.source)} for ${nameOf(error.edge.source)} → ${nameOf(error.edge.target)}.`,
      noMatchingPort: `CA stops on ${nameOf(error.edge.source)} → ${nameOf(error.edge.target)}, as they share no label it couples.`,
    }[error.kind]
    if (message) add(error.edge, error.label, message)
  }
  return problems
}

/** Says why CA can't couple a pair of port types. */
function roleMessage(sourcePort, targetPort) {
  return `CA can't couple ${sourcePort?.label} from ${a(typeName(sourcePort?.portType))} port into ${a(typeName(targetPort?.portType))} port: it couples an exit or general port into an entrance or general port.`
}

/** Says why CA can't pair ports of different numbers of variables. */
function countMessage(label, from, to) {
  return `CA pairs ${label} variable by variable, but the source port has ${from} and the target port ${to}.`
}

/** Says why CA pairs fewer of a label on one connection: 'source', 'vessel' or 'target'. */
function supersetMessage(label, reason) {
  if (reason === 'source') return `CA pairs each ${label} slot of the source with one slot of the target on a connection.`
  if (reason === 'vessel') return `CA pairs one ${VESSEL_PORT} slot with one slot on each connection.`
  return `CA pairs ${label} into one slot of the target on each connection.`
}

/** Writes a place in a list: 1st, 2nd, 3rd, 4th, …, 11th, 21st. */
function ordinal(n) {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th')
  return `${n}${suffix}`
}

/** Prefixes a word with its article. */
function a(word) {
  return /^[aeiou]/.test(word) ? `an ${word}` : `a ${word}`
}
