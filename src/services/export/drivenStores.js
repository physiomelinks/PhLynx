/**
 * Asks before a connection drives a CellDL store: a coupling that puts a store's amount in a group another instance
 * computes would set it twice (see resolveBoundaryValues' `overdetermined`), unless it is marked `drivesState`, so the
 * connection sets the store and the store's own equation and initial value are dropped for that instance.
 */
import { drivenEnd, resolveBoundaryValues, storeOptions } from './boundaryValues'
import { previewCouplings } from '../../utils/edges'
import { variableTypes } from '../../utils/multiport'

const isPlain = (type) => type === 'None' || type === 'True'

/**
 * Finds the first unmarked coupling, on the given edges, whose marking would let the rest of its group drive a CellDL
 * store (resolveBoundaryValues' `drivable`). Only a store a coupling pairs directly counts, at the end a mark drives.
 *
 * @param {Array} nodes - Workspace nodes.
 * @param {Array} edges - Workspace edges, with the couplings as they would be.
 * @param {Set<string>} edgeIds - The edges whose couplings are being made.
 * @param {(mathRef: string) => (Object|null)} [getMathAnalysis] - As resolveBoundaryValues takes it.
 * @param {{isCelldlMath: (mathRef: string) => boolean}} options - As resolveBoundaryValues takes them.
 * @returns {{edgeId: string, index: number, name: string, instance: string, from: string[]}|null}
 */
export function findDrivableCoupling(nodes, edges, edgeIds, getMathAnalysis, options) {
  if (!options?.isCelldlMath) return null
  let resolved
  try {
    resolved = resolveBoundaryValues(nodes, edges, getMathAnalysis, options)
  } catch {
    return null // a malformed multiport, which export reports
  }
  if (!resolved.drivable.length) return null
  const drivable = new Map(resolved.drivable.map((entry) => [entry.key, entry]))
  const rows = new Map(nodes.flatMap((node) => (node.data?.variables ?? []).map((row) => [`${node.id}::${row.name}`, { node, row }])))
  // As resolveBoundaryValues picks the end a mark drives.
  const isStore = (key) => {
    const found = rows.get(key)
    return found?.row.stateRole === 'state' && found.row.type === 'variable' && !!options.isCelldlMath(found.node.data?.mathRef)
  }
  const names = new Map(nodes.map((node) => [node.id, node.data?.name ?? node.id]))

  for (const edge of edges) {
    if (!edgeIds.has(edge.id)) continue
    const couplings = edge.data?.couplings ?? []
    for (let index = 0; index < couplings.length; index++) {
      const { sourcePort, targetPort, drivesState } = couplings[index]
      if (drivesState) continue
      let sourceTypes, targetTypes
      try {
        sourceTypes = variableTypes(sourcePort ?? {})
        targetTypes = variableTypes(targetPort ?? {})
      } catch {
        continue
      }
      for (let i = 0; i < Math.min(sourceTypes.length, targetTypes.length); i++) {
        const sourceName = sourcePort.variables?.[i]
        const targetName = targetPort.variables?.[i]
        if (!sourceName || !targetName || !isPlain(sourceTypes[i]) || !isPlain(targetTypes[i])) continue
        const key = drivenEnd(`${edge.source}::${sourceName}`, `${edge.target}::${targetName}`, isStore)
        const entry = key && drivable.get(key)
        if (entry) return { edgeId: edge.id, index, name: entry.name, instance: names.get(entry.nodeId), from: entry.from }
      }
    }
  }
  return null
}

/**
 * Asks once, for every store the edges' couplings would set from elsewhere, whether the connections should drive them,
 * marking each such coupling `drivesState` when they should. Several stores are listed in the one question, with the
 * edge each is set over.
 *
 * @param {Object} options
 * @param {Array} options.nodes - Workspace nodes, as they would be.
 * @param {Array} options.edges - Workspace edges, with the couplings as they would be.
 * @param {Set<string>} options.edgeIds - The edges whose couplings are being made.
 * @param {Object} options.libraryStore - For getMathAnalysis and getMathSource.
 * @param {(options: Object) => Promise<boolean>} options.confirm - useConfirmDialog's confirm.
 * @returns {Promise<Map<string, Array>|null>} Each edge whose couplings were marked, to its couplings; null when
 *   declined, so the couplings aren't made.
 */
export async function confirmDrivenStores({ nodes, edges, edgeIds, libraryStore, confirm }) {
  const options = storeOptions(libraryStore)
  let current = edges
  const marked = new Map()
  const found = []
  // Marking one coupling settles its store's group, so each store is found once; the bound only guards against a loop.
  for (let count = 0; count < 50; count++) {
    const next = findDrivableCoupling(nodes, current, edgeIds, libraryStore.getMathAnalysis, options)
    if (!next) break
    found.push(next)
    current = current.map((edge) => {
      if (edge.id !== next.edgeId) return edge
      const couplings = edge.data.couplings.map((coupling, index) => (index === next.index ? { ...coupling, drivesState: true } : coupling))
      marked.set(edge.id, couplings)
      return { ...edge, data: { ...edge.data, couplings } }
    })
  }
  if (!found.length) return marked
  const accepted = await confirm(drivenStoresQuestion(found, nodes, edges))
  return accepted ? marked : null
}

/**
 * Words the question confirmDrivenStores asks: one store by name, or several listed with the edge each is set over.
 *
 * @param {Array<{edgeId: string, name: string, instance: string, from: string[]}>} found
 * @param {Array} nodes
 * @param {Array} edges
 * @returns {Object} useConfirmDialog's options.
 */
function drivenStoresQuestion(found, nodes, edges) {
  const question = { severity: 'warning', acceptLabel: 'Set from connection', rejectLabel: 'Cancel' }
  if (found.length === 1) {
    const [{ name, instance, from }] = found
    return {
      ...question,
      header: 'Set a store from a connection',
      message:
        `Set ${name} of ${instance} from ${from.join(', ')}? ` +
        `Its own equation (d${name}/dt) and initial value will be dropped for this instance.`,
    }
  }
  const names = new Map(nodes.map((node) => [node.id, node.data?.name ?? node.id]))
  const edgeLabel = (id) => {
    const edge = edges.find((candidate) => candidate.id === id)
    return edge ? `${names.get(edge.source) ?? edge.source} → ${names.get(edge.target) ?? edge.target}` : id
  }
  return {
    ...question,
    header: 'Set stores from connections',
    message:
      `These ${found.length} connections would set stores from elsewhere. Set each from its connection? ` +
      'Each store’s own equation and initial value will be dropped for its instance.',
    acceptLabel: 'Set from connections',
    issues: found.map(({ edgeId, index, name, instance, from }) => ({
      key: `${edgeId}:${index}`,
      label: `${name} of ${instance}`,
      message: `from ${from.join(', ')}, over ${edgeLabel(edgeId)}`,
    })),
  }
}

/**
 * Previews the couplings a ports edit gives every edge touching the edited instances, and asks once about each CellDL
 * store they would newly set from elsewhere (confirmDrivenStores). An edit spread to other instances, as updating a
 * module spreads it, is checked on their edges too. Only edges whose couplings change, or `edgeIds`, are asked about.
 *
 * @param {Object} options
 * @param {Array} options.nodes - Workspace nodes.
 * @param {Array} options.edges - Workspace edges.
 * @param {Map<string, {ports: Array, variables?: Array}>} options.edits - Each edited instance's ports, and rows when
 *   they change, by id.
 * @param {Set<string>} [options.edgeIds] - Edges to ask about whatever their couplings, such as one being drawn.
 * @param {Object} options.libraryStore
 * @param {(options: Object) => Promise<boolean>} options.confirm
 * @returns {Promise<Map<string, Array>|null>} Each previewed edge's couplings as they will be, marked where they drive a
 *   store; null when declined.
 */
export async function confirmPortEditDrives({ nodes, edges, edits, edgeIds = new Set(), libraryStore, confirm }) {
  const edited = nodes.map((node) => {
    const edit = edits.get(node.id)
    return edit ? { ...node, data: { ...node.data, ports: edit.ports, ...(edit.variables && { variables: edit.variables }) } } : node
  })
  let current = edges
  const couplings = new Map()
  // Each instance's ports are already in `edited`, so an edge between two edited instances previews alike from both.
  for (const [id, { ports }] of edits) {
    const previewed = previewCouplings(id, ports, edited, current)
    previewed.forEach((next, edgeId) => couplings.set(edgeId, next))
    current = current.map((edge) => (previewed.has(edge.id) ? { ...edge, data: { ...edge.data, couplings: previewed.get(edge.id) } } : edge))
  }
  const unmarked = (list) => JSON.stringify((list ?? []).map(({ drivesState, ...coupling }) => coupling))
  const changed = new Set([
    ...edgeIds,
    ...[...couplings]
      .filter(([edgeId, next]) => unmarked(edges.find((edge) => edge.id === edgeId)?.data?.couplings) !== unmarked(next))
      .map(([edgeId]) => edgeId),
  ])
  if (!changed.size) return couplings
  const marked = await confirmDrivenStores({ nodes: edited, edges: current, edgeIds: changed, libraryStore, confirm })
  return marked && new Map([...couplings, ...marked])
}
