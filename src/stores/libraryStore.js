import { defineStore } from 'pinia'
import { parseLayout } from 'cellml-text-editor'
import { ref, computed, markRaw } from 'vue'
import { normaliseConfig, buildModule, parseMathRef, uniqueModuleRef } from '../utils/config'
import {
  AFFINE_UNIT_CONVERSIONS,
  GENERATED_UNITS_FILE,
  PROTECTED_MATH_REFS,
  GHOST_MATH_REF,
  STANDARD_UNITS,
} from '../utils/constants'
import { cyrb53 } from '../utils/misc'
import { expandUnits, extractUnitDefinitions, extractUnitNames, mergeUnitDefinitions } from '../utils/units'
import { unitsModelXml } from '../utils/unitExpression'
import { analyzeMathXml } from '../services/math/analyzeMath'
import { analyzeBatchInBackground, analyzeInBackground } from '../services/math/mathWorkerClient'
import { separateParameters } from '../services/math/separateParameters'
import { detachReactivity } from '../utils/reactivity'
import { parseSidecar } from '../services/annotations/sidecar'

function mergeIntoStore(newModules, target) {
  const moduleMap = new Map(target.map((mod) => [mod.componentFile, mod]))

  if (newModules) {
    for (const newModule of newModules) {
      if (newModule && newModule.componentFile) {
        // Safety check
        moduleMap.set(newModule.componentFile, newModule)
      }
    }
  }

  target.length = 0
  target.push(...moduleMap.values())
}

function mergeIn(sourceMap, targetMap) {
  for (const [key, value] of sourceMap) {
    targetMap.set(key, value)
  }
}

// 'library' is the store's ID
export const useLibraryStore = defineStore('library', () => {
  // --- STATE ---
  const availableCollections = ref(new Map())
  const availableModules = ref(new Map())
  const availableMath = ref(new Map())
  const mathHashIndex = ref(new Map())
  const mathRefHash = ref(new Map())
  const availableUnits = ref([])
  const globalConstants = ref(new Map())

  // mathRef -> Map of the values that came with that math when it was added. They only seed new
  // instances: an existing instance's rows never read them, so math and parameters stay separate.
  const mathDefaults = ref(new Map()) // TODO - somehow separate this from the library store, since values are separate from the math.
  
  // mathRef -> TextLayout: the comments, blank lines and typed statements the math XML can't hold.
  const mathLayouts = ref(new Map())

  // mathRef -> MathAnalysis. Non-reactive, since analyses are large and only read imperatively.
  const availableMathAnalysis = markRaw(new Map())

  // mathRef -> the module's sidecar RDF text, saved as written. Its parse is a cache, never saved.
  const moduleAnnotations = ref(new Map())
  // mathRef -> { text, math, sidecar }. Non-reactive; annotationParses counts filled entries, so the sync
  // accessor's readers recompute once a parse lands.
  const parsedModuleAnnotations = markRaw(new Map())
  const pendingAnnotationParses = new Map()
  const annotationParses = ref(0)

  // --- ACTIONS ---
  function resetGlobalConstants() {
    globalConstants.value.clear()
  }

  function assignGlobalConstant(variableName, value, units, data_reference, overwrite = false) {
    if (globalConstants.value.has(variableName) && overwrite === false) return
    globalConstants.value.set(variableName, { value, units, data_reference })
  }

  function getGlobalConstant(variableName) {
    return globalConstants.value.get(variableName)
  }

  function removeGlobalConstant(variableName) {
    globalConstants.value.delete(variableName)
  }

  function cleanupUnusedGlobalConstants(activeNodes) {
    if (globalConstants.value.size === 0) return []

    const activeVariableNames = new Set()
    activeNodes.forEach((node) => {
      node.data?.variables?.forEach((variable) => {
        if (variable.name) {
          activeVariableNames.add(variable.name.trim())
        }
      })
    })

    const removedConstants = []
    for (const [key, value] of globalConstants.value.entries()) {
      if (!activeVariableNames.has(key)) {
        removedConstants.push({ name: key, ...value })
        globalConstants.value.delete(key)
      }
    }

    return removedConstants
  }

  function resetState() {
    resetGlobalConstants()
    availableMath.value.clear()
    mathHashIndex.value.clear()
    mathRefHash.value.clear()
    availableCollections.value.clear()
    availableModules.value.clear()
    availableUnits.value = []
    mathDefaults.value.clear()
    mathLayouts.value.clear()
    availableMathAnalysis.clear()
    pendingAnalysis.clear()
    moduleAnnotations.value.clear()
    parsedModuleAnnotations.clear()
    pendingAnnotationParses.clear()
  }

  function createMathHash(math) {
    const value = typeof math === 'string' ? math : JSON.stringify(math ?? '')
    return `math_${cyrb53(value).toString(36)}`
  }

  function removeMathHashEntry(mathRef, hash) {
    if (!hash || !mathHashIndex.value.has(hash)) return

    const refs = mathHashIndex.value.get(hash)
    refs.delete(mathRef)
    if (refs.size === 0) {
      mathHashIndex.value.delete(hash)
    }
  }

  function addMathHashEntry(mathRef, math) {
    if (typeof math !== 'string') return

    const previousHash = mathRefHash.value.get(mathRef)
    if (previousHash) {
      removeMathHashEntry(mathRef, previousHash)
    }

    const hash = createMathHash(math)
    if (!mathHashIndex.value.has(hash)) {
      mathHashIndex.value.set(hash, new Set())
    }
    mathHashIndex.value.get(hash).add(mathRef)
    mathRefHash.value.set(mathRef, hash)
  }

  function getMathRefsByHash(hash) {
    const refs = mathHashIndex.value.get(hash)
    return refs ? Array.from(refs) : []
  }

  function findMathRefByMath(math) {
    if (typeof math !== 'string') return null

    const hash = createMathHash(math)
    const candidateRefs = getMathRefsByHash(hash)
    return candidateRefs.find((mathRef) => availableMath.value.get(mathRef) === math) ?? null
  }

  function getMathHashByRef(mathRef) {
    return mathRefHash.value.get(mathRef) ?? null
  }

  // --- SETTERS ---

  function addConfigFile(filename, configs) {
    let totalAdded = 0

    if (!configs || !Array.isArray(configs)) {
      return totalAdded
    }

    configs.forEach((config) => {
      if (!config.component_file || typeof config.component_file !== 'string') {
        return totalAdded
      }

      if (addModule(normaliseConfig(config))) totalAdded++
    })
    return totalAdded
  }

  /**
   * Adds a module unless its ref is taken, and lists it under its math unless the ref is another
   * math's.
   *
   * @param {Object} module
   * @returns {boolean} Whether the module was stored.
   */
  function addModule(module) {
    // Recomputed every time, since a module put back by undo may carry a stale flag.
    if (!availableMath.value.has(module.mathRef) && module.mathRef !== GHOST_MATH_REF) {
      module.isStub = true
    } else {
      delete module.isStub
    }

    const existing = availableModules.value.get(module.moduleRef)
    if (!existing) availableModules.value.set(module.moduleRef, module)

    // SMELL - still only really using cellml file origin, but now extensible if we include other metadata
    if (!existing || existing.mathRef === module.mathRef) updateCollections(module.mathRef, module.moduleRef)
    return !existing
  }

  function ensureSet(key) {
    if (!availableCollections.value.has(key)) {
      availableCollections.value.set(key, new Set())
    }
    return availableCollections.value.get(key)
  }

  function updateCollections(tag, moduleRef) {
    ensureSet(tag).add(moduleRef)
  }

  const pendingAnalysis = new Map() // mathRef -> math added since the last background batch
  let isAnalysisFlushScheduled = false

  /**
   * Caches an analysis if its math is still the current math for `mathRef`.
   */
  function cacheAnalysisIfCurrent(mathRef, math, analysis) {
    if (analysis && availableMath.value.get(mathRef) === math) availableMathAnalysis.set(mathRef, analysis)
    return analysis
  }

  function reportAnalysisError(mathRef, err) {
    console.error(`Failed to analyze CellML math for "${mathRef}":`, err)
    return null
  }

  /** Sends the pending math to the worker as one batch and caches results that are still current. */
  function flushPendingAnalysis() {
    isAnalysisFlushScheduled = false
    if (pendingAnalysis.size === 0) return

    const items = Array.from(pendingAnalysis, ([key, xml]) => ({ key, xml }))
    pendingAnalysis.clear()

    analyzeBatchInBackground(items)
      .then((results) => results.forEach(({ key, analysis }, index) => cacheAnalysisIfCurrent(key, items[index].xml, analysis)))
      .catch((err) => console.error('Background math analysis failed', err))
  }

  /**
   * Drops a math's cached analysis and schedules a background re-analysis.
   *
   * @param {string} mathRef
   * @param {string} math - The new math XML.
   */
  function scheduleMathAnalysis(mathRef, math) {
    availableMathAnalysis.delete(mathRef)
    pendingAnalysis.set(mathRef, math)
    if (!isAnalysisFlushScheduled) {
      isAnalysisFlushScheduled = true
      queueMicrotask(flushPendingAnalysis)
    }
  }

  /**
   * Gets a math's analysis, computing and caching it now if the background pass hasn't finished.
   */
  function getMathAnalysis(mathRef) {
    const cached = availableMathAnalysis.get(mathRef)
    if (cached) return cached

    const math = availableMath.value.get(mathRef)
    if (!math) return null
    try {
      return cacheAnalysisIfCurrent(mathRef, math, analyzeMathXml(math))
    } catch (err) {
      return reportAnalysisError(mathRef, err)
    }
  }

  /**
   * Gets a math's analysis like getMathAnalysis, but analyzes a cache miss in the worker.
   */
  async function ensureMathAnalysis(mathRef) {
    const cached = availableMathAnalysis.get(mathRef)
    if (cached) return cached

    const math = availableMath.value.get(mathRef)
    if (!math) return null
    return analyzeInBackground(math)
      .then((analysis) => cacheAnalysisIfCurrent(mathRef, math, analysis))
      .catch((err) => reportAnalysisError(mathRef, err))
  }

  function addMathFile(filename, components) {
    components.forEach((component) => {
      const mathRef = `${filename}:${component.name}`
      addMath(mathRef, component.math, true, component.layout)
      createModuleForMath(mathRef)
    })
  }

  /**
   * Keeps math without its values, recording them as the math's defaults. Values already recorded
   * stay unless the new math gives the same variable another.
   *
   * @param {string} mathRef
   * @param {string} rawMath
   * @returns {string} The math as stored.
   */
  function storeSeparatedMath(mathRef, rawMath) {
    const { math, values } = separateParameters(rawMath)
    if (values.size) mathDefaults.value.set(mathRef, new Map([...getMathDefaults(mathRef), ...values]))
    availableMath.value.set(mathRef, math)
    return math
  }

  /**
   * Gets the values that came with a math, by variable name. Use them only to seed a new instance.
   *
   * @param {string} mathRef
   * @returns {Map<string, string>}
   */
  function getMathDefaults(mathRef) {
    return mathDefaults.value.get(mathRef) ?? new Map()
  }

  /**
   * Gets the text layout saved with a math.
   *
   * @param {string} mathRef
   * @returns {import('cellml-text-editor').TextLayout | null}
   */
  function getMathLayout(mathRef) {
    return mathLayouts.value.get(mathRef) ?? null
  }

  /**
   * Saves a math's text layout, or removes it when the layout is null.
   *
   * @param {string} mathRef
   * @param {import('cellml-text-editor').TextLayout | null} layout
   */
  function setMathLayout(mathRef, layout) {
    if (layout) mathLayouts.value.set(mathRef, layout)
    else mathLayouts.value.delete(mathRef)
  }

  /**
   * Gets a math's sidecar RDF text.
   *
   * @param {string} mathRef
   * @returns {string|null}
   */
  function getModuleAnnotations(mathRef) {
    return moduleAnnotations.value.get(mathRef) ?? null
  }

  /**
   * Saves a math's sidecar RDF text, or removes it when the text is empty or null.
   *
   * @param {string} mathRef
   * @param {string|null} text
   */
  function setModuleAnnotations(mathRef, text) {
    if (typeof text === 'string' && text.trim()) moduleAnnotations.value.set(mathRef, text)
    else moduleAnnotations.value.delete(mathRef)
    parsedModuleAnnotations.delete(mathRef)
  }

  /**
   * Gets a parse cached for the sidecar and math as they are now.
   *
   * @param {string} mathRef
   * @returns {{ text: string, math: string|undefined, sidecar: Object }|null}
   */
  function currentAnnotationParse(mathRef) {
    const cached = parsedModuleAnnotations.get(mathRef)
    const isCurrent =
      cached && cached.text === moduleAnnotations.value.get(mathRef) && cached.math === availableMath.value.get(mathRef)
    return isCurrent ? cached : null
  }

  /**
   * Gets a math's parsed sidecar if ensureModuleAnnotations has parsed it for the current text and math.
   * Reactive: readers recompute when a parse lands.
   *
   * @param {string} mathRef
   * @returns {Object|null} From parseSidecar.
   */
  function getParsedModuleAnnotations(mathRef) {
    void annotationParses.value
    return currentAnnotationParse(mathRef)?.sidecar ?? null
  }

  /**
   * Parses a math's sidecar against its math and caches the result. A parse that a later edit makes stale is
   * returned to its caller but not cached.
   *
   * @param {string} mathRef
   * @returns {Promise<Object|null>} From parseSidecar, or null when the math has no sidecar.
   */
  async function ensureModuleAnnotations(mathRef) {
    const text = moduleAnnotations.value.get(mathRef)
    if (text === undefined) return null
    const math = availableMath.value.get(mathRef)
    const cached = currentAnnotationParse(mathRef)
    if (cached) return cached.sidecar

    const pending = pendingAnnotationParses.get(mathRef)
    if (pending?.text === text && pending.math === math) return pending.promise

    const promise = parseSidecar(text, { mathRef, cellml: math }).then((sidecar) => {
      if (pendingAnnotationParses.get(mathRef)?.promise === promise) pendingAnnotationParses.delete(mathRef)
      if (moduleAnnotations.value.get(mathRef) === text && availableMath.value.get(mathRef) === math) {
        parsedModuleAnnotations.set(mathRef, { text, math, sidecar: markRaw(sidecar) })
        annotationParses.value += 1
      }
      return sidecar
    })
    pendingAnnotationParses.set(mathRef, { text, math, promise })
    return promise
  }

  /**
   * Adds math, keeping its layout when given one. Without a layout, any saved layout stays: the
   * text generator rewrites only the statements whose math no longer matches it.
   *
   * @param {string} mathRef
   * @param {string} rawMath
   * @param {boolean} [isOverwrite=true]
   * @param {import('cellml-text-editor').TextLayout | null} [layout]
   */
  function addMath(mathRef, rawMath, isOverwrite = true, layout = null) {
    if (!availableMath.value.has(mathRef) || isOverwrite) {
      const math = storeSeparatedMath(mathRef, rawMath)
      if (layout) setMathLayout(mathRef, layout)
      addMathHashEntry(mathRef, math)
      updateStubStatus(mathRef)
      scheduleMathAnalysis(mathRef, math)
    }
  }

  /**
   * Removes math with its defaults, layout and analysis, marking its modules as stubs.
   *
   * @param {string} mathRef
   */
  function removeMath(mathRef) {
    if (PROTECTED_MATH_REFS.has(mathRef)) return

    mathDefaults.value.delete(mathRef)
    mathLayouts.value.delete(mathRef)
    setModuleAnnotations(mathRef, null)
    pendingAnalysis.delete(mathRef)
    if (!availableMath.value.has(mathRef)) return

    removeMathHashEntry(mathRef, mathRefHash.value.get(mathRef))
    availableMath.value.delete(mathRef)
    mathRefHash.value.delete(mathRef)
    availableMathAnalysis.delete(mathRef)
    updateStubStatus(mathRef)
  }

  /**
   * Gets a copy of everything stored for a math, for restoreMathEntry.
   *
   * @param {string} mathRef
   * @returns {{ math: string, defaults: Map<string, string>, layout: Object|null, annotations: string|null } | null}
   *   Null if there is no such math.
   */
  function getMathEntry(mathRef) {
    const math = availableMath.value.get(mathRef)
    if (math === undefined) return null
    const layout = getMathLayout(mathRef)
    return {
      math,
      defaults: new Map(getMathDefaults(mathRef)),
      layout: layout && detachReactivity(layout),
      annotations: getModuleAnnotations(mathRef),
    }
  }

  /**
   * Puts a math back as getMathEntry found it, replacing its defaults, layout and sidecar, or removes it
   * when the entry is null. An entry without an annotations field keeps the sidecar.
   *
   * @param {string} mathRef
   * @param {ReturnType<typeof getMathEntry>} entry
   */
  function restoreMathEntry(mathRef, entry) {
    if (!entry) return removeMath(mathRef)

    availableMath.value.set(mathRef, entry.math)
    if (entry.defaults.size) mathDefaults.value.set(mathRef, new Map(entry.defaults))
    else mathDefaults.value.delete(mathRef)
    setMathLayout(mathRef, entry.layout && detachReactivity(entry.layout))
    if ('annotations' in entry) setModuleAnnotations(mathRef, entry.annotations)
    addMathHashEntry(mathRef, entry.math)
    updateStubStatus(mathRef)
    scheduleMathAnalysis(mathRef, entry.math)
  }

  /**
   * Adds a module for math, named `<component>:default` unless a module on other math has that ref.
   *
   * @param {string} mathRef
   * @param {Object} [options]
   * @param {Array} [options.ports] - The module's ports, else none.
   * @param {Array} [options.variables] - The module's rows, else the math's variables.
   * @returns {string|null} The module's ref, or null for protected math.
   */
  function createModuleForMath(mathRef, { ports, variables } = {}) {
    if (PROTECTED_MATH_REFS.has(mathRef)) return null

    const { componentName } = parseMathRef(mathRef)
    const moduleRef = uniqueModuleRef(`${componentName}:default`, mathRef, (ref) => availableModules.value.get(ref))
    const module = variables
      ? { moduleRef, mathRef, ports: [], variables }
      : buildModule(moduleRef, mathRef, availableMath.value.get(mathRef), getMathDefaults(mathRef))
    if (ports) module.ports = ports
    addModule(module)
    return moduleRef
  }

  // Move one moduleRef from one mathRef's Set to another
  function moveModule(moduleRef, fromMathRef, toMathRef) {
    const fromSet = availableCollections.value.get(fromMathRef)
    if (!fromSet?.has(moduleRef)) return

    fromSet.delete(moduleRef)
    if (fromSet.size === 0) availableCollections.value.delete(fromMathRef)

    ensureSet(toMathRef).add(moduleRef)
  }

  // Replace a mathRef key, carrying its entire Set over
  function updateMathRef(oldMathRef, newMathRef) {
    if (!availableCollections.value.has(oldMathRef)) return

    const existingSet = availableCollections.value.get(oldMathRef)
    existingSet.forEach((moduleRef) => {
      availableModules.value.get(moduleRef).mathRef = newMathRef
    })
    availableCollections.value.delete(oldMathRef)
    availableCollections.value.set(newMathRef, existingSet)
  }

  /**
   * Removes a module and its place in its math's collection. Stubs, whose math is missing, go too.
   *
   * @param {string} moduleRef
   */
  function removeModule(moduleRef) {
    if (!availableModules.value.has(moduleRef)) return

    const mathRef = availableModules.value.get(moduleRef).mathRef
    const set = availableCollections.value.get(mathRef)
    if (set) {
      set.delete(moduleRef)
      if (set.size === 0) availableCollections.value.delete(mathRef)
    }

    availableModules.value.delete(moduleRef)
  }

  function updateStubStatus(mathRef) {
    if (!availableCollections.value.has(mathRef)) return

    availableCollections.value.get(mathRef)?.forEach((moduleRef) => {
      const module = availableModules.value.get(moduleRef)
      if (!module) return
      if (availableMath.value.has(mathRef)) {
        delete module.isStub
      } else {
        module.isStub = true
      }
    })
  }

  function loadState(state) {
    resetState()

    if (state.availableCollections) {
      const collections = Array.isArray(state.availableCollections)
        ? state.availableCollections
        : Object.entries(state.availableCollections)

      collections.forEach(([mathRef, modules]) => {
        const iterableModules = Array.isArray(modules) ? modules : []
        availableCollections.value.set(mathRef, new Set(iterableModules))
      })
    }

    if (state.mathDefaults) {
      for (const [mathRef, values] of state.mathDefaults) mathDefaults.value.set(mathRef, new Map(values))
    }

    if (state.availableMath) {
      for (const [mathRef, rawMath] of state.availableMath) {
        const math = storeSeparatedMath(mathRef, rawMath)
        addMathHashEntry(mathRef, math)
        scheduleMathAnalysis(mathRef, math)
      }
    }

    if (state.mathLayouts) {
      // A layout only formats the math text, so one that fails validation is skipped.
      for (const [mathRef, layout] of state.mathLayouts) {
        const checked = parseLayout(JSON.stringify(layout))
        if (checked) mathLayouts.value.set(mathRef, checked)
      }
    }

    if (Array.isArray(state.moduleAnnotations)) {
      // Only [mathRef, text] entries are kept: anything else can't be a sidecar.
      for (const entry of state.moduleAnnotations) {
        if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string') {
          setModuleAnnotations(entry[0], entry[1])
        }
      }
    }

    if (state.availableModules) {
      mergeIn(new Map(state.availableModules), availableModules.value)
    }

    if (state.availableUnits) {
      mergeIntoStore(state.availableUnits, availableUnits.value)
    }

    if (state.globalConstants) {
      mergeIn(new Map(state.globalConstants), globalConstants.value)
    }
  }

  function removeCollection(componentFile) {
    delete availableCollections.value.get(componentFile)
  }

  // TODO - move to a storage of units - currently store entire units files.
  /**
   * Adds a units file, or replaces the model of the file already under its name.
   *
   * @param {{ componentFile: string, model: string }} payload
   * @param {{ replace?: boolean }} [options] - replace: false keeps a file already under the name, so a built-in
   *   units file never displaces a workspace's own one.
   */
  function addUnitsFile(payload, { replace = true } = {}) {
    const existingFile = availableUnits.value.find((f) => f.componentFile === payload.componentFile) // SMELL - units files also called component files
    if (existingFile) {
      if (replace) existingFile.model = payload.model
    } else {
      availableUnits.value.push(payload)
    }
  }

  /**
   * Adds a units made from a typed expression, or a new base units, to the generated units file, creating the file
   * if needed.
   *
   * @param {{ name: string, parts: Array<{ units: string, prefix: number, exponent: number, multiplier: number }> }} units
   *   From interpretUnitExpression, every part a CellML built-in units or a base units in the generated file; or no
   *   parts for a new base units.
   */
  function addGeneratedUnits({ name, parts }) {
    const file = availableUnits.value.find((f) => f.componentFile === GENERATED_UNITS_FILE)
    const definitions = extractUnitDefinitions(file?.model)
    definitions.set(name, parts)
    addUnitsFile({ componentFile: GENERATED_UNITS_FILE, model: unitsModelXml(definitions) })
  }

  // ---- GETTERS ----

  function getState() {
    return {
      availableCollections: Array.from(availableCollections.value.entries()).map(([key, set]) => [
        key,
        Array.from(set),
      ]),
      availableMath: Array.from(availableMath.value.entries()),
      availableModules: Array.from(availableModules.value.entries()),
      availableUnits: availableUnits.value,
      globalConstants: Array.from(globalConstants.value.entries()),
      mathDefaults: Array.from(mathDefaults.value.entries(), ([mathRef, values]) => [mathRef, Array.from(values)]),
      mathLayouts: Array.from(mathLayouts.value.entries()),
      // Until the format version that records sidecars, a library without any saves as before.
      ...(moduleAnnotations.value.size ? { moduleAnnotations: Array.from(moduleAnnotations.value.entries()) } : {}),
    }
  }

  const globalVariables = computed(() => globalConstants.value)

  const availableUnitNames = computed(() => {
    const names = new Set([...STANDARD_UNITS, ...Object.keys(AFFINE_UNIT_CONVERSIONS)])
    for (const file of availableUnits.value) {
      extractUnitNames(file.model).forEach((name) => names.add(name))
    }
    return names
  })

  /** Every library units definition, the first of each name winning. Derived, so never saved. */
  const unitDefinitions = computed(() => mergeUnitDefinitions(availableUnits.value.map((file) => file.model)))

  /** Each units name's SI base-unit expansion, for display. Derived, so never saved. */
  const unitExpansions = computed(() => expandUnits(availableUnits.value.map((file) => file.model)))

  /** Each units name expanded only as far as CellML's built-in units, e.g. "10⁻³ V". Derived, so never saved. */
  const builtInUnitExpansions = computed(() =>
    expandUnits(availableUnits.value.map((file) => file.model), { builtIn: true })
  )

  /** Base units in the generated units file, e.g. `number_of_sharks`, which new generated units can build on. */
  const generatedBaseUnits = computed(() => {
    const file = availableUnits.value.find((f) => f.componentFile === GENERATED_UNITS_FILE)
    const definitions = extractUnitDefinitions(file?.model)
    return new Set([...definitions].filter(([, parts]) => !parts.length).map(([name]) => name))
  })

  function hasUnits(name) {
    return availableUnitNames.value.has(name)
  }

  return {
    // State
    availableCollections,
    availableMath,
    mathHashIndex,
    availableModules,
    availableUnits,
    moduleAnnotations,

    // Derived State 
    globalVariables,
    availableUnitNames,
    unitExpansions,
    builtInUnitExpansions,
    unitDefinitions,
    generatedBaseUnits,

    // Actions
    addConfigFile,
    addModule,
    addMathFile,
    createModuleForMath,
    addMath,
    addUnitsFile,
    addGeneratedUnits,
    assignGlobalConstant,
    createMathHash,
    resetGlobalConstants,
    loadState,
    removeModule,
    removeCollection,
    removeGlobalConstant,
    removeMath,
    getMathEntry,
    restoreMathEntry,
    cleanupUnusedGlobalConstants,
    findMathRefByMath,
    getMathHashByRef,
    getMathRefsByHash,
    getMathAnalysis,
    ensureMathAnalysis,
    getMathDefaults,
    getMathLayout,
    setMathLayout,
    getModuleAnnotations,
    setModuleAnnotations,
    ensureModuleAnnotations,
    getParsedModuleAnnotations,

    // Query
    getGlobalConstant,
    hasUnits,
    getState,
  }
})
