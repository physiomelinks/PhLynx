import { useVueFlow } from '@vue-flow/core'
import { computed, ref } from 'vue'

import { importOmexFile } from '../services/import/omex'
import { prepareCellmlImport, prepareCellmlImports } from '../services/import/prepareCellml'
import { parseCellMLConnections } from '../services/import/parseCellmlConnections'
import { loadParametersFromCellML, readEncapsulation } from '../utils/cellml'
import { FLOW_IDS } from '../utils/constants'
import { isSupermoduleInterface, scopeOf } from '../utils/hierarchy'
import { readFileAsText } from '../utils/misc'
import { notify } from '../utils/notify'

/**
 * Loads CellML files into the workspace (from OS file drops or the import dialog) and routes
 * dragover/drop events between OS file drops and internal module drags.
 *
 * @param {Object} options
 * @param {Function} options.loadCellMLData - Registers a CellML file's modules/units in the library.
 * @param {Function} options.loadFromCellML - Builds the connection graph from parsed CellML.
 * @param {Function} options.rebuildNodeEdgeIndex - Rebuilds the node to edge index after a load.
 * @param {Function} options.confirm - Confirm dialog; resolves true to overwrite the workspace.
 * @param {Object} options.libcellml - Injected libCellML state; drops wait for `status === 'ready'`.
 * @param {Function} options.processImportedOmexArchive - Applies an imported OMEX archive.
 * @param {Function} options.onDragOverModule - Internal module-drag dragover handler (from useDnD).
 * @param {Function} options.onDropModule - Internal module-drag drop handler (from useDnD).
 * @param {string} [options.flowId=FLOW_IDS.MAIN]
 * @returns {{ loadCellMLFiles: Function, onDragOver: Function, onFileDragLeave: Function, onDrop: Function,
 *   isFileDragOver: Ref<boolean>, dropLoadingMessage: ComputedRef<string> }}
 */
export function useCellmlDrop({
  loadCellMLData,
  loadFromCellML,
  rebuildNodeEdgeIndex,
  confirm,
  libcellml,
  processImportedOmexArchive,
  onDragOverModule,
  onDropModule,
  flowId = FLOW_IDS.MAIN,
}) {
  const { addEdges, addNodes, nodes, toObject } = useVueFlow(flowId)

  /** True while files from the OS are dragged over the workspace. */
  const isFileDragOver = ref(false)
  /** What a dropped load is doing; empty when idle. */
  const loadingMessage = ref('')
  /** True while the overwrite question is open, so the indicator steps aside for it. */
  const isAsking = ref(false)
  /** The indicator's message, hidden while the user is being asked something. */
  const dropLoadingMessage = computed(() => (isAsking.value ? '' : loadingMessage.value))

  /**
   * Resolves once the browser has painted, so the indicator is on screen before blocking work.
   * rAF runs before the next paint; the timeout lands after it.
   */
  const nextPaint = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))

  /**
   * Asks whether to overwrite the workspace, with the indicator hidden until it's answered.
   *
   * @param {Object} options - Confirm dialog options.
   * @returns {Promise<boolean>}
   */
  const confirmOverwrite = async (options) => {
    isAsking.value = true
    try {
      return await confirm(options)
    } finally {
      isAsking.value = false
      if (loadingMessage.value) await nextPaint()
    }
  }

  /**
   * Load an array of CellML entries, each being either a browser File object or a
   * plain `{ name, content }` object (used when content is already in memory).
   *
   * If a single file contains inter-component connections it is treated as a
   * connection graph and loaded into the workspace via loadFromCellML.
   * Otherwise (or for multiple files) the files are registered as module/unit
   * libraries via loadCellMLData as usual.
   *
   * Shows per-file notifications for a single file; a combined summary for multiple.
   *
   * A connection graph's encapsulating components become super-modules (see cellmlFold.js), unless `flat`.
   *
   * @param {Array<File|{name: string, content: string}>} entries
   * @param {Object} [options]
   * @param {boolean} [options.flat=false] - Imports a graph's encapsulated components at the top level instead.
   */
  const loadCellMLFiles = async (entries, { flat = false } = {}) => {
    // Single-file fast path: check for connections and load as a graph if present
    if (entries.length === 1) {
      const entry = entries[0]
      const raw = entry instanceof File ? await readFileAsText(entry) : entry.content
      const content = prepareCellmlImport(raw, entry.name)
      const parsedCellmlPayload = parseCellMLConnections(content, entry.name)
      const encapsulation = flat ? undefined : readEncapsulation(raw)

      if (parsedCellmlPayload.edges.length > 0) {
        if (nodes.value.length > 0) {
          const overwrite = await confirmOverwrite({
            header: 'Workspace Not Empty',
            message: 'The workspace already contains nodes. What would you like to do?',
            severity: 'warning',
            acceptLabel: 'Overwrite',
            rejectLabel: 'Add to Workspace',
          })
          // Closed without an answer: neither.
          if (overwrite == null) return []

          if (!overwrite) {
            // Snapshot current workspace before wiping it
            const snapshot = toObject()

            // Load new graph into clean workspace using the normal path
            const result = await loadCellMLData(content, entry.name, { notify: false })
            const parameters = loadParametersFromCellML(content)
            await loadFromCellML(parsedCellmlPayload, entry.name, parameters, { encapsulation, reserved: snapshot.nodes })

            // Remap snapshotted node IDs to avoid clashes with newly loaded nodes at the root (the load starts the
            // canvas there). The load took no super-module id of theirs, so their super-modules' nodes keep theirs.
            const existingIds = new Set(nodes.value.map((n) => n.id))
            const idRemap = new Map()
            const isRootNode = (n) => scopeOf(n) === null && !isSupermoduleInterface(n)

            const restoredNodes = snapshot.nodes.map(({ hidden: _hidden, ...n }) => {
              if (!isRootNode(n)) return { ...n, data: { ...n.data } }
              let newId = n.id
              let counter = 1
              while (existingIds.has(newId)) {
                newId = `${n.id}_${counter++}`
              }
              existingIds.add(newId)
              idRemap.set(n.id, newId)

              return {
                ...n,
                id: newId,
                position: { x: n.position.x + 1500, y: n.position.y },
                data: { ...n.data, ...(n.data?.localId != null && { localId: newId }) },
              }
            })

            // Remap edge source/target to use new IDs
            const restoredEdges = snapshot.edges.map((e) => ({
              ...e,
              id: `${e.id}_restored_${crypto.randomUUID()}`,
              source: idRemap.get(e.source) ?? e.source,
              target: idRemap.get(e.target) ?? e.target,
            }))

            addNodes(restoredNodes)
            addEdges(restoredEdges)

            return [result]
          }
        }

        // Register modules/units in the store first, then build the graph.
        const result = await loadCellMLData(content, entry.name, { notify: false })
        const parameters = loadParametersFromCellML(content)
        await loadFromCellML(parsedCellmlPayload, entry.name, parameters, { encapsulation })

        rebuildNodeEdgeIndex()

        return [result]
      }
      // No connections — fall through to the standard module-registration path - TODO - might be nice to still drop single modules into workspace
      try {
        const result = await loadCellMLData(content, entry.name)
        return [result]
      } catch {
        return [{ ok: false, moduleCount: 0, unitsCount: 0 }]
      }
    }

    // Multi-file path: always register as module/unit libraries
    const multiFile = entries.length > 1
    const failed = { ok: false, moduleCount: 0, unitsCount: 0 }
    const unreadable = new Set()
    const texts = await Promise.all(
      entries.map(async (entry, index) => {
        try {
          return entry instanceof File ? await readFileAsText(entry) : entry.content
        } catch {
          unreadable.add(index)
          return null
        }
      })
    )
    // Prepared together, so the batch gets one notice of each kind.
    const contents = prepareCellmlImports(entries.map((entry, index) => ({ name: entry.name, content: texts[index] })))
    const results = await Promise.all(
      entries.map(async (entry, index) => {
        if (unreadable.has(index)) return failed
        try {
          return await loadCellMLData(contents[index], entry.name, { notify: !multiFile })
        } catch {
          return failed
        }
      })
    )

    if (multiFile) {
      const succeeded = results.filter((r) => r.ok)
      const failed = results.length - succeeded.length
      const totalModules = succeeded.reduce((sum, r) => sum + r.moduleCount, 0)
      const totalUnits = succeeded.reduce((sum, r) => sum + r.unitsCount, 0)
      const fileWord = (n) => `${n} file${n !== 1 ? 's' : ''}`
      const summary = [
        totalModules > 0 ? `${totalModules} module${totalModules !== 1 ? 's' : ''}` : '',
        totalUnits > 0 ? `${totalUnits} unit${totalUnits !== 1 ? 's' : ''}` : '',
      ]
        .filter(Boolean)
        .join(' and ')
      if (succeeded.length > 0 && failed === 0) {
        notify.success({
          title: 'CellML Files Loaded',
          message: `Loaded ${summary} from ${fileWord(succeeded.length)}.`,
        })
      } else if (succeeded.length > 0) {
        notify.warning({
          title: 'Partial Import',
          message: `Loaded ${summary} from ${fileWord(succeeded.length)}. ${fileWord(failed)} failed.`,
        })
      } else {
        notify.error({ title: 'Import Failed', message: `Failed to load all ${fileWord(failed)}.` })
      }
    }

    return results
  }

  /**
   * Unified dragover handler — accepts both module drags (internal) and file drops (.cellml from OS).
   */
  const onDragOver = (event) => {
    const hasFiles = event.dataTransfer?.types?.includes('Files')
    if (hasFiles) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      isFileDragOver.value = true
    } else {
      onDragOverModule(event)
    }
  }

  /**
   * Clears the file drag-over cue once the drag leaves the drop area, not when it moves between its children.
   *
   * @param {DragEvent} event
   */
  const onFileDragLeave = (event) => {
    if (event.currentTarget?.contains?.(event.relatedTarget)) return
    isFileDragOver.value = false
  }

  /**
   * Shows `message` over the workspace while `taskFn` runs, painting it before the work starts.
   *
   * @param {string} message - Indicator text.
   * @param {Function} taskFn - Async task to run.
   */
  const withLoadingIndicator = async (message, taskFn) => {
    loadingMessage.value = message
    try {
      await nextPaint()
      return await taskFn()
    } finally {
      loadingMessage.value = ''
    }
  }

  /**
   * Unified drop handler — routes OS file drops to CellML import, internal drags to the module DnD handler.
   */
  const onDrop = async (event) => {
    isFileDragOver.value = false
    const files = event.dataTransfer?.files
    if (files && files.length > 0) {
      event.preventDefault()

      if (loadingMessage.value) {
        notify.info({
          title: 'Still Loading',
          message: 'Please wait for the current files to finish loading.',
        })
        return
      }

      const cellmlFiles = Array.from(files).filter((f) => f.name.toLowerCase().endsWith('.cellml'))

      const omexFiles = Array.from(files).filter((f) => f.name.toLowerCase().endsWith('.omex'))

      if (cellmlFiles.length === 0 && omexFiles.length === 0) {
        notify.warning({
          title: 'Unsupported File Type',
          message: 'Only .cellml and .omex files can be dropped onto the workspace.',
        })
        return
      }

      if (libcellml.status !== 'ready') {
        notify.warning({
          title: 'CellML Library Not Ready',
          message: 'Please wait for the CellML library to finish loading and try again.',
        })
        return
      }

      if (cellmlFiles.length > 0) {
        const label = cellmlFiles.length === 1 ? cellmlFiles[0].name : `${cellmlFiles.length} CellML files`
        await withLoadingIndicator(`Loading ${label}...`, () => loadCellMLFiles(cellmlFiles))
      }

      if (omexFiles.length > 0) {
        for (const file of omexFiles) {
          try {
            await withLoadingIndicator(`Importing ${file.name}...`, async () => {
              const arrayBuffer = await file.arrayBuffer()
              const result = await importOmexFile(arrayBuffer)
              await processImportedOmexArchive(arrayBuffer, result, file.name)
            })
            notify.success({
              title: 'OMEX Import Complete',
              items: [`${file.name} imported successfully!`],
            })
          } catch (error) {
            notify.error({
              title: 'OMEX Import Failed',
              items: [error.message],
            })
          }
        }
      }
    } else {
      onDropModule(event)
    }
  }

  return { loadCellMLFiles, onDragOver, onFileDragLeave, onDrop, isFileDragOver, dropLoadingMessage }
}
