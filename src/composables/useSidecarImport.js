import { useVueFlow } from '@vue-flow/core'

import { useLibraryStore } from '../stores/libraryStore'
import { buildRestoredPorts } from '../services/import/omexAnnotations'
import { matchSidecarFiles } from '../services/annotations/importSidecars'
import { findUnknownTerms, sidecarTerms, termIdProblems } from '../services/annotations/termIds'
import { lookupTerm } from '../services/ontology/ols'
import { escapeHtml } from '../utils/importBatch'
import { notify } from '../utils/notify'
import { FLOW_IDS } from '../utils/constants'
import { useConfirmDialog } from './useConfirmDialog'
import { useNodeDataHistory } from './useNodeDataHistory'

// Notifications show their message as HTML, and these lines quote file names.
const lines = (texts) => texts.map(escapeHtml).join('<br>')

/**
 * Imports module side-car files into the library, as one undo step.
 *
 * @param {string} [flowId=FLOW_IDS.MAIN]
 * @param {Object} [options]
 * @param {(curie: string) => Promise<Object|null>} [options.lookup] - Looks a ChEBI or GO term up on OLS.
 * @returns {{ importSidecars: Function }}
 */
export function useSidecarImport(flowId = FLOW_IDS.MAIN, { lookup = lookupTerm } = {}) {
  const { nodes, updateNodeData } = useVueFlow(flowId)
  const libraryStore = useLibraryStore()
  const { recordEdit, findIncidentEdgeIds } = useNodeDataHistory(flowId)
  const { confirm } = useConfirmDialog()

  /**
   * Puts each file on the library module it annotates, and updates the annotated ports of placed instances.
   *
   * @param {Array<{ name: string, text: string, mathRef?: string|null }>} files - Read side-car files.
   * @returns {Promise<number>} How many modules were annotated.
   */
  async function importSidecars(files) {
    const { matched, unmatched } = matchSidecarFiles(files, (mathRef) => libraryStore.availableMath.has(mathRef))
    const skipped = unmatched.map(({ name, reason }) => `${name} ${reason}`)
    if (!matched.length) {
      notify.warning({ title: 'No Modules Annotated', message: lines(skipped) || 'No side-car files given.' })
      return 0
    }

    const before = new Map(matched.map(({ mathRef }) => [mathRef, libraryStore.getModuleAnnotations(mathRef)]))
    const replaced = matched.filter(({ mathRef, text }) => before.get(mathRef) && before.get(mathRef) !== text)
    if (replaced.length) {
      const isReplacing = await confirm({
        header: 'Replace Annotations?',
        message: `These modules already have annotations, which the import replaces:\n${replaced
          .map(({ mathRef }) => `• ${mathRef}`)
          .join('\n')}`,
        severity: 'warning',
        acceptLabel: 'Replace',
        rejectLabel: 'Cancel',
      })
      if (!isReplacing) return 0
    }

    const textOn = (side, { mathRef, text }) => (side === 'after' ? text : before.get(mathRef))
    // Setting a side-car drops its parse, so one already in place is left, parse and all.
    const setAll = (side) =>
      matched.forEach((file) => {
        if (libraryStore.getModuleAnnotations(file.mathRef) !== textOn(side, file))
          libraryStore.setModuleAnnotations(file.mathRef, textOn(side, file))
      })

    // Parsed first, so the ports below follow the new side-cars.
    setAll('after')
    const parsed = await Promise.all(matched.map(({ mathRef }) => libraryStore.ensureModuleAnnotations(mathRef)))
    const ports = await buildRestoredPorts(nodes.value, matched, libraryStore)
    const nodeIds = [...ports.keys()]
    await recordEdit({
      type: 'import-annotations',
      nodeIds,
      keys: ['ports'],
      edgeIds: findIncidentEdgeIds(nodeIds),
      apply: () => {
        setAll('after')
        ports.forEach((nodePorts, nodeId) => updateNodeData(nodeId, { ports: nodePorts }))
      },
      library: {
        isAt: (side) => matched.every((file) => libraryStore.getModuleAnnotations(file.mathRef) === textOn(side, file)),
        restore: setAll,
      },
    })

    const unresolved = parsed.flatMap((sidecar, i) =>
      sidecar?.unresolved?.length ? [`${matched[i].name}: ${sidecar.unresolved.length} unresolved variable(s)`] : []
    )
    // Terms are only flagged, never changed.
    const terms = parsed.map((sidecar) => sidecarTerms(sidecar))
    const cited = (problems, i) => problems.map(({ where, problem }) => `${matched[i].name}: ${where}: ${problem}`)
    const badIds = terms.flatMap((fileTerms, i) => cited(termIdProblems(fileTerms), i))
    const names = matched.map(({ mathRef }) => mathRef.split(':').pop()).join(', ')
    const notes = [...skipped, ...unresolved, ...badIds]
    const message = lines([`Annotated ${names}.`, ...notes])
    if (notes.length) notify.warning({ title: 'Annotations Imported', message })
    else notify.success({ title: 'Annotations Imported', message })
    warnOfUnknownTerms(terms, cited)
    return matched.length
  }

  /**
   * Warns, once OLS answers, of the imported ChEBI and GO terms it doesn't know; offline, it says nothing.
   *
   * @param {Array<Array<{ where: string, curie: string }>>} terms - Each matched file's.
   * @param {Function} cited - Names the file in each problem.
   */
  async function warnOfUnknownTerms(terms, cited) {
    const unknown = await Promise.all(
      terms.map(async (fileTerms, i) => cited(await findUnknownTerms(fileTerms, lookup), i))
    )
    if (unknown.flat().length) notify.warning({ title: 'Unknown Ontology Terms', message: lines(unknown.flat()) })
  }

  return { importSidecars }
}
