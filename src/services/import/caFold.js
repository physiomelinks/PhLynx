/**
 * Imports a circulatory_autogen (CA) module array that instantiates super-modules: CA's expansion
 * (expandSupermodules), built as a flat module array is (buildWorkflowGraph), so its couplings and slots are exactly
 * CA's, then folded back into super instances. Pure.
 *
 * The fold groups the expanded modules by the path CA expanded each from (`heart/ra`), deepest first:
 * - One super-module per (module_type, module_subtype), its children named by the last segment of their paths, never
 *   by cutting a prefix off a flat name; an occurrence whose internal couplings differ from the others' (CA can splice
 *   slots per occurrence) gets a super-module of its own.
 * - An edge inside an occurrence moves into its super-module. One that crosses its boundary becomes an exposure edge
 *   from the child inside to the interface, exposing the ports it uses, and an edge outside whose couplings name those
 *   exposed ports in the same slots. Exposed ports are ordered as CA splices hosts: inputs before outputs, each in the
 *   instance's per_submodule_* key order.
 * - A super-module PhLynx wrote (see export/caNative.js) keeps its passthrough keys' layout (`phlynx_layout`: its
 *   children's and interface's positions) and exposed ports (`phlynx_interface`: their order and labels, and any no
 *   edge here uses).
 * - Values, lowest precedence first: a super-module's children take its default parameterisation (CA's `lv/E` rows,
 *   over the parameterisations its component submodules name); an outer super-module's rows naming a nested one's
 *   modules are overrides on that super instance inside it; whatever else an occurrence's modules have (its own
 *   parameterisation, the host parameters file) is an override on its outermost super instance. Global rows set global
 *   constants, the first winning, as in CA.
 */
import { buildSuperInstance, buildSupermoduleInterface, buildWorkflowGraph } from './buildWorkflow'
import { withoutZeroedIvcRows } from '../caRules'
import { normaliseModuleRecords, toInstanceRows } from './caModuleArray'
import { moduleRefOf } from './caModuleConfig'
import {
  CA_SEPARATOR,
  componentParameterRows,
  conflictingGlobals,
  expandSupermodules,
  firstRowsWin,
  mergeDefaultParameters,
} from './caSupermodules'
import { applyRowsByName, componentEntries, globalRows, rowIndex } from './caParameters'
import { expandHierarchy, EXPANDED_ID_SEPARATOR } from '../hierarchy/expand'
import { aliasKey, EXPOSED_PORT_ID_PREFIX, superInstancePorts } from '../hierarchy/exposure'
import { supermoduleContentHash } from '../hierarchy/operations'
import { slotOf } from '../../utils/edges'
import { EXPOSURE_EDGE_TYPE, HANDLE_VARIANT } from '../../utils/constants'
import { findMostCentralGhostHandle, getHandleId } from '../../utils/handles'
import { hashText } from '../../utils/hash'
import { isSuperInstance, isSupermoduleInterface, localNameProblem, nextSequentialId, nodeIdOf, SUPERMODULE_ID_PREFIX } from '../../utils/hierarchy'

const NODE_ID_PREFIX = 'dndnode_'
const PER_KEY = { in: 'per_submodule_inputs', out: 'per_submodule_outputs' }
// Where an edge or exposure attaches on a node: inputs on top, outputs below, as buildHandles puts them.
const SIDE = { source: 'bottom', target: 'top' }
const INTERFACE_SIDE = { in: 'left', out: 'right' }
const LAST = Number.MAX_SAFE_INTEGER
/** The passthrough keys of a super-module config entry PhLynx wrote: its layout and its exposed ports. */
export const PHLYNX_LAYOUT_KEY = 'phlynx_layout'
export const PHLYNX_INTERFACE_KEY = 'phlynx_interface'
// Which way an exposed port of each port type faces, where no edge says.
const DIRECTION_OF = { entrance_ports: 'in', exit_ports: 'out', general_ports: 'in' }

/**
 * @typedef {Object} CaLibrary
 * @property {Map<string, Object>} supermodules - moduleRef -> template (libraryStore.availableSupermodules).
 * @property {Map<string, Object>} modules - moduleRef -> component module (libraryStore.availableModules).
 * @property {Function} [getMathAnalysis]
 * @property {Function} [getMathDefaults]
 * @property {Map<string, Object>} [variants] - libraryStore.caVariants.
 */

const clone = (value) => JSON.parse(JSON.stringify(value))
const keyOf = (path) => path.join('/')
const asText = (value) => String(value ?? '').trim()
const refOf = (record) => moduleRefOf(record.module_type, record.module_subtype)

/**
 * A short content hash of a super-module and every one nested in it, without the files they came from: what the
 * palette reuses a workspace super-module by.
 *
 * @param {string} moduleRef
 * @param {Map<string, Object>} supermodules
 * @returns {string}
 */
export function templateHash(moduleRef, supermodules) {
  const seen = new Map()
  const visit = (ref) => {
    const template = supermodules.get(ref)
    if (!template || seen.has(ref)) return
    const { configFile: _file, ...content } = template
    seen.set(ref, content)
    template.submodules.forEach((sub) => visit(refOf(sub)))
  }
  visit(moduleRef)
  return hashText(JSON.stringify([...seen].sort(([a], [b]) => a.localeCompare(b))))
}

/**
 * Builds a module array as CA loads it, flat: its super-modules expanded (CA's `_` between levels), its modules and
 * edges built, and its parameters applied by exact name (host file, then the super-modules' parameterisations and
 * default_parameters, then the parameterisations their component submodules name).
 *
 * @param {Object[]} rows - Module array rows, as parseInstanceArray gives them or normalised.
 * @param {CaLibrary} library
 * @param {Object} [options]
 * @param {string} [options.source] - Message prefix.
 * @param {import('./caSupermodules').ParameterLoader} [options.load] - Without one, no parameter file is read.
 * @param {Object[]} [options.hostRows=[]] - The host parameters file's rows, `heart/lv/E` or `E_heart_lv`.
 * @param {Array} [options.currentNodes=[]] - Nodes whose ids are taken.
 * @returns {{topRecords: Object[], records: Object[], paths: Map<string, string[]>, base: Array, nodes: Array,
 *   edges: Array, conflicts: string[], parameterRows: Object[], globals: Array, skipped: Array, warnings: string[]}}
 *   `base` the modules as built, `nodes` with their values; `paths` each module's path by its record name.
 * @throws {Error} as expandSupermodules does.
 */
export function buildCaModel(rows, library, { source = 'module array', load, hostRows = [], currentNodes = [] } = {}) {
  const topRecords = normaliseModuleRecords(rows, source)
  const settings = []
  const expanded = expandSupermodules(topRecords, library.supermodules, { source, load, settings })
  // A top-level module's parameterisation is not read, as for a flat module array.
  const nested = expanded.records.filter((record) => expanded.paths.get(record.name).length > 1)
  const own = load ? componentParameterRows(nested, componentEntries(library.modules), { source, load, settings }) : []
  const graph = buildWorkflowGraph(
    toInstanceRows(expanded.records),
    library.modules,
    library.getMathAnalysis,
    currentNodes,
    null,
    library.getMathDefaults,
    { caRules: true, variants: library.variants }
  )
  // CA deletes the ivc flow of a heart it feeds from zero_flow, whatever sets it.
  const parameterRows = withoutZeroedIvcRows(
    mergeDefaultParameters(hostRows, firstRowsWin([...expanded.parameterRows, ...own])),
    graph.ivcZeroedHearts
  )
  const applied = applyRowsByName(graph.pendingInstances, rowIndex(parameterRows))
  return {
    topRecords,
    records: expanded.records,
    paths: expanded.paths,
    base: graph.pendingInstances,
    nodes: applied.nodes,
    edges: graph.pendingEdges,
    conflicts: graph.conflicts,
    parameterRows,
    globals: globalRows(parameterRows, applied.used, applied.nodes),
    skipped: applied.skipped,
    warnings: [...expanded.warnings, ...conflictingGlobals(settings, source)],
  }
}

/**
 * The default parameter rows of a super-module, as CA gives one instance of it with no parameterisation of its own,
 * indexed by name, and the CA name of its module at a path below it.
 */
function supermoduleDefaults(def, library, components, { source, load }) {
  const name = def.rep.path.at(-1)
  const caName = (relative) => [name, ...relative].join(CA_SEPARATOR)
  if (!load) return { index: new Map(), caName }
  const record = { name, module_type: def.template.module_type, module_subtype: def.template.module_subtype, inp_instances: [], out_instances: [] }
  const settings = []
  const expanded = expandSupermodules([record], library.supermodules, { source, load, settings })
  const own = componentParameterRows(expanded.records, components, { source, load, settings })
  return { index: rowIndex(firstRowsWin([...expanded.parameterRows, ...own])), caName }
}

/** @returns {Object} The values of `to` that differ from `from`'s, by row name, as overrides. */
function valueOverrides(from, to) {
  const before = new Map((from ?? []).map((row) => [row.name, row]))
  const patches = {}
  for (const row of to ?? []) {
    if (before.has(row.name) && asText(before.get(row.name).value) !== asText(row.value)) patches[row.name] = { value: row.value }
  }
  return patches
}

/**
 * Hands out the handles of a node, one per side, shared by every edge on it: a ghost turned on, else one there.
 *
 * @param {Object} node - Its handles change in place.
 * @returns {(side: string) => string} A side's handle id.
 */
export function sideHandles(node) {
  const claimed = new Map()
  return (side) => {
    if (!claimed.has(side)) {
      const handles = node.data.handles ?? (node.data.handles = [])
      let handle = findMostCentralGhostHandle(side, handles) ?? handles.find((candidate) => candidate.side === side)
      if (!handle) {
        handle = { uid: crypto.randomUUID(), side, name: '' }
        handles.push(handle)
      }
      handle.variant = HANDLE_VARIANT.DEFAULT
      claimed.set(side, getHandleId(handle))
    }
    return claimed.get(side)
  }
}

/**
 * Turns the handles no edge uses back into ghosts.
 *
 * @param {Array} nodes - Their handles change in place.
 * @param {Array} edges
 */
export function ghostUnusedHandles(nodes, edges) {
  const used = new Set(edges.flatMap((edge) => [`${edge.source}\0${edge.sourceHandle}`, `${edge.target}\0${edge.targetHandle}`]))
  for (const node of nodes) {
    for (const handle of node.data?.handles ?? []) {
      if (handle.variant !== HANDLE_VARIANT.GHOST && !used.has(`${node.id}\0${getHandleId(handle)}`)) handle.variant = HANDLE_VARIANT.GHOST
    }
  }
}

/**
 * Folds a module array's flat build (see buildCaModel) into super-modules and super instances.
 *
 * @param {ReturnType<typeof buildCaModel>} model
 * @param {CaLibrary} library
 * @param {Object} [options]
 * @param {string} [options.source]
 * @param {import('./caSupermodules').ParameterLoader} [options.load] - For the super-modules' default values.
 * @param {Array} [options.currentNodes=[]] - Nodes already in the store, whose ids and super-module names are taken.
 * @param {string} [options.nextExposedPortId] - The first exposed port id free, `xp_0` by default.
 * @returns {{nodes: Array, edges: Array, warnings: string[], supermodules: Array<{smId: string, moduleRef: string,
 *   fork: boolean}>, positioned: Set<string>}} Root nodes first, in module array order; every node and edge with its
 *   scope's `hidden`; `positioned` the super-modules whose layout their config gave, which need none.
 */
export function foldCaModel(model, library, { source = 'module array', load, currentNodes = [], nextExposedPortId } = {}) {
  const { topRecords, records, paths, base, nodes: valued, edges } = model
  const { supermodules } = library
  const warnings = []
  const pathOf = (index) => paths.get(records[index].name)
  const leafByPath = new Map(records.map((record, index) => [keyOf(paths.get(record.name)), index]))
  const indexById = new Map(base.map((node, index) => [node.id, index]))

  // The occurrences of super-modules, each with its children in its super-module's submodule order.
  const occurrences = new Map()
  const visit = (path, record, parent) => {
    const template = supermodules.get(refOf(record))
    const occurrence = { key: keyOf(path), path, moduleRef: refOf(record), template, record, parent, children: [] }
    occurrences.set(occurrence.key, occurrence)
    for (const sub of template.submodules) {
      const childPath = [...path, sub.name]
      occurrence.children.push(
        supermodules.has(refOf(sub)) ? { name: sub.name, occurrence: visit(childPath, sub, occurrence) } : { name: sub.name, leaf: leafByPath.get(keyOf(childPath)) }
      )
    }
    return occurrence
  }
  topRecords.filter((record) => supermodules.has(refOf(record))).forEach((record) => visit([record.name], record, null))

  // Each edge's scope: the innermost occurrence holding both its ends ('' for the root).
  const edgeScope = (edge) => {
    const [a, b] = [pathOf(indexById.get(edge.source)), pathOf(indexById.get(edge.target))]
    let depth = 0
    while (depth < Math.min(a.length, b.length) - 1 && a[depth] === b[depth]) depth++
    return { depth, key: keyOf(a.slice(0, depth)) }
  }
  const edgesAt = new Map()
  for (const edge of edges) {
    const { key } = edgeScope(edge)
    if (!edgesAt.has(key)) edgesAt.set(key, [])
    edgesAt.get(key).push(edge)
  }

  // Super-modules: occurrences of one type with the same insides share one; the deepest are made first.
  const taken = new Set(currentNodes.map((node) => node.id))
  const names = new Set(currentNodes.filter(isSupermoduleInterface).map((node) => node.data?.supermodule?.name))
  const claim = (base) => {
    let name = base
    for (let n = 2; names.has(name); n++) name = `${base}_${n}`
    names.add(name)
    return name
  }
  const defs = []
  const defOf = new Map()
  const byRef = new Map()
  const relative = (occurrence, index) => keyOf(pathOf(index).slice(occurrence.path.length))
  const signature = (occurrence) =>
    JSON.stringify([
      occurrence.children.map((child) => (child.occurrence ? defOf.get(child.occurrence.key).smId : base[child.leaf]?.data?.moduleRef)),
      (edgesAt.get(occurrence.key) ?? []).map((edge) => [
        relative(occurrence, indexById.get(edge.source)),
        relative(occurrence, indexById.get(edge.target)),
        (edge.data?.couplings ?? []).map((c) => [c.sourcePort?.portType, c.sourcePort?.label, c.sourceSlot, c.targetPort?.portType, c.targetPort?.label, c.targetSlot]),
      ]),
    ])
  const deepestFirst = [...occurrences.values()].sort((a, b) => b.path.length - a.path.length)
  for (const occurrence of deepestFirst) {
    const sig = signature(occurrence)
    const same = byRef.get(occurrence.moduleRef) ?? []
    let def = same.find((candidate) => candidate.sig === sig)
    if (!def) {
      const smId = nextSequentialId(taken, SUPERMODULE_ID_PREFIX)
      taken.add(smId)
      def = { smId, sig, moduleRef: occurrence.moduleRef, template: occurrence.template, rep: occurrence, occurrences: [], fork: same.length > 0, name: claim(occurrence.template.module_type), exposed: new Map(), childIds: new Map() }
      byRef.set(occurrence.moduleRef, [...same, def])
      defs.push(def)
    }
    def.occurrences.push(occurrence)
    defOf.set(occurrence.key, def)
  }
  for (const [moduleRef, list] of byRef) {
    if (list.length < 2) continue
    const described = list.map((def) => `${def.name} (${def.occurrences.map((o) => o.key).join(', ')})`).join('; ')
    warnings.push(
      `${source}: the occurrences of super-module ${moduleRef} expand to different internal couplings, so each kind is ` +
        `its own super-module: ${described}.`
    )
  }

  // Exposed ports: each port a crossing edge uses, through every level it crosses.
  let xp = Number((nextExposedPortId ?? `${EXPOSED_PORT_ID_PREFIX}0`).slice(EXPOSED_PORT_ID_PREFIX.length))
  let uses = 0
  const expose = (def, child, alias, dir) => {
    const key = `${child}\0${alias.via ?? `${alias.portType}:${alias.label}#${alias.slot}`}`
    if (!def.exposed.has(key)) def.exposed.set(key, { id: `${EXPOSED_PORT_ID_PREFIX}${xp++}`, alias, child, dir, use: uses++ })
    return def.exposed.get(key).id
  }
  /** The exposed port, on the child of the scope `depth` deep, that a leaf's port is reached through. */
  const exposedPortOf = (index, port, slot, depth, dir) => {
    const path = pathOf(index)
    let alias = { portType: port.portType, label: port.label, slot: slotOf(base[index].data.ports ?? [], port, slot) }
    for (let level = path.length - 1; level > depth; level--) {
      alias = { via: expose(defOf.get(keyOf(path.slice(0, level))), path[level], alias, dir) }
    }
    return alias.via
  }
  const ends = (edge) => {
    const { depth, key } = edgeScope(edge)
    const end = (side) => ({ side, index: indexById.get(edge[side]), nested: pathOf(indexById.get(edge[side])).length > depth + 1 })
    return { depth, key, source: end('source'), target: end('target') }
  }
  const crossing = edges.map((edge) => {
    const at = ends(edge)
    const via = (edge.data?.couplings ?? []).map((coupling) =>
      Object.fromEntries(
        ['source', 'target']
          .filter((side) => at[side].nested)
          .map((side) => [side, exposedPortOf(at[side].index, coupling[`${side}Port`], coupling[`${side}Slot`], at.depth, side === 'target' ? 'in' : 'out')])
      )
    )
    return { edge, at, via }
  })

  // The nodes: each super-module's interface and children, and the root's modules and super instances.
  const withStyle = (node, from) => (from?.style ? { ...node, style: { ...from.style } } : node)
  const defNodes = []
  const nodeById = new Map()
  const add = (list, node) => {
    list.push(node)
    nodeById.set(node.id, node)
    return node
  }
  for (const def of defs) {
    const submoduleOrder = []
    def.rep.children.forEach((child, i) => {
      const localId = `${NODE_ID_PREFIX}${i}`
      const id = nodeIdOf(def.smId, localId)
      submoduleOrder.push(localId)
      def.childIds.set(child.name, id)
      if (child.occurrence) {
        const node = buildSuperInstance(id, child.name, defOf.get(child.occurrence.key).smId, { scope: def.smId })
        add(defNodes, withStyle(node, base[0]))
      } else {
        const from = clone(base[child.leaf])
        add(defNodes, { ...from, id, data: { ...from.data, scope: def.smId, localId, name: child.name } })
      }
    })
    const { module_type, module_subtype, configFile } = def.template
    const sourceInfo = { format: 'circulatory_autogen', moduleRef: def.moduleRef, configFile: configFile ?? null, hash: templateHash(def.moduleRef, supermodules), ...(def.fork && { fork: true }) }
    add(defNodes, buildSupermoduleInterface(def.smId, { name: def.name, ca: { module_type, module_subtype }, submoduleOrder, source: sourceInfo }))
  }
  const positioned = new Set(defs.filter((def) => placeAsDeclared(def, nodeById)).map((def) => def.smId))
  const rootNodes = []
  const rootIds = new Map()
  const flatIds = new Set([...taken, ...base.map((node) => node.id)])
  for (const record of topRecords) {
    const occurrence = occurrences.get(record.name)
    if (!occurrence) {
      const node = valued[leafByPath.get(record.name)]
      if (node) rootIds.set(record.name, add(rootNodes, clone(node)).id)
      continue
    }
    const id = nextSequentialId(flatIds, NODE_ID_PREFIX)
    flatIds.add(id)
    // Where the module array placed it, else where the root's layout will.
    const placed = record.x !== undefined && record.y !== undefined ? { x: Number(record.x), y: Number(record.y) } : null
    const superInstance = buildSuperInstance(id, record.name, defOf.get(occurrence.key).smId, { position: placed })
    rootIds.set(record.name, add(rootNodes, placed ? superInstance : withStyle(superInstance, base[0])).id)
  }
  const problems = [
    ...defNodes.filter((node) => !isSupermoduleInterface(node)).map((node) => [node.data.name, localNameProblem(node.data.name, { scope: node.data.scope })]),
    ...rootNodes.filter(isSuperInstance).map((node) => [node.data.name, localNameProblem(node.data.name, { superInstance: true })]),
  ].filter(([, problem]) => problem)
  if (problems.length) {
    warnings.push(`${source}: some names break the rules for names inside super-modules; rename them: ${problems.map(([, p]) => p).join(' ')}`)
  }

  // Exposure edges, one per child exposing anything, its ports in CA's splice order.
  const sides = new Map()
  const handleOf = (id, side) => {
    if (!sides.has(id)) sides.set(id, sideHandles(nodeById.get(id)))
    return sides.get(id)(side)
  }
  const exposureEdges = []
  for (const def of defs) {
    const rank = (entry) => {
      const index = Object.keys(def.rep.record[PER_KEY[entry.dir]] ?? {}).indexOf(entry.child)
      return index < 0 ? LAST : index
    }
    const declared = declaredInterface(def, () => `${EXPOSED_PORT_ID_PREFIX}${xp++}`)
    const ordered =
      declared ?? [...def.exposed.values()].sort((a, b) => (a.dir === b.dir ? 0 : a.dir === 'in' ? -1 : 1) || rank(a) - rank(b) || a.use - b.use)
    const byChild = new Map()
    ordered.forEach((entry, order) => {
      if (!byChild.has(entry.child)) byChild.set(entry.child, [])
      byChild.get(entry.child).push({ id: entry.id, alias: entry.alias, ...(entry.label && { label: entry.label }), order, dir: entry.dir })
    })
    for (const [child, entries] of byChild) {
      const childId = def.childIds.get(child)
      exposureEdges.push({
        id: `${childId}--${def.smId}`,
        type: EXPOSURE_EDGE_TYPE,
        source: childId,
        target: def.smId,
        sourceHandle: handleOf(childId, entries[0].dir === 'in' ? SIDE.target : SIDE.source),
        targetHandle: handleOf(def.smId, INTERFACE_SIDE[entries[0].dir]),
        data: { exposed: entries.map(({ dir: _dir, ...entry }) => entry) },
      })
    }
  }

  // Every super instance's ports, from its super-module's exposure edges.
  const allNodes = [...rootNodes, ...defNodes]
  const portsOf = new Map(defs.map((def) => [def.smId, superInstancePorts(allNodes, exposureEdges, def.smId)]))
  for (const node of allNodes.filter(isSuperInstance)) node.data.ports = clone(portsOf.get(node.data.smId))

  // The model edges, at the root and in each super-module (from the occurrence it was made from), one per pair of
  // nodes and direction.
  const merged = new Map()
  const edgeIds = new Set()
  for (const { edge, at, via } of crossing) {
    const scopeDef = at.key ? defOf.get(at.key) : null
    if (scopeDef && scopeDef.rep.key !== at.key) continue
    const nodeAt = (end) => {
      const name = pathOf(end.index)[at.depth]
      return scopeDef ? scopeDef.childIds.get(name) : rootIds.get(name)
    }
    const [source, target] = [nodeAt(at.source), nodeAt(at.target)]
    const key = `${at.key}\0${source}\0${target}`
    if (!merged.has(key)) {
      let id = `${source}--${target}`
      for (let n = 2; edgeIds.has(id); n++) id = `${source}--${target}--${n}`
      edgeIds.add(id)
      merged.set(key, {
        ...clone(edge),
        id,
        source,
        target,
        sourceHandle: at.source.nested ? handleOf(source, SIDE.source) : edge.sourceHandle,
        targetHandle: at.target.nested ? handleOf(target, SIDE.target) : edge.targetHandle,
        data: { ...clone(edge.data ?? {}), couplings: [] },
      })
    }
    const outer = merged.get(key)
    ;(edge.data?.couplings ?? []).forEach((coupling, k) => {
      const next = clone(coupling)
      for (const side of ['source', 'target']) {
        const exposedPortId = via[k][side]
        if (!exposedPortId) continue
        const ports = nodeById.get(outer[side]).data.ports
        const port = ports.find((candidate) => candidate.exposedPortId === exposedPortId)
        next[`${side}Port`] = clone(port)
        next[`${side}Slot`] = ports.filter((other) => other.portType === port.portType && other.label === port.label).indexOf(port)
      }
      outer.data.couplings.push(next)
    })
  }
  const modelEdges = [...merged.values()]

  // Values: each super-module's defaults, innermost first, then each root super instance's overrides.
  const components = componentEntries(library.modules)
  const options = { source, load }
  for (const def of defs) {
    const { index, caName } = supermoduleDefaults(def, library, components, options)
    for (const [name, id] of def.childIds) {
      const node = nodeById.get(id)
      if (!isSuperInstance(node)) node.data.variables = applyRowsByName([node], index, () => caName([name])).nodes[0].data.variables
    }
    const probe = buildSuperInstance(`${NODE_ID_PREFIX}probe`, def.rep.path.at(-1), def.smId)
    const expansion = expandHierarchy([...defNodes, probe], [])
    for (const leaf of expansion.nodes) {
      const ids = leaf.id.split(EXPANDED_ID_SEPARATOR)
      if (ids.length < 3) continue
      const relativePath = expansion.pathOf(leaf.id).split('/').slice(1)
      const target = applyRowsByName([leaf], index, () => caName(relativePath)).nodes[0]
      const patches = valueOverrides(leaf.data.variables, target.data.variables)
      if (!Object.keys(patches).length) continue
      const superInstance = nodeById.get(nodeIdOf(def.smId, ids[1]))
      const key = ids.slice(2).join(EXPANDED_ID_SEPARATOR)
      superInstance.data.overrides = { ...superInstance.data.overrides, [key]: { ...superInstance.data.overrides?.[key], ...patches } }
    }
  }
  const expansion = expandHierarchy(allNodes, [])
  for (const leaf of expansion.nodes) {
    const ids = leaf.id.split(EXPANDED_ID_SEPARATOR)
    if (ids.length < 2) continue
    const target = valued[leafByPath.get(expansion.pathOf(leaf.id))]
    const patches = valueOverrides(leaf.data.variables, target?.data?.variables)
    if (!Object.keys(patches).length) continue
    const superInstance = nodeById.get(ids[0])
    superInstance.data.overrides = { ...superInstance.data.overrides, [ids.slice(1).join(EXPANDED_ID_SEPARATOR)]: patches }
  }

  const outEdges = [...modelEdges, ...exposureEdges]
  ghostUnusedHandles(allNodes, outEdges)

  // What each super-module holds as made from its template, so an edit that changes it shows (see useSupermodules).
  for (const node of allNodes) {
    const source = isSupermoduleInterface(node) ? node.data.supermodule?.source : null
    if (!source) continue
    source.contentHash = supermoduleContentHash(node.id, allNodes, outEdges)
    // What its circulatory_autogen identity stands for, which what it exposes isn't part of.
    source.caHash = supermoduleContentHash(node.id, allNodes, outEdges, { exposure: false })
  }

  const scopeOfId = new Map(allNodes.map((node) => [node.id, node.data?.scope ?? null]))
  return {
    nodes: allNodes.map((node) => ({ ...node, hidden: (node.data?.scope ?? null) !== null })),
    edges: outEdges.map((edge) => ({ ...edge, hidden: (scopeOfId.get(edge.source) ?? null) !== null })),
    warnings,
    supermodules: defs.map((def) => ({ smId: def.smId, moduleRef: def.moduleRef, fork: def.fork })),
    positioned,
  }
}

/**
 * The exposed ports a super-module's config declares (`phlynx_interface`), in its order, each with the id an edge
 * here gave it, else a new one; then those edges use that it doesn't list. Null when it declares none.
 *
 * @param {Object} def - A super-module being folded: its template, children and the ports its edges expose.
 * @param {() => string} nextId
 * @returns {Array<{id: string, alias: Object, child: string, dir: string, label?: string}>|null}
 */
function declaredInterface(def, nextId) {
  const declared = def.template[PHLYNX_INTERFACE_KEY]
  if (!Array.isArray(declared)) return null
  const used = new Map([...def.exposed.values()].map((entry) => [`${entry.child}\0${aliasKey(entry.alias)}`, entry]))
  const leaves = new Set(def.rep.children.filter((child) => !child.occurrence).map((child) => child.name))
  const listed = declared
    .filter((port) => leaves.has(port?.submodule) && typeof port.port_type === 'string' && DIRECTION_OF[port.ports])
    .map((port) => {
      const alias = { portType: port.ports, label: port.port_type, slot: Number.isInteger(port.slot) ? port.slot : 0 }
      const key = `${port.submodule}\0${aliasKey(alias)}`
      const edge = used.get(key)
      used.delete(key)
      const label = typeof port.name === 'string' && port.name !== alias.label ? port.name : undefined
      return { id: edge?.id ?? nextId(), alias, child: port.submodule, dir: edge?.dir ?? DIRECTION_OF[alias.portType], ...(label && { label }) }
    })
  return [...listed, ...used.values()]
}

/**
 * Places a super-module's children and interface where its config's `phlynx_layout` has them.
 *
 * @param {Object} def
 * @param {Map<string, Object>} nodeById - Changed in place.
 * @returns {boolean} Whether it placed every one of them.
 */
function placeAsDeclared(def, nodeById) {
  const layout = def.template[PHLYNX_LAYOUT_KEY]
  const isPoint = (point) => Number.isFinite(point?.x) && Number.isFinite(point?.y)
  if (!layout || !isPoint(layout.interface)) return false
  const children = [...def.childIds]
  if (!children.every(([name]) => isPoint(layout.submodules?.[name]))) return false
  nodeById.get(def.smId).position = { x: layout.interface.x, y: layout.interface.y }
  for (const [name, id] of children) nodeById.get(id).position = { x: layout.submodules[name].x, y: layout.submodules[name].y }
  return true
}

/**
 * Imports a module array with super-modules: built flat as CA builds it, then folded (see buildCaModel, foldCaModel).
 *
 * @param {Object[]} rows
 * @param {CaLibrary} library
 * @param {Object} [options] - As buildCaModel's and foldCaModel's.
 * @returns {{nodes: Array, edges: Array, globals: Array, conflicts: string[], skipped: Array, warnings: string[],
 *   supermodules: Array}}
 */
export function importCaModuleArray(rows, library, options = {}) {
  const model = buildCaModel(rows, library, options)
  const folded = foldCaModel(model, library, options)
  return {
    ...folded,
    globals: model.globals,
    conflicts: model.conflicts,
    skipped: model.skipped,
    warnings: [...model.warnings, ...folded.warnings],
  }
}
