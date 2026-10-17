/**
 * Expands nested super instances into the flat model every model consumer reads. Pure.
 *
 * Each super instance is replaced, where it stands, by its super-module's children in submoduleOrder, recursively. A
 * leaf's model id is the local ids along its path joined with '/' (`dndnode_12/dndnode_4`); its name is its flat name
 * (see names.js). Root modules and their edges pass through untouched, so a model with no super instances expands to
 * itself.
 *
 * A coupling to a super instance's port is rewritten to the live port of the child that port aliases, following `via`
 * through nested super instances, with that child's slot. A super-module's exposed ports are read from its exposure edges
 * (see exposure.js), which are otherwise never part of the model. Couplings are never recomputed, so pairings and slots chosen by
 * hand survive. Each edge to a super instance becomes one edge per pair of modules it couples, `<edge id>#<k>`.
 *
 * A nested leaf's rows take its super instances' overrides, outermost winning, then its super-module's local constants
 * (see localConstants.js).
 *
 * Nested leaves and rewritten edges carry their model fields only (id, type, ends, handles, data), never canvas state
 * such as positions, so moving a node inside a super-module leaves the expansion as it was.
 *
 * Problems are reported in `errors`, never dropped silently: each error is
 * `{ kind, severity, message, ids: string[], origins: Array<{mainId, instanceChain, edgeId?}> }`, its ids expanded
 * ids where there are any and its origins where in the store the problem is. severity is 'error' for what the model
 * can't be built or exported right with, and 'warning' for what today's flat export already tolerates (a CA parameter
 * name given twice, an override that sets nothing, a root module's name or single-connection slot given twice), so
 * flat models that export today aren't blocked. The checks of the expanded model (checkExpansion) run when `errors` is
 * first read, so a caller that only reads the model doesn't pay for them.
 */
import { isEmpty } from '../../utils/variables'
import { checkAndClaimCouplings, slotOf } from '../../utils/edges'
import {
  edgeScopeProblem,
  indexByScope,
  isModelEdge,
  isSuperInstance,
  isSupermoduleInterface,
  localIdOf,
  MAX_NESTING_DEPTH,
  scopeOf,
  supermodulesById,
} from '../../utils/hierarchy'
import { resolveBoundaryValues } from '../export/boundaryValues'
import { indexExposures } from './exposure'
import { declarationProblems, emittedLocalConstantName, isLocalConstantRow, localConstantsOf, localConstantValue } from './localConstants'
import { LEVEL_SEPARATOR, pathOfNames, SELF_ROLE } from './names'

export { superInstancePorts } from './exposure'

/** Joins the local ids of an expanded model id. */
export const EXPANDED_ID_SEPARATOR = '/'
/** Separates an edge's id from the index of the module pair it couples, for an edge to a super instance. */
export const EDGE_PART_SEPARATOR = '#'
/**
 * The override key of local constant values (see localConstants.js): `@` for the instance's own super-module's, `<localId path>/@` for
 * those of a super instance below it.
 */
export const LOCAL_CONSTANTS_KEY = '@'

/** @returns {boolean} Whether an override key holds local constant values (see LOCAL_CONSTANTS_KEY). */
export const isLocalConstantsKey = (key) => key.split(EXPANDED_ID_SEPARATOR).at(-1) === LOCAL_CONSTANTS_KEY

/** @returns {boolean} Whether an expanded id is a module's inside a super instance: a root module's id has no '/'. */
export const isNestedModelId = (id) => typeof id === 'string' && id.includes(EXPANDED_ID_SEPARATOR)

// The port types through which a module receives from (inputs), or gives to (outputs), its neighbours.
const INPUT_TYPES = new Set(['entrance_ports', 'general_ports'])
const OUTPUT_TYPES = new Set(['exit_ports', 'general_ports'])

/**
 * The context a scope is expanded in: the super instances from the root down to it.
 *
 * @typedef {Object} Context
 * @property {Array} chain - The super instance nodes, outermost first.
 * @property {string[]} idPath - Their local ids.
 * @property {string[]} namePath - Their names.
 * @property {string|null} flatName - The innermost super instance's flat name.
 * @property {Object|null} supermodule - The innermost super instance's super-module (its interface node).
 */
const ROOT_CONTEXT = { chain: [], idPath: [], namePath: [], flatName: null, supermodule: null }

/**
 * Expands the store's nodes and edges into the flat model.
 *
 * @param {Array} nodes - Every node in the store.
 * @param {Array} edges - Every edge in the store.
 * @returns {{ nodes: Array, edges: Array, origin: Map<string, {mainId: string, instanceChain: string[], edgeId?: string}>,
 *   nameOf: (id: string) => string|undefined, idOf: (name: string) => string|undefined,
 *   pathOf: (id: string) => string|undefined, errors: Array<Object> }}
 *   origin: each expanded node's and edge's source in the store, with the super instances it is expanded through; nameOf:
 *   an expanded node's flat name; idOf: the expanded node of a flat name or path; pathOf: an expanded node's path.
 */
export function expandHierarchy(nodes, edges) {
  const byScope = indexByScope(nodes)
  const supermodules = supermodulesById(nodes)
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  // Each super-module's exposed ports, from its exposure edges.
  const exposures = indexExposures(nodes, edges)
  const exposedPortsOf = (smId) => exposures.get(smId) ?? []

  const outNodes = []
  const edgeEntries = [] // { edge, depth }, in a parent-first order the CA rule then refines (see orderEdges)
  const origin = new Map()
  const names = new Map()
  const paths = new Map()
  const errors = []
  const usedOverrides = new Set() // `instanceId\0key\0variable`
  const instanceChains = new Map() // each expanded super instance's id to the instance chain of each place it expands in
  const fail = (kind, message, origins = [], { ids = [], severity = 'error' } = {}) =>
    errors.push({ kind, severity, message, ids, origins })
  // Local constants: the global constants' names they can't take, and each problem reported once.
  const globalNames = new Set(nodes.flatMap((node) => (node.data?.variables ?? []).filter((row) => row.type === 'global_constant').map((row) => row.name)))
  const reported = new Set()
  const failOnce = (key, ...args) => !reported.has(key) && reported.add(key) && fail(...args)

  const edgesByScope = new Map()
  for (const edge of edges) {
    if (!isModelEdge(edge)) continue
    const problem = edgeScopeProblem(edge, nodeById)
    if (problem) {
      fail('crossScopeEdge', problem, [{ mainId: edge.id, instanceChain: [], edgeId: edge.id }])
      continue
    }
    const scope = scopeOf(nodeById.get(edge.source) ?? nodeById.get(edge.target))
    if (!edgesByScope.has(scope)) edgesByScope.set(scope, [])
    edgesByScope.get(scope).push(edge)
  }

  // Each scope's children in expansion order, submoduleOrder first and then any it doesn't list, and by local id.
  const children = new Map()
  const childrenIn = (scope) => {
    if (children.has(scope)) return children.get(scope)
    const members = (byScope.get(scope) ?? []).filter((node) => !isSupermoduleInterface(node))
    const byLocalId = new Map(members.map((node) => [localIdOf(node), node]))
    const order = scope ? (supermodules.get(scope)?.data?.supermodule?.submoduleOrder ?? []) : []
    const listed = order.map((localId) => byLocalId.get(localId)).filter(Boolean)
    children.set(scope, { ordered: [...new Set([...listed, ...members])], byLocalId })
    return children.get(scope)
  }
  const childrenOf = (scope) => childrenIn(scope).ordered
  const childByLocalId = (scope, localId) => childrenIn(scope).byLocalId.get(localId)

  const expandedIdIn = (context, node) =>
    context.chain.length ? [...context.idPath, localIdOf(node)].join(EXPANDED_ID_SEPARATOR) : node.id
  const flatNameIn = (context, node) => {
    if (!context.supermodule) return node.data?.name
    if (context.supermodule.data.supermodule.naming === 'preserve') return node.data?.originalName ?? node.data?.name
    if (node.data?.role === SELF_ROLE) return context.flatName
    return `${context.flatName}${LEVEL_SEPARATOR}${node.data?.name}`
  }
  const chainIds = (context) => context.chain.map((instance) => instance.id)
  const originOf = (context, mainId, edgeId) => ({ mainId, instanceChain: chainIds(context), ...(edgeId && { edgeId }) })

  /**
   * Gets the context a super instance's children are expanded in, or null, with an error, when it can't be expanded.
   */
  const enter = (context, instance) => {
    const supermodule = supermodules.get(instance.data?.smId)
    const where = [originOf(context, instance.id)]
    if (!supermodule) {
      fail('missingSupermodule', `Super instance "${pathOfNames([...context.namePath, instance.data?.name])}" has no super-module "${instance.data?.smId}".`, where)
      return null
    }
    if (context.chain.some((outer) => outer.data.smId === supermodule.id)) {
      const cycle = [...context.chain.map((outer) => outer.data.smId), supermodule.id].join(' → ')
      fail('cycle', `Super-module "${supermodule.data.supermodule.name}" contains itself: ${cycle}.`, where)
      return null
    }
    if (context.chain.length >= MAX_NESTING_DEPTH) {
      fail('depth', `Super instances nest deeper than ${MAX_NESTING_DEPTH} levels.`, where)
      return null
    }
    for (const problem of declarationProblems(localConstantsOf(supermodule), globalNames)) {
      failOnce(`${supermodule.id}\0${problem}`, 'localConstantDeclaration', `Super-module "${supermodule.data.supermodule.name}" ${problem}.`, where)
    }
    return {
      chain: [...context.chain, instance],
      idPath: [...context.idPath, localIdOf(instance)],
      namePath: [...context.namePath, instance.data.name],
      flatName: flatNameIn(context, instance),
      supermodule,
    }
  }
  // Each super instance's context, keyed by its expanded id, once entered.
  const contexts = new Map()
  const contextOf = (context, instance) => {
    const key = expandedIdIn(context, instance)
    if (!contexts.has(key)) contexts.set(key, enter(context, instance))
    return contexts.get(key)
  }

  /** Applies the super instances' overrides to a leaf's rows, innermost first, so the outermost wins. */
  const applyOverrides = (context, leaf) => {
    let variables = leaf.data.variables
    for (let level = context.chain.length - 1; level >= 0; level--) {
      const instance = context.chain[level]
      const key = [...context.idPath.slice(level + 1), localIdOf(leaf)].join(EXPANDED_ID_SEPARATOR)
      const patches = instance.data.overrides?.[key]
      if (!patches) continue
      const rows = new Set((variables ?? []).map((row) => row.name))
      for (const name of Object.keys(patches)) if (rows.has(name)) usedOverrides.add(`${instance.id}\0${key}\0${name}`)
      variables = (variables ?? []).map((row) => (patches[row.name] ? { ...row, ...patches[row.name] } : row))
    }
    return bindLocalConstants(variables, context, leaf)
  }

  /**
   * Binds a leaf's local constant rows, after the overrides: each takes its super-module's constant of that name, as
   * the context's super instances override it (see localConstantValue), with `localConstant: {owner, units}`.
   */
  const bindLocalConstants = (variables, context, leaf) => {
    if (!(variables ?? []).some(isLocalConstantRow)) return variables
    const declarations = new Map(localConstantsOf(context.supermodule).map((declaration) => [declaration.name, declaration]))
    const where = () => [originOf(context, leaf.id)]
    const at = { ids: [expandedIdIn(context, leaf)] }
    const path = () => pathOfNames([...context.namePath, leaf.data?.name])
    return variables.map((row) => {
      if (!isLocalConstantRow(row)) return row
      const declaration = declarations.get(row.name)
      if (!declaration) {
        const message = `"${path()}" variable "${row.name}" is a local constant, but super-module "${context.supermodule.data.supermodule.name}" declares none of that name.`
        fail('unknownLocalConstant', message, where(), at)
        return row
      }
      if (row.units && declaration.units && row.units !== declaration.units) {
        const message = `"${path()}" variable "${row.name}" is in ${row.units}, but local constant "${row.name}" of "${context.supermodule.data.supermodule.name}" is in ${declaration.units}.`
        fail('localConstantUnits', message, where(), at)
      }
      const value = localConstantValue(context.chain, context.idPath, row.name, declaration.value)
      return { ...row, value, localConstant: { owner: context.flatName, units: declaration.units || row.units } }
    })
  }

  const emitLeaf = (context, leaf) => {
    const id = expandedIdIn(context, leaf)
    if (!context.chain.length) {
      outNodes.push(leaf)
      for (const row of (leaf.data?.variables ?? []).filter(isLocalConstantRow)) {
        fail('unknownLocalConstant', `"${leaf.data?.name}" variable "${row.name}" is a local constant, but "${leaf.data?.name}" is in no super-module.`, [originOf(context, leaf.id)], { ids: [leaf.id] })
      }
    } else {
      const { scope: _scope, localId: _localId, ...data } = leaf.data ?? {}
      outNodes.push({ id, type: leaf.type, data: { ...data, name: flatNameIn(context, leaf), variables: applyOverrides(context, leaf) } })
    }
    origin.set(id, originOf(context, leaf.id))
    names.set(id, flatNameIn(context, leaf))
    paths.set(id, pathOfNames([...context.namePath, leaf.data?.name]))
  }

  const expandNodes = (scope, context) => {
    for (const child of childrenOf(scope)) {
      if (!isSuperInstance(child)) {
        emitLeaf(context, child)
        continue
      }
      const inner = contextOf(context, child)
      if (!inner) continue
      if (!instanceChains.has(child.id)) instanceChains.set(child.id, [])
      instanceChains.get(child.id).push(chainIds(context))
      expandNodes(inner.supermodule.id, inner)
    }
  }

  /**
   * Gets the port type an exposed port of a super-module aliases, through `via`, so a via alias's own portType is
   * never read.
   */
  const aliasedPortType = (smId, exposed, depth = 0) => {
    const child = childByLocalId(smId, exposed?.alias?.child)
    if (!isSuperInstance(child)) return exposed?.alias?.portType
    const inner = exposedPortsOf(child.data?.smId).find((port) => port.id === exposed.alias.via)
    return depth < MAX_NESTING_DEPTH ? aliasedPortType(child.data.smId, inner, depth + 1) : undefined
  }

  /** Where a super instance port's child sits in CA's host lists: its first exposed port facing that way. */
  const spliceIndex = (smId, child, side) => {
    const types = side === 'target' ? INPUT_TYPES : OUTPUT_TYPES
    const index = exposedPortsOf(smId).findIndex((port) => port.alias?.child === child && types.has(aliasedPortType(smId, port)))
    return index < 0 ? Infinity : index
  }

  /**
   * Resolves an exposed port of a super instance to the module port it aliases, through `via`.
   *
   * @returns {{ id: string, port: Object, slot: number, splice: number[] }|null}
   */
  const resolveExposed = (context, instance, exposedPortId, side, edge) => {
    const path = pathOfNames([...context.namePath, instance.data?.name])
    const unresolved = (reason) => {
      const broken = (instance.data?.broken ?? []).includes(exposedPortId)
      fail(broken ? 'brokenCoupling' : 'unresolvedAlias', `Edge "${edge.id}" couples to port "${exposedPortId}" of "${path}", which ${reason}.`, [
        originOf(context, edge.id, edge.id),
        originOf(context, instance.id),
      ])
      return null
    }
    const inner = contextOf(context, instance)
    if (!inner) return unresolved('can not be expanded')
    const exposed = exposedPortsOf(inner.supermodule.id).find((port) => port.id === exposedPortId)
    if (!exposed) return unresolved('its super-module no longer exposes')
    const child = childByLocalId(inner.supermodule.id, exposed.alias?.child)
    if (!child) return unresolved(`aliases a missing child "${exposed.alias?.child}"`)
    const splice = spliceIndex(inner.supermodule.id, exposed.alias.child, side)
    if (isSuperInstance(child)) {
      if (!exposed.alias.via) return unresolved(`aliases super instance "${child.data.name}" without naming its port`)
      const resolved = resolveExposed(inner, child, exposed.alias.via, side, edge)
      return resolved && { ...resolved, splice: [splice, ...resolved.splice] }
    }
    const slot = exposed.alias.slot ?? 0
    const group = (child.data?.ports ?? []).filter((port) => port.portType === exposed.alias.portType && port.label === exposed.alias.label)
    if (!group[slot]) return unresolved(`aliases a missing port "${exposed.alias.label}" (slot ${slot}) of "${child.data?.name}"`)
    return { id: expandedIdIn(inner, child), port: group[slot], slot, splice: [splice] }
  }

  const expandEdge = (context, edge) => {
    const source = nodeById.get(edge.source)
    const target = nodeById.get(edge.target)
    const depth = context.chain.length
    const id = depth ? [...context.idPath, edge.id].join(EXPANDED_ID_SEPARATOR) : edge.id
    const expandedEnd = (node, fallback) => (node ? expandedIdIn(context, node) : fallback)

    if (!isSuperInstance(source) && !isSuperInstance(target)) {
      const flat = depth
        ? modelEdgeOf(edge, { id, source: expandedEnd(source, edge.source), target: expandedEnd(target, edge.target) })
        : edge
      edgeEntries.push({ edge: flat, depth })
      origin.set(id, originOf(context, edge.id, edge.id))
      return
    }

    const resolveEnd = (node, port, side) => {
      if (!isSuperInstance(node)) return { id: expandedEnd(node, edge[side]), splice: [] }
      if (!port?.exposedPortId) {
        fail('unresolvedAlias', `Edge "${edge.id}" couples to a port of "${node.data?.name}" that is not an exposed port.`, [
          originOf(context, edge.id, edge.id),
        ])
        return null
      }
      return resolveExposed(context, node, port.exposedPortId, side, edge)
    }

    if (!edge.data?.couplings?.length) {
      const ends = [source, target].filter(isSuperInstance).map((node) => `"${pathOfNames([...context.namePath, node.data?.name])}"`)
      fail('emptyBoundaryEdge', `Edge "${edge.id}" to ${ends.join(' and ')} couples no exposed port, so it can't be expanded.`, [
        originOf(context, edge.id, edge.id),
      ])
      return
    }

    const pairs = new Map()
    for (const coupling of edge.data.couplings) {
      const from = resolveEnd(source, coupling.sourcePort, 'source')
      const to = resolveEnd(target, coupling.targetPort, 'target')
      if (!from || !to) continue
      const key = `${from.id}\0${to.id}`
      if (!pairs.has(key)) pairs.set(key, { from, to, couplings: [] })
      pairs.get(key).couplings.push({
        ...coupling,
        ...(from.port && { sourcePort: from.port, sourceSlot: from.slot }),
        ...(to.port && { targetPort: to.port, targetSlot: to.slot }),
      })
    }
    const ordered = [...pairs.values()].sort((a, b) => compareSplices(a.from.splice, b.from.splice) || compareSplices(a.to.splice, b.to.splice))
    ordered.forEach(({ from, to, couplings }, k) => {
      const partId = `${id}${EDGE_PART_SEPARATOR}${k}`
      edgeEntries.push({
        edge: modelEdgeOf(edge, {
          id: partId,
          source: from.id,
          target: to.id,
          // A super instance's handle is not its child's.
          sourceHandle: isSuperInstance(source) ? undefined : edge.sourceHandle,
          targetHandle: isSuperInstance(target) ? undefined : edge.targetHandle,
          data: { ...edge.data, couplings },
        }),
        depth,
      })
      origin.set(partId, originOf(context, edge.id, edge.id))
    })
  }

  const expandEdges = (scope, context) => {
    for (const edge of edgesByScope.get(scope) ?? []) expandEdge(context, edge)
    for (const child of childrenOf(scope)) {
      if (!isSuperInstance(child)) continue
      const inner = contextOf(context, child)
      if (inner) expandEdges(inner.supermodule.id, inner)
    }
  }

  expandNodes(null, ROOT_CONTEXT)
  expandEdges(null, ROOT_CONTEXT)
  const outEdges = instanceChains.size ? orderEdges(edgeEntries) : edgeEntries.map((entry) => entry.edge)

  reportOrphanedOverrides(nodes, instanceChains, usedOverrides, fail, supermodules, childByLocalId)

  const idByName = new Map()
  for (const [id, path] of paths) if (!idByName.has(path)) idByName.set(path, id)
  for (const [id, name] of names) idByName.set(name, id)
  const nameOf = (id) => names.get(id)
  const pathOf = (id) => paths.get(id)
  const idOf = (name) => idByName.get(name)

  const at = (ids) => ({ ids, origins: ids.map((id) => origin.get(id)).filter(Boolean) })
  let checked = null

  return {
    nodes: outNodes,
    edges: outEdges,
    origin,
    nameOf,
    idOf,
    pathOf,
    get errors() {
      checked ??= [...errors, ...checkExpansion(outNodes, outEdges, pathOf).map((error) => ({ ...error, ...at(error.ids) }))]
      return checked
    },
  }
}

/**
 * Builds an expanded edge from an edge's model fields only, so no canvas state reaches the model.
 *
 * @param {Object} edge - The store's edge.
 * @param {{id: string, source: string, target: string, sourceHandle?: string, targetHandle?: string, data?: Object}}
 *   fields - The expanded edge's; handles and data are the edge's unless given, an undefined handle leaving it out.
 * @returns {Object}
 */
function modelEdgeOf(edge, fields) {
  const { id, source, target, sourceHandle, targetHandle, data } = {
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    data: edge.data,
    ...fields,
  }
  return {
    id,
    ...(edge.type !== undefined && { type: edge.type }),
    source,
    target,
    ...(sourceHandle !== undefined && { sourceHandle }),
    ...(targetHandle !== undefined && { targetHandle }),
    ...(data !== undefined && { data }),
  }
}

/**
 * Compares two splice keys (see spliceIndex) level by level.
 *
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
function compareSplices(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? -1
    const y = b[i] ?? -1
    if (x !== y) return x === Infinity ? 1 : y === Infinity ? -1 : x - y
  }
  return 0
}

/**
 * Orders the expanded edges as circulatory_autogen splices a super-module: on each module's inputs, edges from outer
 * levels before its siblings'; on its outputs, after them. Otherwise the given order is kept. Where those orders
 * contradict each other (an edge from a super instance to itself), the given order breaks the tie.
 *
 * This is the edges' order only. orderCaLists keeps it for each row's out_instances, which CA wires by, but lists
 * inp_instances by row, as for a flat model, so a host row after the super instance is listed after its siblings there.
 * CA reads a module's inp_instances for its connections only at a heart, whose inputs orderCaLists orders by slot.
 *
 * @param {Array<{edge: Object, depth: number}>} entries - depth: how many super instances deep the edge was drawn.
 * @returns {Array} The edges.
 */
function orderEdges(entries) {
  const after = entries.map(() => [])
  const waiting = entries.map(() => 0)
  const chain = (indexes, compare) => {
    const sorted = [...indexes].sort(compare)
    for (let k = 1; k < sorted.length; k++) {
      after[sorted[k - 1]].push(sorted[k])
      waiting[sorted[k]]++
    }
  }
  const groupBy = (key) => {
    const groups = new Map()
    entries.forEach(({ edge }, index) => {
      if (!groups.has(edge[key])) groups.set(edge[key], [])
      groups.get(edge[key]).push(index)
    })
    return groups.values()
  }
  const depth = (index) => entries[index].depth
  for (const inputs of groupBy('target')) chain(inputs, (a, b) => depth(a) - depth(b) || a - b)
  for (const outputs of groupBy('source')) chain(outputs, (a, b) => depth(b) - depth(a) || a - b)

  const done = entries.map(() => false)
  const ready = new MinHeap()
  entries.forEach((_, index) => waiting[index] === 0 && ready.push(index))
  const ordered = []
  while (ordered.length < entries.length) {
    let index = ready.pop()
    if (index === undefined) index = done.findIndex((isDone) => !isDone)
    done[index] = true
    ordered.push(entries[index].edge)
    for (const next of after[index]) if (--waiting[next] === 0 && !done[next]) ready.push(next)
  }
  return ordered
}

/** A binary min-heap of numbers. */
class MinHeap {
  items = []

  push(value) {
    const items = this.items
    items.push(value)
    let i = items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (items[parent] <= items[i]) break
      ;[items[parent], items[i]] = [items[i], items[parent]]
      i = parent
    }
  }

  pop() {
    const items = this.items
    if (!items.length) return undefined
    const top = items[0]
    const last = items.pop()
    if (items.length) {
      items[0] = last
      let i = 0
      for (;;) {
        const left = 2 * i + 1
        const right = left + 1
        let smallest = i
        if (left < items.length && items[left] < items[smallest]) smallest = left
        if (right < items.length && items[right] < items[smallest]) smallest = right
        if (smallest === i) break
        ;[items[smallest], items[i]] = [items[i], items[smallest]]
        i = smallest
      }
    }
    return top
  }
}

/**
 * Reports the overrides of expanded super instances that set nothing: their path, variable or local constant is gone. A
 * super instance expanded in several places, inside a super-module used more than once, holds one override for them
 * all, so it is reported once, with an origin for each place.
 *
 * @param {Array} nodes
 * @param {Map<string, string[][]>} instanceChains - Each expanded super instance's id to the instance chain of each place.
 * @param {Set<string>} usedOverrides
 * @param {Function} fail
 * @param {Map<string, Object>} supermodules - By id.
 * @param {(scope: string, localId: string) => Object|undefined} childByLocalId
 */
function reportOrphanedOverrides(nodes, instanceChains, usedOverrides, fail, supermodules, childByLocalId) {
  // The local constants a local constant key sets: those of the super-module its path reaches.
  const declaredAt = (node, key) => {
    let smId = node.data.smId
    for (const localId of key.split(EXPANDED_ID_SEPARATOR).slice(0, -1)) {
      const child = childByLocalId(smId, localId)
      if (!isSuperInstance(child)) return new Set()
      smId = child.data.smId
    }
    return new Set(localConstantsOf(supermodules.get(smId)).map((declaration) => declaration.name))
  }
  for (const node of nodes) {
    if (!instanceChains.has(node.id)) continue
    const origins = instanceChains.get(node.id).map((instanceChain) => ({ mainId: node.id, instanceChain }))
    for (const [key, patches] of Object.entries(node.data.overrides ?? {})) {
      const declared = isLocalConstantsKey(key) ? declaredAt(node, key) : null
      for (const name of Object.keys(patches ?? {})) {
        if (declared ? declared.has(name) : usedOverrides.has(`${node.id}\0${key}\0${name}`)) continue
        const message = declared
          ? `Super instance "${node.data.name}" sets "${key}" local constant "${name}", which no longer exists.`
          : `Super instance "${node.data.name}" sets "${key}" variable "${name}", which no longer exists.`
        fail('orphanedOverride', message, origins, { severity: 'warning' })
      }
    }
  }
}

/**
 * Checks the expanded model for what export would reject or silently get wrong: flat names or emitted parameter
 * names given twice, single-connection ports with more than one connection, and variables summed through several
 * ports. A problem among root modules only, which today's flat export already lets through, is a warning, save a
 * variable summed through several ports, which export refuses; a CA parameter name given twice is always a warning,
 * as CA's `<variable>_<module>` names are.
 *
 * @param {Array} nodes - Expanded nodes.
 * @param {Array} edges - Expanded edges.
 * @param {Function} pathOf
 * @returns {Array<{kind: string, severity: 'error'|'warning', message: string, ids: string[]}>}
 */
export function checkExpansion(nodes, edges, pathOf = (id) => id) {
  const nameOf = (id) => pathOf(id) ?? id
  const errors = []
  const severityOf = (ids) => (ids.some((id) => id.includes(EXPANDED_ID_SEPARATOR)) ? 'error' : 'warning')

  const byName = groupIds(nodes.map((node) => [node.data?.name, node.id]))
  for (const [name, ids] of byName) {
    if (ids.length < 2) continue
    errors.push({ kind: 'flatNameClash', severity: severityOf(ids), message: `${listPaths(ids, nameOf)} all have the flat name "${name}".`, ids })
  }

  for (const [convention, emitted] of [
    ['cellml', cellmlParameterNames(nodes, edges)],
    ['ca', caParameterNames(nodes)],
  ]) {
    for (const [name, sources] of groupIds(emitted)) {
      const distinct = [...new Map(sources.map((source) => [source.group ?? `${source.id}\0${source.variable}`, source])).values()]
      if (distinct.length < 2) continue
      const what = distinct.map(({ id, variable }) => `"${nameOf(id)}" variable "${variable}"`).join(' and ')
      const where = convention === 'cellml' ? 'the CellML export' : 'the circulatory_autogen parameters'
      const ids = [...new Set(distinct.map(({ id }) => id))]
      errors.push({
        kind: 'parameterNameClash',
        convention,
        severity: convention === 'cellml' ? severityOf(ids) : 'warning',
        message: `${what} are both named "${name}" in ${where}.`,
        ids,
      })
    }
  }

  // Each single-connection slot may be claimed once, in edge order.
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const portsOf = (id) => nodeById.get(id)?.data?.ports ?? []
  const claimed = new Set()
  for (const edge of edges) {
    const couplings = (edge.data?.couplings ?? []).map((coupling) => ({
      ...coupling,
      sourceSlot: slotOf(portsOf(edge.source), coupling.sourcePort, coupling.sourceSlot),
      targetSlot: slotOf(portsOf(edge.target), coupling.targetPort, coupling.targetSlot),
    }))
    const { valid, conflicts } = checkAndClaimCouplings(edge.source, edge.target, couplings, claimed, nameOf)
    if (valid) continue
    const ids = [edge.id, edge.source, edge.target]
    errors.push({ kind: 'overSubscribed', severity: severityOf(ids), message: conflicts.join(' '), ids })
  }

  return errors
}

/**
 * Lists the parameter names the flat CellML export gives instance constants (see generateFlattenedModel): a
 * constant's own name, or `<module>_<variable>` when several modules set one of that name; a local constant's
 * `<name>_<super instance>`, once for all its rows (their group).
 *
 * @param {Array} nodes
 * @param {Array} edges
 * @returns {Array<[string, {id: string, variable: string, group?: string}]>}
 */
function cellmlParameterNames(nodes, edges) {
  let values = null
  try {
    values = resolveBoundaryValues(nodes, edges)
  } catch {
    // A malformed port; export reports it.
  }
  const isSet = (id, row) =>
    (row.type === 'constant' && !values?.ignored.get(id)?.has(row.name)) ||
    (row.type === 'boundary_condition' && !!values?.supplied.get(id)?.has(row.name))
  const rows = nodes.flatMap((node) =>
    (node.data?.variables ?? []).filter((row) => isSet(node.id, row) && !isEmpty(row.value)).map((row) => ({ node, row }))
  )
  const counts = new Map()
  for (const { row } of rows) counts.set(row.name, (counts.get(row.name) ?? 0) + 1)
  const locals = nodes.flatMap((node) =>
    (node.data?.variables ?? [])
      .filter((row) => row.localConstant && !values?.ignored.get(node.id)?.has(row.name))
      .map((row) => {
        const name = emittedLocalConstantName(row.name, row.localConstant.owner)
        return [name, { id: node.id, variable: row.name, group: `local\0${name}` }]
      })
  )
  return [
    ...rows.map(({ node, row }) => [counts.get(row.name) > 1 ? `${node.data.name}_${row.name}` : row.name, { id: node.id, variable: row.name }]),
    ...locals,
  ]
}

/**
 * Lists the parameter names the circulatory_autogen export gives: `<variable>_<module>` for constants, local constants
 * and boundary conditions, and a global constant's own name.
 *
 * @param {Array} nodes
 * @returns {Array<[string, {id: string, variable: string}]>}
 */
function caParameterNames(nodes) {
  const globals = new Map()
  const rows = []
  for (const node of nodes) {
    for (const row of node.data?.variables ?? []) {
      if (row.type === 'constant' || row.type === 'boundary_condition' || isLocalConstantRow(row)) {
        rows.push([`${row.name}_${node.data.name}`, { id: node.id, variable: row.name }])
      } else if (row.type === 'global_constant' && !globals.has(row.name)) {
        // One row however many modules use it.
        globals.set(row.name, [row.name, { id: node.id, variable: row.name }])
      }
    }
  }
  return [...rows, ...globals.values()]
}

/**
 * Groups values by key.
 *
 * @param {Array<[*, *]>} pairs
 * @returns {Map<*, Array>}
 */
function groupIds(pairs) {
  const groups = new Map()
  for (const [key, value] of pairs) {
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(value)
  }
  return groups
}

/** @returns {string} The modules' paths, quoted and joined. */
const listPaths = (ids, nameOf) => ids.map((id) => `"${nameOf(id)}"`).join(', ')
