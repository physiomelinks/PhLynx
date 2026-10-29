/**
 * Asks before a connection drives a CellDL store: a coupling that puts a store's amount in a group another instance
 * computes would set it twice (see resolveBoundaryValues' `overdetermined`), unless it is marked `drivesState`, so the
 * connection sets the store and the store's own equation and initial value are dropped for that instance.
 */
import { drivenEnd, resolveBoundaryValues, storeOptions } from './boundaryValues'
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
 * Asks, for each store the edges' couplings would set from elsewhere, whether the connection should drive it, marking
 * the coupling `drivesState` when it should.
 *
 * @param {Object} options
 * @param {Array} options.nodes - Workspace nodes, as they would be.
 * @param {Array} options.edges - Workspace edges, with the couplings as they would be.
 * @param {Set<string>} options.edgeIds - The edges whose couplings are being made.
 * @param {Object} options.libraryStore - For getMathAnalysis and getMathSource.
 * @param {(options: Object) => Promise<boolean>} options.confirm - useConfirmDialog's confirm.
 * @returns {Promise<Map<string, Array>|null>} Each edge whose couplings were marked, to its couplings; null when one
 *   was declined, so the couplings aren't made.
 */
export async function confirmDrivenStores({ nodes, edges, edgeIds, libraryStore, confirm }) {
  const options = storeOptions(libraryStore)
  let current = edges
  const marked = new Map()
  // One question per store, each marking one coupling; the bound only guards against a loop.
  for (let asked = 0; asked < 50; asked++) {
    const found = findDrivableCoupling(nodes, current, edgeIds, libraryStore.getMathAnalysis, options)
    if (!found) break
    const accepted = await confirm({
      header: 'Set a store from a connection',
      message:
        `Set ${found.name} of ${found.instance} from ${found.from.join(', ')}? ` +
        `Its own equation (d${found.name}/dt) and initial value will be dropped for this instance.`,
      severity: 'warning',
      acceptLabel: 'Set from connection',
      rejectLabel: 'Cancel',
    })
    if (!accepted) return null
    current = current.map((edge) => {
      if (edge.id !== found.edgeId) return edge
      const couplings = edge.data.couplings.map((coupling, index) => (index === found.index ? { ...coupling, drivesState: true } : coupling))
      marked.set(edge.id, couplings)
      return { ...edge, data: { ...edge.data, couplings } }
    })
  }
  return marked
}
