/**
 * Simulates which port slots a circulatory_autogen (CA) module array pairs, as CA's generator (CVSCellMLGenerator,
 * origin/master a9061f7f) and as PhLynx's own CA import pair them.
 */
import { checkAndClaimCouplings, resolvePortCouplings } from '../../utils/edges'
import { parseMathRef, parseModuleRef, unparseMultiport } from '../../utils/config'
import { VOLUME_PORT } from '../../utils/multiport'
import { SOURCE_PORT_TYPES, TARGET_PORT_TYPES, VESSEL_PORT } from '../../utils/ports'
import { caHeartInputs, heartSlotPin, isHeart } from '../caRules'

/** The label CA pairs one slot to one slot, and its heart, junction and terminal rules read. */
export { VESSEL_PORT }
/** CA errors that stop generation, by kind. */
export const CA_FAILURES = new Set(['noMatchingPort', 'targetFull', 'sourceFull', 'heartPin', 'listCount', 'indexError'])

// CA's vessel BC pairs (utilities/vessel_bc.py), which with a vessel's ports make it a vessel module.
const VESSEL_BC_PREFIXES = ['vv', 'vp', 'pv', 'pp']
// A pair CA's vessel_port branch skips for a rule that then wires nothing: its slots are taken, but nothing maps.
const UNWIRED = 'unwired'
const startsWithAny = (text, prefixes) => prefixes.some((prefix) => (text ?? '').startsWith(prefix))

/**
 * A node's ports as CA lists them: as a source, its exit then general ports; as a target, its entrance then general.
 *
 * @param {Array} ports
 * @returns {{ source: number[], target: number[] }} Port indices.
 */
export function caPortLists(ports) {
  const of = (type) => ports.flatMap((port, index) => (port.portType === type ? [index] : []))
  return { source: SOURCE_PORT_TYPES.flatMap(of), target: TARGET_PORT_TYPES.flatMap(of) }
}

/**
 * A port's multi_port as CA reads it once normalise_port_multi_port has put it in canonical form: null for none,
 * 'True', 'Multiply', 'sum' (a volume_port's whole-port Sum) or a list.
 *
 * @param {Object} port
 * @returns {null|string|Array}
 */
export function caMultiPort(port) {
  const value = unparseMultiport(port)
  if (value === undefined || value === null || value === false) return null
  if (Array.isArray(value)) return value.map((entry) => (typeof entry === 'string' && entry.toLowerCase() === 'sum' ? 'sum' : entry === true || entry === 'True' ? 'True' : entry))
  const text = String(value).toLowerCase()
  if (text === 'true') return 'True'
  if (text === 'false' || text === 'none') return null
  if (text === 'sum') return port.label === VOLUME_PORT ? 'sum' : ['sum']
  if (text === 'multiply') return 'Multiply'
  return value
}

const isTruthy = (multiPort) => multiPort !== null && !(Array.isArray(multiPort) && multiPort.length === 0)
const isMultiPort = (multiPort) => multiPort === 'True' || multiPort === 'Multiply' || Array.isArray(multiPort)

/**
 * Builds what the simulators read about the array: each node's ports, type and lists.
 *
 * @param {Object} array
 * @returns {Object}
 */
function readArray({ rows, outEdges, inpEdges, portsOf }) {
  const byId = new Map(rows.map((node) => [node.id, node]))
  const typeOf = (id) => parseModuleRef(byId.get(id)?.data?.moduleRef ?? ':').moduleType ?? ''
  const subtypeOf = (id) => parseModuleRef(byId.get(id)?.data?.moduleRef ?? ':').moduleSubtype ?? ''
  const componentOf = (id) => parseMathRef(byId.get(id)?.data?.mathRef ?? ':').componentName ?? ''
  const outIds = (id) => (outEdges.get(id) ?? []).map((edge) => edge.target)
  const inpIds = (id) => (inpEdges.get(id) ?? []).map((edge) => edge.source)
  const lists = new Map(rows.map((node) => [node.id, caPortLists(portsOf(node.id))]))
  return { byId, typeOf, subtypeOf, componentOf, outIds, inpIds, lists, portsOf }
}

/**
 * Whether CA counts a module as a vessel (utilities/vessel_bc.is_vessel_module): a vessel BC pair, and a vessel_port,
 * or a flow_port and a pressure_port at its ends.
 *
 * @param {string} subtype
 * @param {Array} ports
 * @returns {boolean}
 */
function isVesselModule(subtype, ports) {
  if (!VESSEL_BC_PREFIXES.includes((subtype ?? '').slice(0, 2))) return false
  if (ports.some((port) => port.label === VESSEL_PORT)) return true
  const ends = ports.filter((port) => port.portType !== 'general_ports').map((port) => port.label)
  return ends.includes('flow_port') && ends.includes('pressure_port')
}

/**
 * Pairs a module array's port slots as CA's generator does (__write_module_mapping_for_row): rows in order, each
 * row's out_instances in order, a source's exit and general ports of a label as one group and a target's entrance and
 * general ports as another. A source slot is taken for the rest of its row, a target slot for the rest of the array,
 * a multi_port slot never. vessel_port pairs one free source slot with the target's first free slot (a heart's inputs
 * by place in its inp_instances); any other label pairs every free source slot with it. Pairs a rule wires through
 * CA's own components (terminal, junction, volume sum) carry that rule.
 *
 * @param {Object} array
 * @param {Array} array.rows - The module nodes, in module array order.
 * @param {Map<string, Array>} array.outEdges - Each node's out_instances, as edges, in order.
 * @param {Map<string, Array>} array.inpEdges - Each node's inp_instances, as edges, in order.
 * @param {(id: string) => Array} array.portsOf - Each node's ports, as exported.
 * @returns {{ pairs: Array<{edge: Object, source: number, target: number, label: string, rule: string|null}>,
 *   errors: Array<{edge: Object, label?: string, kind: string, source?: number, target?: number}>,
 *   ruled: Map<Object, Set<string>>, terminals: Map<Object, Array<[string, string]>>,
 *   junctions: Array<{edge: Object, end: string, index: number}> }} errors: where CA stops (CA_FAILURES) or shifts
 *   the variables it maps ('misaligned'); ruled: each edge's labels a rule wires; terminals: the variables CA's
 *   terminal rule maps across each terminal's edges; junctions: the port CA's junction rule takes at each end.
 */
export function simulateCaPairing(array) {
  const read = readArray(array)
  const { typeOf, subtypeOf, componentOf, outIds, inpIds, lists, portsOf, byId } = read
  const pairs = []
  const errors = []
  const ruled = new Map()
  const terminals = new Map()
  const targetTaken = new Map([...lists].map(([id, { target }]) => [id, target.map(() => false)]))
  let ivcFed = 0

  const isMinJunction = (id) => startsWithAny(typeOf(id), ['Min_', 'MinNout_'])
  const isNoutJunction = (id) => startsWithAny(typeOf(id), ['Nout_', 'MinNout_'])
  const hasPort = (id, type, test) => portsOf(id).some((port) => port.portType === type && port.label === VESSEL_PORT && test(caMultiPort(port)))

  for (const row of array.rows) {
    const rowId = row.id
    const sourcePorts = portsOf(rowId)
    const { source } = lists.get(rowId)
    // The row's source groups, by label in order of first place; each slot is a place in `source`.
    const groups = new Map()
    source.forEach((index, place) => {
      const label = sourcePorts[index].label
      if (!groups.has(label)) groups.set(label, { places: [], taken: [] })
      groups.get(label).places.push(place)
      groups.get(label).taken.push(false)
    })
    const outs = outIds(rowId)
    const passesSource = outs.some((id) => isMinJunction(id) && hasPort(id, 'entrance_ports', (multiPort) => multiPort === 'True'))
    const isTerminal = typeOf(rowId).endsWith('terminal')
    // CA's terminal_venous_connection maps a terminal's pressure into a venous module, and its flow into a vessel
    // that takes flow at its inlet and doesn't sum it through a list-form vessel_port, by these names alone.
    const terminalMappings = (targetId) => {
      const mappings = []
      if (typeOf(targetId).startsWith('venous')) mappings.push(['u_out', 'u'])
      const sumsInflow = portsOf(targetId).some(
        (port) => port.portType === 'entrance_ports' && port.label === VESSEL_PORT && Array.isArray(caMultiPort(port))
      )
      if (isVesselModule(subtypeOf(targetId), portsOf(targetId)) && subtypeOf(targetId).startsWith('v') && !sumsInflow) mappings.push(['v_T', 'v_in'])
      return mappings
    }
    const vesselRule = (targetId) => {
      if (isTerminal) return terminalMappings(targetId).length ? 'terminal' : UNWIRED
      if (isNoutJunction(rowId) || isMinJunction(targetId) || outs.some(isMinJunction)) return 'junction'
      const feedsNout = outs.some((id) => byId.has(id) && isVesselModule(subtypeOf(id), portsOf(id)) && inpIds(id).some(isNoutJunction))
      return feedsNout ? 'junction' : null
    }

    for (const edge of array.outEdges.get(rowId) ?? []) {
      const targetId = edge.target
      if (!lists.has(targetId)) continue
      const targetPorts = portsOf(targetId)
      const { target } = lists.get(targetId)
      if (lacksMatchingPort(sourcePorts, targetPorts)) {
        errors.push({ edge, kind: 'noMatchingPort' })
        continue
      }
      const targetGroups = new Map()
      target.forEach((index, place) => {
        const label = targetPorts[index].label
        if (!targetGroups.has(label)) targetGroups.set(label, [])
        targetGroups.get(label).push(place)
      })
      const taken = targetTaken.get(targetId)
      // CA maps all of a connection's direct pairs as one pair of variable lists, so a pair whose source has fewer
      // variables shifts the pairs mapped after it.
      let shorter = null

      for (const [label, group] of groups) {
        const targetGroup = targetGroups.get(label)
        if (!targetGroup) continue
        let targetPlace = targetGroup.find((place) => !taken[place])
        if (targetPlace === undefined) {
          errors.push({ edge, label, kind: 'targetFull' })
          continue
        }
        const pair = (sourcePlace, rule) => {
          const sourcePort = sourcePorts[source[sourcePlace]]
          const targetPort = targetPorts[target[targetPlace]]
          const [v1, v2] = [sourcePort.variables ?? [], targetPort.variables ?? []]
          const usesList = Array.isArray(caMultiPort(sourcePort)) || Array.isArray(caMultiPort(targetPort)) || caMultiPort(sourcePort) === 'Multiply'
          const at = { edge, label, source: source[sourcePlace], target: target[targetPlace] }
          if (usesList) {
            if (v1.length !== v2.length) errors.push({ ...at, kind: 'listCount' })
            rule = null
          } else if (v1.length > v2.length) {
            errors.push({ ...at, kind: 'indexError' })
          }
          if (!rule && mapsDirectly(sourcePort, targetPort)) {
            if (shorter && !shorter.reported) {
              errors.push({ ...shorter, kind: 'misaligned' })
              shorter.reported = true
            }
            if (!usesList && v1.length < v2.length) shorter = { ...at }
          }
          if (isTerminal && (rule === 'terminal' || rule === UNWIRED)) terminals.set(edge, terminalMappings(targetId))
          if (rule === UNWIRED) return { sourcePort, targetPort }
          if (rule) ruled.set(edge, (ruled.get(edge) ?? new Set()).add(label))
          pairs.push({ ...at, rule: rule ?? null })
          return { sourcePort, targetPort }
        }

        if (label === VESSEL_PORT) {
          const free = group.taken.findIndex((isTaken) => !isTaken)
          if (isHeart(typeOf(targetId))) {
            const inputs = caHeartInputs(inpIds(targetId), outIds(targetId).length)
            if (inputs.length === 2) ivcFed = 1
            const at = inputs.slice(0, 3).indexOf(rowId)
            if (at !== -1) targetPlace = at + ivcFed
            else if (inputs.length < 3) {
              errors.push({ edge, label, kind: 'heartPin' })
              continue
            }
          }
          if (free === -1) {
            errors.push({ edge, label, kind: 'sourceFull' })
            continue
          }
          if (targetPlace >= target.length) {
            errors.push({ edge, label, kind: 'heartPin' })
            continue
          }
          const { sourcePort, targetPort } = pair(group.places[free], vesselRule(targetId))
          const sourceMulti = caMultiPort(sourcePort)
          if (sourceMulti !== null ? !isTruthy(sourceMulti) : !passesSource) group.taken[free] = true
          const targetMulti = caMultiPort(targetPort)
          const passesTarget = inpIds(targetId).some((id) => isNoutJunction(id) && hasPort(id, 'exit_ports', isTruthy))
          if (targetMulti !== null ? !isMultiPort(targetMulti) : !passesTarget) taken[targetPlace] = true
        } else {
          for (let slot = 0; slot < group.places.length; slot++) {
            if (group.taken[slot]) continue
            const targetPort = targetPorts[target[targetPlace]]
            const tissueGe = componentOf(rowId) === 'tissue_GE_simple_type' && componentOf(targetId) === 'gas_transport_simple_type'
            const rule = tissueGe ? 'tissueGE' : caMultiPort(targetPort) === 'sum' ? 'volume' : null
            const { sourcePort } = pair(group.places[slot], rule)
            if (!isTruthy(caMultiPort(sourcePort))) group.taken[slot] = true
            if (!isTruthy(caMultiPort(targetPort))) taken[targetPlace] = true
          }
        }
      }
    }
  }
  return { pairs, errors, ruled, terminals, junctions: junctionPorts(array, read) }
}

/**
 * Whether CA maps any of a pair's variables directly, adding them to the connection's lists: all of a plain pair's,
 * and a list-form pair's that neither side sums nor a Multiply source scales.
 *
 * @param {Object} sourcePort
 * @param {Object} targetPort
 * @returns {boolean}
 */
function mapsDirectly(sourcePort, targetPort) {
  const [m1, m2] = [caMultiPort(sourcePort), caMultiPort(targetPort)]
  if (m1 === 'Multiply') return false
  if (!Array.isArray(m1) && !Array.isArray(m2)) return true
  const count = Math.min(sourcePort.variables?.length ?? 0, targetPort.variables?.length ?? 0)
  const isSum = (list, i) => Array.isArray(list) && list[i] === 'sum'
  return Array.from({ length: count }, (_, i) => i).some((i) => !isSum(m1, i) && !isSum(m2, i) && !(Array.isArray(m1) && String(m1[i]).toLowerCase() === 'multiply'))
}

/**
 * Lists the vessel_port CA's generic_junction_connection takes at each module meeting a Min_/Nout_ junction
 * (__junction_node_neighbours): on the side facing the node, the vessel_port with two variables at the place of the
 * module it meets the node through in its inp or out instances, the last one past their end.
 *
 * @param {Object} array
 * @param {Object} read - From readArray.
 * @returns {Array<{edge: Object, end: string, index: number}>} The edge joining each module to the one it meets the
 *   node through, which end the module is, and its port's index.
 */
function junctionPorts(array, { typeOf, outIds, inpIds, portsOf, byId }) {
  const found = []
  const edgeBetween = (from, to) => (array.outEdges.get(from) ?? []).find((edge) => edge.target === to)
  const sidesOf = (type) => {
    if (type.includes('Min_junction')) return ['Min']
    if (type.includes('MinNout_junction')) return ['Min', 'Nout']
    return type.includes('Nout_junction') ? ['Nout'] : []
  }
  for (const row of array.rows) {
    for (const side of sidesOf(typeOf(row.id))) {
      const names = []
      const add = (name, sign, via) => {
        if (!byId.has(name)) return
        const [type, connected] = sign > 0 ? ['exit_ports', outIds(name)] : ['entrance_ports', inpIds(name)]
        const vessels = portsOf(name).flatMap((port, index) =>
          port.portType === type && port.label === VESSEL_PORT && port.variables?.length >= 2 && port.variables[0] && port.variables[1] ? [index] : []
        )
        if (!vessels.length) return
        names.push(name)
        const at = vessels.length > 1 && connected.includes(via) ? Math.min(connected.indexOf(via), vessels.length - 1) : 0
        const edge = sign > 0 ? edgeBetween(name, via) : edgeBetween(via, name)
        if (edge) found.push({ edge, end: sign > 0 ? 'source' : 'target', index: vessels[at] })
      }
      const direct = side === 'Min' ? inpIds(row.id) : outIds(row.id)
      for (const name of direct) {
        if (inpIds(name).includes(row.id)) add(name, -1, row.id)
        else if (outIds(name).includes(row.id)) add(name, 1, row.id)
      }
      for (const other of array.rows) {
        if (!names.includes(other.id)) continue
        const atNode = inpIds(other.id).includes(row.id) ? inpIds(other.id) : outIds(other.id).includes(row.id) ? outIds(other.id) : null
        for (const name of atNode ?? []) {
          if (name !== row.id && !names.includes(name)) add(name, side === 'Min' ? -1 : 1, other.id)
        }
      }
    }
  }
  return found
}

/**
 * Compares simulated pairs with the wanted ones, edge by edge. A label a CA rule wires on an edge (see
 * simulateCaPairing's `ruled`) is left out on both sides, as CA's own component chooses what it joins.
 *
 * @param {Map<Object, Array<{source: number, target: number}>>} wanted - Each edge's pairs, as port indices.
 * @param {Array<{edge: Object, source: number, target: number, rule?: string|null}>} simulated
 * @param {Object} options
 * @param {Map<Object, Set<string>>} [options.ruled] - Each edge's labels to leave out.
 * @param {(id: string) => Array} options.portsOf - Each node's ports, as exported.
 * @returns {{ missing: Array<{edge: Object, source: number, target: number}>, spurious: Array<{edge: Object,
 *   source: number, target: number}> }}
 */
export function comparePairs(wanted, simulated, { ruled = new Map(), portsOf }) {
  const isRuled = (edge, source) => ruled.get(edge)?.has(portsOf(edge.source)[source]?.label) ?? false
  const keyOf = ({ source, target }) => `${source}>${target}`
  const got = new Map()
  const spurious = []
  for (const pair of simulated) {
    if (pair.rule || isRuled(pair.edge, pair.source)) continue
    if (!got.has(pair.edge)) got.set(pair.edge, new Set())
    if (got.get(pair.edge).has(keyOf(pair))) continue
    got.get(pair.edge).add(keyOf(pair))
    if (!(wanted.get(pair.edge) ?? []).some((other) => keyOf(other) === keyOf(pair))) {
      spurious.push({ edge: pair.edge, source: pair.source, target: pair.target })
    }
  }
  const missing = [...wanted].flatMap(([edge, list]) =>
    list.filter((pair) => !isRuled(edge, pair.source) && !got.get(edge)?.has(keyOf(pair))).map((pair) => ({ edge, ...pair }))
  )
  return { missing, spurious }
}

/**
 * Whether CA stops on a source and target that share no label (CVSCellMLGenerator.__check_input_output_ports): only
 * when the source has both exit and general ports.
 *
 * @param {Array} sourcePorts
 * @param {Array} targetPorts
 * @returns {boolean}
 */
function lacksMatchingPort(sourcePorts, targetPorts) {
  const targets = new Set(targetPorts.filter((port) => port.portType !== 'exit_ports').map((port) => port.label))
  const shares = (type) => {
    const ports = sourcePorts.filter((port) => port.portType === type)
    return !ports.length || ports.some((port) => targets.has(port.label))
  }
  return !shares('exit_ports') && !shares('general_ports')
}

/**
 * Pairs a module array's port slots as PhLynx's CA import does (buildWorkflow.js buildEdges): each conduit in row and
 * out_instances order, with resolvePortCouplings, a heart's input pinned to the slot CA gives it.
 *
 * @param {Object} array - As for simulateCaPairing.
 * @returns {{ pairs: Array<{edge: Object, source: number, target: number, label: string}>,
 *   errors: Array<{edge: Object, kind: string, source?: number, target?: number, label?: string}> }} errors: each
 *   conduit the import leaves out ('importConflict'), with the couplings it would have made.
 */
export function simulateImportPairing(array) {
  const { typeOf, outIds, inpIds, lists, portsOf } = readArray(array)
  const used = new Set()
  const pairs = []
  const errors = []
  for (const row of array.rows) {
    for (const edge of array.outEdges.get(row.id) ?? []) {
      if (!lists.has(edge.target)) continue
      const [sourcePorts, targetPorts] = [portsOf(edge.source), portsOf(edge.target)]
      const stored = isHeart(typeOf(edge.target))
        ? heartSlotPin(targetPorts, caHeartInputs(inpIds(edge.target), outIds(edge.target).length), edge.source)
        : []
      const couplings = resolvePortCouplings(sourcePorts, targetPorts, { sourceId: edge.source, targetId: edge.target, usedPortKeys: used, stored })
      const found = couplings.map(({ sourcePort, targetPort }) => ({
        edge,
        source: sourcePorts.indexOf(sourcePort),
        target: targetPorts.indexOf(targetPort),
        label: sourcePort.label,
      }))
      if (!couplings.length) continue
      if (!checkAndClaimCouplings(edge.source, edge.target, couplings, used).valid) {
        errors.push(...found.map((pair) => ({ ...pair, kind: 'importConflict' })))
        continue
      }
      pairs.push(...found)
    }
  }
  return { pairs, errors }
}
