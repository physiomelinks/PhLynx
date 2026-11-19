import { useVueFlow } from '@vue-flow/core'
import { computed, ref } from 'vue'

import { useFileDrop } from './useFileDrop'
import { AS_IS } from '../services/import/namespaceImport'
import { fileKeyFromPath } from '../utils/namespaces'
import { importOmexFile } from '../services/import/omex'
import { prepareCellmlImport, prepareCellmlImports, resolveCellmlImports } from '../services/import/prepareCellml'
import { parseCellMLConnections } from '../services/import/parseCellmlConnections'
import { loadParametersFromCellMLInBackground } from '../services/libcellml/modelQueries'
import { FLOW_IDS } from '../utils/constants'
import { offsetEdgeData } from '../utils/edgeRoute'
import { readFileAsText } from '../utils/misc'
import { notify } from '../utils/notify'

/** How far right a dropped file's restored workspace is placed, beside the new import. */
const RESTORE_OFFSET_X = 1500

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
 * @param {(files: Array<{ key: string, cellml: string }>) => Promise<Object>} [options.planImport] - Asks
 *   which namespace files from a folder or zip go in, and what to do about clashes there (see planNamespaceImport).
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
  planImport = async () => AS_IS,
  flowId = FLOW_IDS.MAIN,
}) {
  const { addEdges, addNodes, nodes, toObject } = useVueFlow(flowId)
  const { filesFromDataTransfer } = useFileDrop()

  /**
   * An entry's CellML text.
   *
   * @param {File|{ file?: File, content?: string }} entry
   * @returns {Promise<string>}
   */
  const readEntry = (entry) => {
    if (entry instanceof File) return readFileAsText(entry)
    if (entry.file) return readFileAsText(entry.file)
    return entry.content
  }

  /**
   * The library key a file is imported as: in the namespace of the folder or zip it came from, by
   * its name; a loose file by its name alone.
   *
   * @param {{ name: string, path?: string }} entry
   * @returns {string}
   */
  const keyOf = (entry) => (entry.path?.includes('/') ? fileKeyFromPath(entry.path) : entry.name)

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
   * Load an array of CellML entries, each being a browser File, a `{ name, path, file }` from a
   * dropped folder or zip, or a `{ name, path?, content }` already in memory. Paths are relative to
   * what was dropped and let CellML imports resolve against the other files.
   *
   * If a single file contains inter-component connections it is treated as a
   * connection graph and loaded into the workspace via loadFromCellML.
   * Otherwise (or for multiple files) the files are registered as module/unit
   * libraries via loadCellMLData as usual.
   *
   * Shows per-file notifications for a single file; a combined summary for multiple.
   */
  const loadCellMLFiles = async (entries) => {
    // Single-file fast path: check for connections and load as a graph if present
    if (entries.length === 1) {
      const entry = entries[0]
      const text = await readEntry(entry)
      const [resolved] = await resolveCellmlImports([{ name: entry.name, path: entry.path, content: text }])
      const content = await prepareCellmlImport(resolved, entry.name)
      const plan = await planImport([{ key: keyOf(entry), cellml: content }])
      if (plan.isSkipped(keyOf(entry))) return []
      const key = plan.mapKey(keyOf(entry))
      const parsedCellmlPayload = parseCellMLConnections(content, key)

      if (parsedCellmlPayload.edges.length > 0) {
        if (nodes.value.length > 0) {
          const overwrite = await confirmOverwrite({
            header: 'Workspace Not Empty',
            message: 'The workspace already contains nodes. What would you like to do?',
            severity: 'warning',
            acceptLabel: 'Overwrite',
            rejectLabel: 'Add to Workspace',
          })

          if (!overwrite) {
            // Snapshot current workspace before wiping it
            const snapshot = toObject()

            // Load new graph into clean workspace using the normal path
            const result = await loadCellMLData(content, key, { notify: false })
            const parameters = await loadParametersFromCellMLInBackground(content)
            // Nothing placed means nothing was cleared, so there is nothing to restore.
            if (!(await loadFromCellML(parsedCellmlPayload, key, parameters))) return [result]

            // Remap snapshotted node IDs to avoid clashes with newly loaded nodes
            const existingIds = new Set(nodes.value.map((n) => n.id))
            const idRemap = new Map()

            const restoredNodes = snapshot.nodes.map((n) => {
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
                position: { x: n.position.x + RESTORE_OFFSET_X, y: n.position.y },
                data: { ...n.data },
              }
            })

            // Remap edge source/target to use new IDs
            const restoredEdges = snapshot.edges.map((e) => ({
              ...e,
              id: `${e.id}_restored_${crypto.randomUUID()}`,
              source: idRemap.get(e.source) ?? e.source,
              target: idRemap.get(e.target) ?? e.target,
              ...(e.data && { data: offsetEdgeData(e.data, RESTORE_OFFSET_X, 0) }),
            }))

            addNodes(restoredNodes)
            addEdges(restoredEdges)

            return [result]
          }
        }

        // Register modules/units in the store first, then build the graph.
        const result = await loadCellMLData(content, key, { notify: false })
        const parameters = await loadParametersFromCellMLInBackground(content)
        await loadFromCellML(parsedCellmlPayload, key, parameters)

        rebuildNodeEdgeIndex()

        return [result]
      }
      // No connections — fall through to the standard module-registration path - TODO - might be nice to still drop single modules into workspace
      try {
        const result = await loadCellMLData(content, key)
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
          return await readEntry(entry)
        } catch {
          unreadable.add(index)
          return null
        }
      })
    )
    // Prepared together, so imports resolve against the other files and the batch gets one notice of each kind.
    const resolved = await resolveCellmlImports(
      entries.map((entry, index) => ({ name: entry.name, path: entry.path, content: texts[index] }))
    )
    const contents = await prepareCellmlImports(entries.map((entry, index) => ({ name: entry.name, content: resolved[index] })))
    // A namespace holds one file of a name: a later one, from another folder of the same import, is left out.
    const firstOfKey = new Map()
    const duplicates = []
    entries.forEach((entry, index) => {
      if (unreadable.has(index)) return
      if (firstOfKey.has(keyOf(entry))) duplicates.push(entry.path ?? entry.name)
      else firstOfKey.set(keyOf(entry), index)
    })
    if (duplicates.length) {
      notify.warning({
        title: 'Same-Named Files Left Out',
        message: `A namespace holds one file of each name, so these were left out: ${duplicates.join(', ')}.`,
      })
    }
    const isLoaded = (entry, index) => unreadable.has(index) || firstOfKey.get(keyOf(entry)) === index
    const plan = await planImport(
      entries
        .map((entry, index) => ({ key: keyOf(entry), cellml: contents[index] }))
        .filter((file, index) => !unreadable.has(index) && isLoaded(entries[index], index))
    )
    // Files the user chose to leave out are not counted as failures.
    const loading = entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry, index }) => isLoaded(entry, index) && !plan.isSkipped(keyOf(entry)))
    const results = await Promise.all(
      loading.map(async ({ entry, index }) => {
        if (unreadable.has(index)) return failed
        try {
          return await loadCellMLData(contents[index], plan.mapKey(keyOf(entry)), { notify: !multiFile })
        } catch {
          return failed
        }
      })
    )

    if (multiFile && results.length) {
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
      // Read before anything else is awaited: the drop's items are only readable during the event.
      const droppedPromise = filesFromDataTransfer(event.dataTransfer)

      if (loadingMessage.value) {
        notify.info({
          title: 'Still Loading',
          message: 'Please wait for the current files to finish loading.',
        })
        return
      }

      // Folders are walked and zips opened; loose files keep their names as paths.
      const dropped = await droppedPromise
      const hasExtension = (extension) => (entry) => entry.file.name.toLowerCase().endsWith(extension)
      const cellmlFiles = dropped
        .filter(hasExtension('.cellml'))
        .map(({ file, path }) => ({ name: file.name, path, file }))
      const omexFiles = dropped.filter(hasExtension('.omex')).map(({ file }) => file)

      if (cellmlFiles.length === 0 && omexFiles.length === 0) {
        notify.warning({
          title: 'Unsupported File Type',
          message: 'Only .cellml and .omex files, or folders and zips holding them, can be dropped onto the workspace.',
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
              message: `${file.name} imported successfully!`,
            })
          } catch (error) {
            notify.error({
              title: 'OMEX Import Failed',
              message: error.message,
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
