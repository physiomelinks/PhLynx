/**
 * Plans a circulatory_autogen (CA) export so CA and the PhLynx import pair each connection's slots as the workspace
 * does: by ordering the module array, then by changing the ports instances export with (see services/caVariants.js).
 */
import { parseModuleRef, unparseMultiport } from '../../utils/config'
import { isMultiport, parseMultiport, VOLUME_PORT } from '../../utils/multiport'
import { HEART_PORT, isDeprecatedJunction, isHeart } from '../caRules'
import { couplingPairs, orderCaLists } from './caOrder'
import { CA_FAILURES, caMultiPort, comparePairs, simulateCaPairing, simulateImportPairing, VESSEL_PORT } from './caSimulate'

// Labels CA's flow rules read at a terminal or Min_/Nout_ junction.
const FLOW_LABELS = new Set([VESSEL_PORT, 'flow_port'])
// How many components one round tries, alone and then two at a time, before giving up on the rest.
const MAX_TRIES = 24
const LOOKAHEAD = 6

/** Why CA pairs a connection otherwise, by the reason a residual names. */
export const RESIDUAL_REASONS = {
  heart: "CA gives a heart's inputs its ivc, svc and pulmonary slots by place in its inp_instances",
  terminal:
    "CA wires a terminal's vessel_port through its terminal_venous_connection by fixed names: its u_out to u only in a venous module, its v_T to v_in only in a vessel taking flow at its inlet",
  junction:
    "CA wires vessel_ports around Min_/Nout_ junctions through its generic_junction_connection, taking each vessel's port by the place of the vessel it meets the junction through",
  volume: "CA sums a volume_port Sum over its inp_instances' ports of that label",
  superset: 'CA pairs one slot of a label on each connection',
  component: 'CA pairs every slot that shares a label across a connection',
  rule: "CA's terminal, junction or volume-sum rule wires these labels whether or not they are coupled here",
  misaligned: 'the source port has fewer variables than the target port, which shifts the pairs CA maps after it on that connection',
  order: 'CA gives each connection the first free slot of a label',
}

/**
 * Plans the export: the module array's order, each node's ports as exported, and what CA would still pair
 * differently. Ports CA's heart, terminal, junction and volume-sum rules read are never changed.
 *
 * @param {Array} nodes - Workspace nodes.
 * @param {Array} edges - Workspace edges.
 * @returns {{ rows: Array, outEdges: Map<string, Array>, inpEdges: Map<string, Array>, ports: Map<string, Array>,
 *   residuals: Array<{edge: Object, label: string, reason: string}>, failures: Array<Object>, stale: Array<Object>,
 *   dropped: Array<Object> }} ports: a changed port keeps its own fields in `original`; residuals: by RESIDUAL_REASONS;
 *   failures: where CA would stop (CA_FAILURES); dropped: edges with no couplings, left out of the module array.
 */
export function planCaPairing(nodes, edges) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const place = new Map(nodes.map((node, index) => [node.id, index]))
  const own = (id) => nodeById.get(id).data?.ports ?? []
  const conduits = edges.filter((edge) => nodeById.has(edge.source) && nodeById.has(edge.target))
  const { pairs: coupled, stale } = couplingPairs(nodes, conduits)

  const dropped = conduits.filter((edge) => !coupled.get(edge)?.length && wouldPair(own(edge.source), own(edge.target)))
  const kept = conduits.filter((edge) => !dropped.includes(edge))
  const wanted = new Map(kept.map((edge) => [edge, coupled.get(edge) ?? []]))

  const ports = new Map(nodes.map((node) => [node.id, own(node.id).map((port) => ({ ...port }))]))
  const portsOf = (id) => ports.get(id)
  const touched = new Set()
  const guarded = protectedSlots(nodes, kept, own)
  const components = new Components(wanted)
  const isGuarded = (component) => component.some((slot) => guarded.has(slot))

  retypePorts(wanted, ports, own, guarded, touched)
  trimPorts(wanted, ports, guarded, touched)

  const evaluate = () => {
    const lists = orderCaLists(nodes, kept, { portsOf, pairs: wanted })
    const ca = simulateCaPairing({ ...lists, portsOf })
    const imported = simulateImportPairing({ ...lists, portsOf })
    const caDiff = comparePairs(wanted, ca.pairs, { ruled: ca.ruled, portsOf })
    const importDiff = comparePairs(wanted, imported.pairs, { portsOf })
    const failures = ca.errors.filter((error) => CA_FAILURES.has(error.kind))
    const differing = [...caDiff.missing, ...caDiff.spurious, ...failures, ...importDiff.missing, ...importDiff.spurious]
    // A conduit the import leaves out shows as its missing pairs; its errors only point at the slots to untangle.
    return { lists, ca, caDiff, importDiff, imported, failures, score: differing.length, mismatches: [...differing, ...imported.errors] }
  }

  // Relabels the cheapest component, or failing that the cheapest two, that lower the mismatches, until none do.
  const relabelled = new Map()
  let serial = 0
  const candidatesFor = (state, limit) =>
    candidateComponents(state.mismatches, portsOf, components)
      .filter((component) => !isGuarded(component) && !relabelled.has(component.key))
      .sort((a, b) => compareCost(cost(a, touched, place), cost(b, touched, place)))
      .slice(0, limit)
  const keep = (component) => {
    relabelled.set(component.key, component)
    component.forEach((slot) => touched.add(splitSlot(slot)[0]))
  }
  const tryRelabel = (component) => {
    // Set apart by a character no label holds (edges.js keys groups with \x00) until nameRelabelled names it.
    const undo = relabel(component, `\u0001${++serial}`, ports, own)
    return { undo, tried: evaluate() }
  }
  let state = evaluate()
  while (state.score) {
    let next = null
    for (const component of candidatesFor(state, MAX_TRIES)) {
      const { undo, tried } = tryRelabel(component)
      if (tried.score < state.score) {
        keep(component)
        next = tried
        break
      }
      undo()
    }
    for (const first of next ? [] : candidatesFor(state, LOOKAHEAD)) {
      const { undo, tried: between } = tryRelabel(first)
      relabelled.set(first.key, first)
      for (const second of candidatesFor(between, LOOKAHEAD)) {
        const { undo: undoSecond, tried } = tryRelabel(second)
        if (tried.score < state.score) {
          keep(first)
          keep(second)
          next = tried
          break
        }
        undoSecond()
      }
      if (next) break
      relabelled.delete(first.key)
      undo()
    }
    if (!next) break
    state = next
  }

  nameRelabelled([...relabelled.values()], ports, nodes, nodeById)
  const final = relabelled.size ? evaluate() : state
  return {
    ...final.lists,
    ports,
    residuals: residualsOf(final, { wanted, portsOf, guarded, components }),
    failures: final.failures,
    stale,
    dropped,
  }
}

/**
 * Whether CA or the import would pair something across an edge, or CA stop on it, so an edge without couplings must
 * be left out of the module array.
 *
 * @param {Array} sourcePorts
 * @param {Array} targetPorts
 * @returns {boolean}
 */
function wouldPair(sourcePorts, targetPorts) {
  const sources = sourcePorts.filter((port) => port.portType !== 'entrance_ports')
  const labels = new Set(targetPorts.map((port) => port.label))
  const both = ['exit_ports', 'general_ports'].every((type) => sources.some((port) => port.portType === type))
  return both || sources.some((port) => labels.has(port.label))
}

/**
 * The slots joined by the workspace's pairs: each component is a list of `<node id>#<port index>` keys with a `key`.
 */
class Components {
  /**
   * @param {Map<Object, Array<{source: number, target: number}>>} wanted
   */
  constructor(wanted) {
    this.parent = new Map()
    for (const [edge, list] of wanted) {
      for (const { source, target } of list) this.union(`${edge.source}#${source}`, `${edge.target}#${target}`)
    }
    this.members = new Map()
    for (const slot of this.parent.keys()) {
      const root = this.find(slot)
      if (!this.members.has(root)) this.members.set(root, [])
      this.members.get(root).push(slot)
    }
    this.lists = new Map()
  }

  /** Gets a slot's root. */
  find(slot) {
    if (!this.parent.has(slot)) return slot
    let root = slot
    while (this.parent.get(root) !== root) root = this.parent.get(root)
    this.parent.set(slot, root)
    return root
  }

  /** Joins two slots' components. */
  union(a, b) {
    for (const slot of [a, b]) if (!this.parent.has(slot)) this.parent.set(slot, slot)
    const [ra, rb] = [this.find(a), this.find(b)]
    if (ra !== rb) this.parent.set(rb, ra)
  }

  /**
   * Gets the component of a slot, the slot alone when it is coupled to nothing.
   *
   * @param {string} slot
   * @returns {Array<string> & { key: string }}
   */
  of(slot) {
    const root = this.find(slot)
    if (!this.lists.has(root)) this.lists.set(root, Object.assign([...(this.members.get(root) ?? [slot])], { key: root }))
    return this.lists.get(root)
  }
}

/**
 * Lists the slots whose ports CA's rules read by label, with the rule: a heart's vessel_ports, the flow ports of a
 * terminal and the vessels it feeds, and of every vessel meeting at a Min_/Nout_ junction (the junction's neighbours
 * and theirs on that side, as CA's __junction_node_neighbours finds them), and the volume_ports of a volume_port Sum
 * and its neighbours.
 *
 * @param {Array} nodes
 * @param {Array} edges - The edges in the module array.
 * @param {(id: string) => Array} own - Each node's own ports.
 * @returns {Map<string, string>} Slot key to rule, as in RESIDUAL_REASONS.
 */
export function protectedSlots(nodes, edges, own) {
  const typeOf = (node) => parseModuleRef(node.data?.moduleRef ?? ':').moduleType ?? ''
  const outs = (id) => edges.filter((edge) => edge.source === id).map((edge) => edge.target)
  const inps = (id) => edges.filter((edge) => edge.target === id).map((edge) => edge.source)
  const guarded = new Map()
  const guard = (id, labels, rule) =>
    own(id).forEach((port, index) => {
      if (labels.has(port.label) && !guarded.has(`${id}#${index}`)) guarded.set(`${id}#${index}`, rule)
    })

  for (const node of nodes) {
    const type = typeOf(node)
    if (isHeart(type)) guard(node.id, new Set([HEART_PORT]), 'heart')
  }
  for (const node of nodes.filter((node) => isDeprecatedJunction(typeOf(node)))) {
    const atNode = new Set([node.id])
    for (const id of [...inps(node.id), ...outs(node.id)]) {
      atNode.add(id)
      if (outs(id).includes(node.id)) outs(id).forEach((other) => atNode.add(other))
      if (inps(id).includes(node.id)) inps(id).forEach((other) => atNode.add(other))
    }
    atNode.forEach((id) => guard(id, FLOW_LABELS, 'junction'))
  }
  // A terminal and the vessels it feeds, whose v_in CA's terminal_venous_connection sums.
  for (const node of nodes.filter((node) => typeOf(node).endsWith('terminal'))) {
    for (const id of [node.id, ...outs(node.id)]) guard(id, FLOW_LABELS, 'terminal')
  }
  const sumsVolume = (id) => own(id).some((port) => port.label === VOLUME_PORT && caMultiPort(port) === 'sum')
  for (const node of nodes.filter((node) => sumsVolume(node.id))) {
    for (const id of [node.id, ...inps(node.id), ...outs(node.id)]) guard(id, new Set([VOLUME_PORT]), 'volume')
  }
  return guarded
}

/**
 * Moves into general_ports each coupled source entrance port and target exit port, which CA can't pair in that role,
 * keeping its type and place among that type's ports in `original`.
 *
 * @param {Map<Object, Array>} wanted
 * @param {Map<string, Array>} ports - Changed in place.
 * @param {(id: string) => Array} own
 * @param {Map<string, string>} guarded
 * @param {Set<string>} touched - Gets the ids of the nodes changed.
 */
function retypePorts(wanted, ports, own, guarded, touched) {
  const retype = (id, index) => {
    if (guarded.has(`${id}#${index}`)) return
    const port = ports.get(id)[index]
    if (port.portType === 'general_ports') return
    const original = own(id)[index]
    const at = own(id).slice(0, index).filter((other) => other.portType === original.portType).length
    ports.get(id)[index] = { ...port, portType: 'general_ports', original: { ...port.original, portType: original.portType, index: at } }
    touched.add(id)
  }
  for (const [edge, list] of wanted) {
    for (const { source, target } of list) {
      if (own(edge.source)[source].portType === 'entrance_ports') retype(edge.source, source)
      if (own(edge.target)[target].portType === 'exit_ports') retype(edge.target, target)
    }
  }
}

/**
 * Trims each port whose partners all have the same, smaller number of variables to that many, the variables PhLynx
 * pairs, as CA indexes the shorter port by the longer port's variables and shifts the pairs after them.
 *
 * @param {Map<Object, Array>} wanted
 * @param {Map<string, Array>} ports - Changed in place.
 * @param {Map<string, string>} guarded
 * @param {Set<string>} touched
 */
function trimPorts(wanted, ports, guarded, touched) {
  const lengthOf = (id, index) => ports.get(id)[index].variables?.length ?? 0
  const partners = new Map()
  const add = (id, index, length) => {
    const slot = `${id}#${index}`
    if (!partners.has(slot)) partners.set(slot, { id, index, lengths: new Set() })
    partners.get(slot).lengths.add(length)
  }
  for (const [edge, list] of wanted) {
    for (const { source, target } of list) {
      add(edge.source, source, lengthOf(edge.target, target))
      add(edge.target, target, lengthOf(edge.source, source))
    }
  }
  for (const [slot, { id, index, lengths }] of partners) {
    const [length] = lengths
    if (guarded.has(slot) || lengths.size !== 1 || length >= lengthOf(id, index)) continue
    ports.get(id)[index] = trimmed(ports.get(id)[index], length)
    touched.add(id)
  }
}

/**
 * A port with only its first variables, its multiport following them; its own variables, and its multiport when that
 * is written otherwise, kept in `original`.
 *
 * @param {Object} port
 * @param {number} length
 * @returns {Object}
 */
function trimmed(port, length) {
  const cut = (value) => (Array.isArray(value) ? value.slice(0, length) : value)
  let multiportType = cut(port.multiportType)
  if (length === 0 && !Array.isArray(multiportType) && isMultiport(port)) multiportType = 'True'
  const next = { ...port, variables: (port.variables ?? []).slice(0, length), multiportType, multiplyFactor: cut(port.multiplyFactor) }
  if (port.multiplyFactor === undefined) delete next.multiplyFactor
  const original = { ...port.original, variables: port.original?.variables ?? port.variables }
  if (JSON.stringify(unparseMultiport(next) ?? null) !== JSON.stringify(unparseMultiport(port) ?? null)) {
    original.multiportType = port.original?.multiportType ?? parseMultiport(port.multiportType)
    if (Array.isArray(port.multiportType)) original.multiportType = [...port.multiportType]
  }
  return { ...next, original }
}

/**
 * Lists the components that relabelling could untangle a mismatch with: those of every slot of the mismatch's label
 * on either end of its edge that CA or the import could pair there (a source's entrance port or a target's exit port
 * only with a general port at the other end).
 *
 * @param {Array<{edge: Object, source?: number, target?: number, label?: string}>} mismatches
 * @param {(id: string) => Array} portsOf
 * @param {Components} components
 * @returns {Array<Array<string>>} Each component once.
 */
function candidateComponents(mismatches, portsOf, components) {
  const found = new Map()
  for (const { edge, source, target, label } of mismatches) {
    const labelOf = label ?? portsOf(edge.source)[source]?.label ?? portsOf(edge.target)[target]?.label
    if (labelOf === undefined) continue
    const hasGeneral = (id) => portsOf(id).some((port) => port.label === labelOf && port.portType === 'general_ports')
    for (const [id, unused, other] of [[edge.source, 'entrance_ports', edge.target], [edge.target, 'exit_ports', edge.source]]) {
      portsOf(id).forEach((port, index) => {
        if (port.label !== labelOf || (port.portType === unused && !hasGeneral(other))) return
        const component = components.of(`${id}#${index}`)
        found.set(component.key, component)
      })
    }
  }
  return [...found.values()]
}

/**
 * A component's cost to relabel: the instances it would newly make variants, then all it touches, its slots, and
 * the place of its first slot, so the choice is the same every export.
 *
 * @param {Array<string>} component
 * @param {Set<string>} touched
 * @param {Map<string, number>} place - Node id to its place in the workspace.
 * @returns {number[]}
 */
function cost(component, touched, place) {
  const ids = [...new Set(component.map((slot) => splitSlot(slot)[0]))]
  const first = component.map((slot) => [place.get(splitSlot(slot)[0]), splitSlot(slot)[1]]).sort(compareCost)[0]
  return [ids.filter((id) => !touched.has(id)).length, ids.length, component.length, ...first]
}

/**
 * Compares two costs, element by element.
 *
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
function compareCost(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0)
  }
  return 0
}

/**
 * Gives a component's ports a label of their own, keeping each one's label in `original`.
 *
 * @param {Array<string>} component
 * @param {string} mark - Appended to each label to set it apart until nameRelabelled names it.
 * @param {Map<string, Array>} ports - Changed in place.
 * @param {(id: string) => Array} own
 * @returns {Function} Puts the ports back.
 */
function relabel(component, mark, ports, own) {
  const before = component.map((slot) => {
    const [id, index] = splitSlot(slot)
    return [id, index, ports.get(id)[index]]
  })
  for (const [id, index, port] of before) {
    const label = own(id)[index].label
    ports.get(id)[index] = { ...port, label: `${label}${mark}`, original: { ...port.original, label } }
  }
  return () => before.forEach(([id, index, port]) => (ports.get(id)[index] = port))
}

/**
 * Names the relabelled components `<label>__<n>`, numbering each label's components from 1 in the order of their
 * first slot by instance name, skipping any label a port already has.
 *
 * @param {Array<Array<string>>} relabelled
 * @param {Map<string, Array>} ports - Changed in place.
 * @param {Array} nodes
 * @param {Map<string, Object>} nodeById
 */
function nameRelabelled(relabelled, ports, nodes, nodeById) {
  const taken = new Set(nodes.flatMap((node) => (node.data?.ports ?? []).map((port) => port.label)))
  const firstOf = (component) =>
    component
      .map((slot) => [nodeById.get(splitSlot(slot)[0]).data?.name ?? '', splitSlot(slot)[1]])
      .sort(([a, i], [b, j]) => (a < b ? -1 : a > b ? 1 : i - j))[0]
  const labelOf = (component) => {
    const [id, index] = splitSlot(component[0])
    return ports.get(id)[index].original.label
  }
  const ordered = relabelled
    .map((component) => ({ component, label: labelOf(component), first: firstOf(component) }))
    .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : a.first[0] < b.first[0] ? -1 : a.first[0] > b.first[0] ? 1 : a.first[1] - b.first[1]))
  const counts = new Map()
  for (const { component, label } of ordered) {
    let n = counts.get(label) ?? 0
    let name
    do name = `${label}__${++n}`
    while (taken.has(name))
    counts.set(label, n)
    taken.add(name)
    for (const slot of component) {
      const [id, index] = splitSlot(slot)
      ports.get(id)[index] = { ...ports.get(id)[index], label: name }
    }
  }
}

/**
 * Lists the pairings CA or the import still gives otherwise, each once, with why.
 *
 * @param {Object} state - The last evaluation.
 * @param {Object} context
 * @returns {Array<{edge: Object, label: string, reason: string}>}
 */
function residualsOf(state, { wanted, portsOf, guarded, components }) {
  const found = []
  const add = (edge, label, reason) => {
    if (!found.some((other) => other.edge === edge && other.label === label && other.reason === reason)) found.push({ edge, label, reason })
  }
  const originalLabel = (id, index) => portsOf(id)[index]?.original?.label ?? portsOf(id)[index]?.label
  const reasonOf = (edge, source, target) => {
    const slots = [`${edge.source}#${source}`, `${edge.target}#${target}`]
    const rule = slots.map((slot) => guarded.get(slot)).find(Boolean)
    if (rule) return rule
    const list = wanted.get(edge) ?? []
    const shares = list.filter((pair) => pair.source === source || pair.target === target)
    if (shares.length > 1) return 'superset'
    const component = components.of(slots[0])
    return new Set(component.map((slot) => splitSlot(slot)[0])).size > 2 ? 'component' : 'order'
  }
  const pairsOf = [...state.caDiff.missing, ...state.caDiff.spurious, ...state.importDiff.missing, ...state.importDiff.spurious]
  for (const { edge, source, target } of pairsOf) add(edge, originalLabel(edge.source, source), reasonOf(edge, source, target))
  for (const error of state.imported.errors) add(error.edge, originalLabel(error.edge.source, error.source), reasonOf(error.edge, error.source, error.target))
  for (const error of state.ca.errors.filter((error) => error.kind === 'misaligned')) {
    add(error.edge, originalLabel(error.edge.source, error.source), 'misaligned')
  }
  for (const [edge, labels] of state.ca.ruled) {
    for (const label of labels) {
      if (!(wanted.get(edge) ?? []).some((pair) => portsOf(edge.source)[pair.source]?.label === label)) add(edge, label, 'rule')
    }
  }
  // The rules wire ports of their own choosing, which may not be the ones coupled here.
  const vesselPairs = (edge) => (wanted.get(edge) ?? []).filter((pair) => originalLabel(edge.source, pair.source) === VESSEL_PORT)
  for (const [edge, mappings] of state.ca.terminals) {
    const pairs = vesselPairs(edge)
    if (pairs.length && !sameMappings(pairs.flatMap((pair) => variablePairs(edge, pair, portsOf)), mappings)) add(edge, VESSEL_PORT, 'terminal')
  }
  for (const { edge, end, index } of state.ca.junctions) {
    const pairs = vesselPairs(edge)
    if (pairs.length && !pairs.some((pair) => pair[end] === index)) add(edge, VESSEL_PORT, 'junction')
  }
  return found
}

/**
 * The variables a coupling pairs, as many as the shorter port has.
 *
 * @param {Object} edge
 * @param {{source: number, target: number}} pair
 * @param {(id: string) => Array} portsOf
 * @returns {Array<[string, string]>}
 */
function variablePairs(edge, { source, target }, portsOf) {
  const [from, to] = [portsOf(edge.source)[source]?.variables ?? [], portsOf(edge.target)[target]?.variables ?? []]
  return from.slice(0, to.length).map((variable, i) => [variable, to[i]])
}

/**
 * Whether two lists of variable pairs hold the same pairs.
 *
 * @param {Array<[string, string]>} a
 * @param {Array<[string, string]>} b
 * @returns {boolean}
 */
function sameMappings(a, b) {
  const keys = (list) => [...new Set(list.map(([x, y]) => `${x}=${y}`))].sort().join(',')
  return keys(a) === keys(b)
}

/**
 * Splits a slot key into its node id and port index.
 *
 * @param {string} slot
 * @returns {[string, number]}
 */
function splitSlot(slot) {
  const at = slot.lastIndexOf('#')
  return [slot.slice(0, at), Number(slot.slice(at + 1))]
}
