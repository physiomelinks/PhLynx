/**
 * Imports a CellML model's encapsulation as super-modules (#364): the model is hoisted and built flat as before
 * (hoistEncapsulatedComponents, parseCellMLConnections, buildWorkflowGraph), then folded, deepest first, as caFold.js
 * folds a CA expansion. Pure.
 *
 * - Each encapsulating component P with anything built inside it becomes a super-module named after it, with naming
 *   'preserve' and one super instance where P was. Its children are P's own component as its self leaf (local id
 *   'self', role 'self'), when the build has it, and P's children, each named by its component; a child that
 *   encapsulates others is a super instance of its own. Every leaf keeps its component's name as its originalName, so
 *   the flat model is the hoisted one.
 * - An edge between two components inside P moves into P's super-module. One from inside P to outside becomes an
 *   exposure edge from the child inside to P's interface, exposing the ports it uses in the order the edges first use
 *   them, and an edge outside whose couplings name those exposed ports in the same slots.
 */
import { buildSuperInstance, buildSupermoduleInterface } from './buildWorkflow'
import { ghostUnusedHandles, sideHandles } from './caFold'
import { SELF_ROLE } from '../export/cellmlHierarchical'
import { aliasKey, EXPOSED_PORT_ID_PREFIX, superInstancePorts } from '../hierarchy/exposure'
import { slotOf } from '../../utils/edges'
import { EXPOSURE_EDGE_TYPE } from '../../utils/constants'
import { isSupermoduleInterface, localNameProblem, nextSequentialId, nodeIdOf, SUPERMODULE_ID_PREFIX } from '../../utils/hierarchy'

/** A self leaf's local id. */
export const SELF_LOCAL_ID = 'self'

const NODE_ID_PREFIX = 'dndnode_'
// Where an edge or exposure attaches: inputs on top, outputs below; an interface's on its sides.
const SIDE = { source: 'bottom', target: 'top' }
const INTERFACE_SIDE = { in: 'left', out: 'right' }

const clone = (value) => JSON.parse(JSON.stringify(value))

/**
 * Folds a CellML model's flat build into super-modules, one for each encapsulating component.
 *
 * @param {Array} nodes - The build's nodes (buildWorkflowGraph's pendingInstances), each named by its component.
 * @param {Array} edges - The build's edges.
 * @param {Map<string, string[]>} tree - Each encapsulating component's children (see readEncapsulation).
 * @param {Object} [options]
 * @param {string|null} [options.file=null] - The CellML file, kept as the super-modules' source.
 * @param {Array} [options.reserved=[]] - Nodes whose ids and super-module names are taken.
 * @param {string} [options.nextExposedPortId] - The first exposed port id free, `xp_0` by default.
 * @returns {{nodes: Array, edges: Array, warnings: string[], supermodules: Array<{smId: string, component: string}>}}
 *   Root nodes first, in build order; every node and edge with its scope's `hidden`. The build itself when nothing
 *   encapsulates anything built.
 */
export function foldEncapsulation(nodes, edges, tree, { file = null, reserved = [], nextExposedPortId } = {}) {
  const nodeByName = new Map(nodes.map((node) => [node.data?.name, node]))
  const parentOf = new Map()
  for (const [parent, children] of tree ?? []) for (const child of children) parentOf.set(child, parent)
  const contentMemo = new Map()
  const hasContent = (name) => {
    if (!contentMemo.has(name)) contentMemo.set(name, nodeByName.has(name) || (tree.get(name) ?? []).some(hasContent))
    return contentMemo.get(name)
  }
  const parents = [...(tree ?? new Map()).keys()].filter(hasContent)
  if (!parents.length) return { nodes, edges, warnings: [], supermodules: [] }

  // The super-modules a component's node is inside, outermost first: its ancestors', then its own as a self leaf.
  const scopesOf = (name) => {
    const chain = tree.has(name) ? [name] : []
    for (let parent = parentOf.get(name); parent; parent = parentOf.get(parent)) chain.unshift(parent)
    return chain
  }

  const taken = new Set([...reserved, ...nodes].map((node) => node.id))
  const smNames = new Set(reserved.filter(isSupermoduleInterface).map((node) => node.data?.supermodule?.name))
  const defs = new Map()
  for (const component of parents) {
    const smId = nextSequentialId(taken, SUPERMODULE_ID_PREFIX)
    taken.add(smId)
    let name = component
    for (let n = 2; smNames.has(name); n++) name = `${component}_${n}`
    smNames.add(name)
    defs.set(component, { smId, name, component, childIds: new Map(), exposed: new Map() })
  }

  // The nodes: each super-module's interface and children, the root's modules and super instances.
  const nodeById = new Map()
  const add = (list, node) => {
    list.push(node)
    nodeById.set(node.id, node)
    return node
  }
  const style = nodes[0]?.style
  const withStyle = (node) => (style ? { ...node, style: { ...style } } : node)
  const defNodes = []
  for (const def of defs.values()) {
    const { smId, component } = def
    const submoduleOrder = []
    const own = nodeByName.get(component)
    if (own) {
      const id = nodeIdOf(smId, SELF_LOCAL_ID)
      const from = clone(own)
      add(defNodes, { ...from, id, data: { ...from.data, scope: smId, localId: SELF_LOCAL_ID, name: SELF_LOCAL_ID, originalName: component, role: SELF_ROLE } })
      def.childIds.set(component, id)
      submoduleOrder.push(SELF_LOCAL_ID)
    }
    tree
      .get(component)
      .filter(hasContent)
      .forEach((child, i) => {
        const localId = `${NODE_ID_PREFIX}${i}`
        const id = nodeIdOf(smId, localId)
        submoduleOrder.push(localId)
        def.childIds.set(child, id)
        if (defs.has(child)) {
          const node = withStyle(buildSuperInstance(id, child, defs.get(child).smId, { scope: smId }))
          node.data.originalName = child
          add(defNodes, node)
        } else {
          const from = clone(nodeByName.get(child))
          add(defNodes, { ...from, id, data: { ...from.data, scope: smId, localId, name: child, originalName: child } })
        }
      })
    const source = { format: 'cellml', component, file }
    add(defNodes, buildSupermoduleInterface(smId, { name: def.name, submoduleOrder, naming: 'preserve', source }))
  }
  const rootNodes = []
  const rootIds = new Map()
  for (const node of nodes) {
    const [outermost] = scopesOf(node.data?.name)
    if (!outermost) {
      rootIds.set(node.data?.name, add(rootNodes, clone(node)).id)
      continue
    }
    if (rootIds.has(outermost)) continue
    const id = nextSequentialId(taken, NODE_ID_PREFIX)
    taken.add(id)
    rootIds.set(outermost, add(rootNodes, withStyle(buildSuperInstance(id, outermost, defs.get(outermost).smId))).id)
  }

  /** The node a component is reached through `depth` super-modules down: its own, or a super instance's. */
  const nodeAt = (name, depth) => {
    const chain = scopesOf(name)
    if (chain.length === depth) return depth ? defs.get(chain[depth - 1]).childIds.get(name) : rootIds.get(name)
    return depth ? defs.get(chain[depth - 1]).childIds.get(chain[depth]) : rootIds.get(chain[0])
  }

  // Exposed ports: each port an edge out of a super-module uses, through every level it leaves.
  let xp = Number((nextExposedPortId ?? `${EXPOSED_PORT_ID_PREFIX}0`).slice(EXPOSED_PORT_ID_PREFIX.length))
  let uses = 0
  const expose = (def, childId, alias, dir) => {
    const key = `${childId}\0${aliasKey(alias)}`
    if (!def.exposed.has(key)) def.exposed.set(key, { id: `${EXPOSED_PORT_ID_PREFIX}${xp++}`, alias, childId, dir, use: uses++ })
    return def.exposed.get(key).id
  }
  const nameOf = new Map(nodes.map((node) => [node.id, node.data?.name]))
  const portsOfBuilt = new Map(nodes.map((node) => [node.id, node.data?.ports ?? []]))
  const crossing = edges.map((edge) => {
    const names = { source: nameOf.get(edge.source), target: nameOf.get(edge.target) }
    const chains = { source: scopesOf(names.source), target: scopesOf(names.target) }
    let depth = 0
    while (depth < Math.min(chains.source.length, chains.target.length) && chains.source[depth] === chains.target[depth]) depth++
    const nested = { source: chains.source.length > depth, target: chains.target.length > depth }
    const via = (edge.data?.couplings ?? []).map((coupling) =>
      Object.fromEntries(
        ['source', 'target']
          .filter((side) => nested[side])
          .map((side) => {
            const chain = chains[side]
            const port = coupling[`${side}Port`]
            let alias = { portType: port.portType, label: port.label, slot: slotOf(portsOfBuilt.get(edge[side]), port, coupling[`${side}Slot`]) }
            for (let level = chain.length - 1; level >= depth; level--) {
              const def = defs.get(chain[level])
              const childId = level === chain.length - 1 ? def.childIds.get(names[side]) : def.childIds.get(chain[level + 1])
              alias = { via: expose(def, childId, alias, side === 'target' ? 'in' : 'out') }
            }
            return [side, alias.via]
          })
      )
    )
    return { edge, depth, scope: depth ? defs.get(chains.source[depth - 1]).smId : null, nested, via, names }
  })

  const sides = new Map()
  const handleOf = (id, side) => {
    if (!sides.has(id)) sides.set(id, sideHandles(nodeById.get(id)))
    return sides.get(id)(side)
  }

  // Exposure edges, one per child exposing anything, its ports in the order edges first use them.
  const exposureEdges = []
  for (const def of defs.values()) {
    const byChild = new Map()
    ;[...def.exposed.values()]
      .sort((a, b) => a.use - b.use)
      .forEach((entry, order) => {
        if (!byChild.has(entry.childId)) byChild.set(entry.childId, [])
        byChild.get(entry.childId).push({ id: entry.id, alias: entry.alias, order, dir: entry.dir })
      })
    for (const [childId, entries] of byChild) {
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
  for (const node of allNodes) {
    if (node.data?.smId) node.data.ports = superInstancePorts(allNodes, exposureEdges, node.data.smId)
  }

  // The model edges, each in the innermost scope holding both its ends, one per pair of nodes and direction.
  const merged = new Map()
  const edgeIds = new Set()
  for (const { edge, depth, scope, nested, via, names } of crossing) {
    const source = nodeAt(names.source, depth)
    const target = nodeAt(names.target, depth)
    const key = `${scope}\0${source}\0${target}`
    if (!merged.has(key)) {
      let id = `${source}--${target}`
      for (let n = 2; edgeIds.has(id); n++) id = `${source}--${target}--${n}`
      edgeIds.add(id)
      merged.set(key, {
        ...clone(edge),
        id,
        source,
        target,
        sourceHandle: nested.source ? handleOf(source, SIDE.source) : edge.sourceHandle,
        targetHandle: nested.target ? handleOf(target, SIDE.target) : edge.targetHandle,
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

  const outEdges = [...merged.values(), ...exposureEdges]
  ghostUnusedHandles(allNodes, outEdges)

  const problems = allNodes
    .filter((node) => !isSupermoduleInterface(node) && node.data?.scope)
    .map((node) => localNameProblem(node.data.name, { scope: node.data.scope }))
    .concat(rootNodes.filter((node) => node.data?.smId).map((node) => localNameProblem(node.data.name, { superInstance: true })))
    .filter(Boolean)
  const warnings = problems.length ? [`Some component names break the rules for names inside super-modules; rename them: ${problems.join(' ')}`] : []

  const scopeOfId = new Map(allNodes.map((node) => [node.id, node.data?.scope ?? null]))
  return {
    nodes: allNodes.map((node) => ({ ...node, hidden: (node.data?.scope ?? null) !== null })),
    edges: outEdges.map((edge) => ({ ...edge, hidden: (scopeOfId.get(edge.source) ?? null) !== null })),
    warnings,
    supermodules: [...defs.values()].map(({ smId, component }) => ({ smId, component })),
  }
}
