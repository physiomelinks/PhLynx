/**
 * Converts the CellDL editor's diagram to CellML as it is edited, in a worker, so the page never waits on
 * libCellML. Two passes follow each edit: a cheap one once edits pause (no libCellML checks: the CellML, the
 * element manifest and the issues found building the model, in tens of milliseconds), then a full one once the
 * diagram has been left alone a while (the Validator and Analyser, which can take seconds on a big diagram).
 *
 * One conversion runs at a time, and of those waiting only the newest is sent. A result for a diagram edited
 * since is dropped. The results are advisory: diagrams mid-edit are often invalid, and Save converts again.
 */
import { computed, ref, shallowRef, watch } from 'vue'

import { useCelldlEditorHost } from './useCelldlEditorHost'
import { useLibraryStore } from '../stores/libraryStore'
import { getModuleFormat } from '../services/moduleFormats'
import { knownUnitsForModule } from '../services/celldl/knownUnits.js'

/** How long edits must pause before the cheap pass, and the diagram be left alone before the full one. */
export const CHEAP_DELAY_MS = 150
export const FULL_DELAY_MS = 1000

/** The libCellML checks each pass runs (bg2cellml's `checks`). */
const PASS_CHECKS = Object.freeze({ cheap: 'none', full: 'full' })

/**
 * Starts the conversion worker.
 *
 * @param {Object} framework - The BG-RDF framework as text, `{ ontology, templates }`.
 * @param {string[]} knownUnits
 * @returns {Promise<Object>} bg2cellml's ConversionWorker.
 */
async function startWorker(framework, knownUnits) {
  const { createConversionWorker } = await import('@physiomelinks/bg2cellml/worker')
  const worker = new Worker(new URL('../workers/celldlConvertWorker.js', import.meta.url), { type: 'module' })
  return createConversionWorker(worker, { framework, defaults: { knownUnits } })
}

async function loadFramework() {
  const { bgRdfFramework } = await import('@celldl/editor/bgrdf')
  return bgRdfFramework()
}

async function loadAnnotations(elements) {
  const { toViewerAnnotations } = await import('@physiomelinks/bg2cellml')
  return toViewerAnnotations(elements)
}

const isSameList = (list, other) => list.length === other.length && list.every((item, index) => item === other[index])

/**
 * Creates a live conversion. The app uses the one useLiveCelldlConvert returns; tests make their own.
 *
 * @param {Object} options
 * @param {Object} options.host - The CellDL editor host (createCelldlEditorHost).
 * @param {() => string[]} [options.knownUnits] - The library's units for the converted module to name around; read
 *   reactively, and sent to the worker again only when they change.
 * @param {(framework: Object, knownUnits: string[]) => Promise<Object>} [options.createWorker] - Starts
 *   bg2cellml's ConversionWorker.
 * @param {() => Promise<Object>} [options.loadFramework]
 * @param {(elements: Object) => Promise<Object>} [options.loadAnnotations] - Makes viewer annotations of an
 *   element manifest.
 * @param {boolean} [options.isAvailable] - Whether this build can convert; Electron can't.
 * @param {number} [options.cheapDelay]
 * @param {number} [options.fullDelay]
 */
export function createLiveCelldlConvert({
  host,
  knownUnits = () => [],
  createWorker = startWorker,
  loadFramework: getFramework = loadFramework,
  loadAnnotations: annotate = loadAnnotations,
  isAvailable = typeof Worker !== 'undefined',
  cheapDelay = CHEAP_DELAY_MS,
  fullDelay = FULL_DELAY_MS,
}) {
  /** The worker's failure to start, which turns live conversion off. */
  const error = ref('')
  /** Whether the latest diagram has yet to be converted: the cheap pass hasn't reported on it. */
  const isPending = ref(false)
  /** Whether a full pass is waiting or running for the latest diagram. */
  const isChecking = ref(false)
  /** The latest diagram's conversion, `{ pass, edit, result }`, or null before its first. */
  const latest = shallowRef(null)
  /** The component the CellML is generated as, so it reads as saving would make it. */
  const componentName = ref(undefined)
  /**
   * The latest diagram's newest CellML, `{ cellml, componentName, sections }` (bg2cellml's sections), kept through
   * results that have none, e.g. mid-edit; null before its first.
   */
  const cellml = shallowRef(null)

  const result = computed(() => latest.value?.result ?? null)
  const issues = computed(() => (result.value ? [...result.value.errors, ...result.value.warnings] : []))

  let worker = null
  let convertLatest = null
  let starting = null
  // Bumped by stop, so a start it overtook ends the worker it made.
  let generation = 0
  let stopListening = null
  let stopUnitsWatch = null
  let sentUnits = []
  // The newest diagram heard, and how many have been, so a result for an older one is dropped.
  let diagram = null
  let edits = 0
  let cheapTimer = null
  let fullTimer = null

  /**
   * Starts converting the diagram as it changes, once: the worker is kept for the session. After a failure to
   * start, it tries again.
   *
   * @returns {Promise<void>} Resolves once the worker is ready; rejects if it can't start.
   */
  function start() {
    if (!isAvailable) return Promise.resolve()
    stopListening ??= host.onChange(onChange)
    const current = generation
    starting ??= (async () => {
      error.value = ''
      sentUnits = [...knownUnits()]
      const framework = await getFramework()
      if (current !== generation) return
      const conversionWorker = await createWorker(framework, sentUnits)
      if (current !== generation) return conversionWorker.terminate()
      worker = conversionWorker
      convertLatest = conversionWorker.latest()
      await conversionWorker.ready
      if (current !== generation) return
      stopUnitsWatch = watch(knownUnits, (units) => {
        if (isSameList(units, sentUnits)) return
        sentUnits = [...units]
        worker?.setDefaults({ knownUnits: sentUnits })
      })
    })().catch((e) => {
      if (current === generation) turnOff(e)
      throw e
    })
    return starting
  }

  /**
   * Hears a diagram: converts it once edits pause, and checks it fully once they stop. A diagram just opened
   * starts afresh, with its cheap pass at once; one starting to open drops what the last one was converting.
   *
   * @param {{rdf: string|null, documentUri: string|null, isOpened: boolean}} change
   */
  function onChange(change) {
    edits += 1
    clearTimeout(cheapTimer)
    clearTimeout(fullTimer)
    if (change.isOpened || change.rdf === null) latest.value = cellml.value = null
    isPending.value = true
    if (change.rdf === null) {
      diagram = null
      isChecking.value = false
      return
    }
    diagram = change
    isChecking.value = true
    cheapTimer = setTimeout(() => run('cheap'), change.isOpened ? 0 : cheapDelay)
    fullTimer = setTimeout(() => run('full'), fullDelay)
  }

  /**
   * Converts the newest diagram.
   *
   * @param {'cheap'|'full'} pass
   */
  async function run(pass) {
    if (!convertLatest) {
      // The worker is still starting; a first edit waits for it.
      try {
        await start()
      } catch {
        return
      }
    }
    if (!convertLatest || !diagram) return
    const edit = edits
    const { rdf, documentUri } = diagram
    const name = componentName.value
    let conversion
    try {
      conversion = await convertLatest(rdf, {
        rdfSource: true,
        checks: PASS_CHECKS[pass],
        ...(documentUri ? { sourceUri: documentUri } : {}),
        ...(name ? { componentName: name } : {}),
      })
    } catch (e) {
      // The worker has stopped or died: a conversion's own failures come back as issues. The next start tries again.
      if (worker) turnOff(e)
      return
    }
    // Superseded, or the diagram has changed since.
    if (!conversion || edit !== edits) return
    // The full pass may have overtaken a cheap one that waited behind the worker.
    if (pass === 'cheap' && latest.value?.edit === edit && latest.value.pass === 'full') return
    latest.value = { pass, edit, result: conversion.result }
    if (conversion.result.cellml) {
      cellml.value = { cellml: conversion.result.cellml, componentName: name, sections: conversion.result.sections ?? [] }
    }
    // A full pass answers for a cheap one it superseded.
    isPending.value = false
    if (pass === 'full') isChecking.value = false
    show(conversion.result, edit)
  }

  /**
   * Marks the elements with issues, and annotates the diagram as converted, so new elements show their variables.
   * An element manifest left empty by a failed build keeps the last annotations.
   */
  function show(conversion, edit) {
    const ids = [...conversion.errors, ...conversion.warnings].map((issue) => issue.elementId).filter(Boolean)
    host.highlight([...new Set(ids)], { isLive: true })
    if (!Object.keys(conversion.elements ?? {}).length) return
    annotate(conversion.elements).then(
      (annotations) => edit === edits && host.setLiveAnnotations(annotations),
      (e) => console.error('CellDL annotations failed:', e)
    )
  }

  /**
   * Sets the component the CellML is generated as.
   *
   * @param {string|undefined} name
   */
  function setComponentName(name) {
    componentName.value = name || undefined
  }

  /** Turns live conversion off after the worker failed, until it is next started. */
  function turnOff(e) {
    console.error('Live CellDL conversion is off:', e)
    error.value = e.message
    stop()
  }

  /** Stops converting and ends the worker. */
  function stop() {
    generation += 1
    clearTimeout(cheapTimer)
    clearTimeout(fullTimer)
    stopListening?.()
    stopUnitsWatch?.()
    stopListening = stopUnitsWatch = null
    const ending = worker
    worker = convertLatest = null
    starting = null
    isPending.value = false
    isChecking.value = false
    ending?.terminate()
  }

  return {
    isAvailable,
    error,
    isPending,
    isChecking,
    latest,
    result,
    issues,
    cellml,
    start,
    stop,
    setComponentName,
  }
}

let live = null

/**
 * Gets the app's live conversion of the CellDL editor's diagram. Its worker ends when the page does.
 *
 * @returns {ReturnType<typeof createLiveCelldlConvert>}
 */
export function useLiveCelldlConvert() {
  if (live) return live
  const store = useLibraryStore()
  const host = useCelldlEditorHost()
  const mathRef = ref(null)
  live = createLiveCelldlConvert({
    host,
    knownUnits: () => knownUnitsForModule(store, mathRef.value),
    isAvailable: getModuleFormat('celldl').isAvailable && typeof Worker !== 'undefined',
  })
  /**
   * Sets the module the diagram is converted for: its component name and its math, whose own units its CellML
   * replaces, so aren't known units (knownUnitsForModule).
   *
   * @param {{componentName?: string, mathRef?: string|null}} module
   */
  live.setModule = ({ componentName, mathRef: ref } = {}) => {
    live.setComponentName(componentName)
    mathRef.value = ref ?? null
  }
  // A page kept for going back to keeps its worker too.
  window.addEventListener('pagehide', (event) => event.persisted || live.stop())
  return live
}
