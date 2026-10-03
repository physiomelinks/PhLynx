import { defineStore } from 'pinia'
import { parseLayout } from 'cellml-text-editor'
import { ref, computed, markRaw } from 'vue'
import { normaliseConfig, buildModule, parseMathRef } from '../utils/config'
import { AFFINE_UNIT_CONVERSIONS, NEW_MODULE_MATH_REF, GHOST_MATH_REF, STANDARD_UNITS } from '../utils/constants'
import { cyrb53 } from '../utils/misc'
import { expandUnits, extractUnitNames } from '../utils/units'
import { analyzeMathXml } from '../services/math/analyzeMath'
import { analyzeBatchInBackground, analyzeInBackground } from '../services/math/mathWorkerClient'
import { separateParameters } from '../services/math/separateParameters'

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
  const mathDefaults = ref(new Map())
  // mathRef -> TextLayout: the comments, blank lines and typed statements the math XML can't hold.
  const mathLayouts = ref(new Map())

  // mathRef -> MathAnalysis. Non-reactive, since analyses are large and only read imperatively.
  const availableMathAnalysis = markRaw(new Map())

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

      const module = normaliseConfig(config)
      addModule(module)
      totalAdded++
    })
    return totalAdded
  }

  function addModule(module) {
    if (!availableMath.value.has(module.mathRef) && module.mathRef !== GHOST_MATH_REF) {
      module.isStub = true
    }

    if (!availableModules.value.has(module.moduleRef)) {
      availableModules.value.set(module.moduleRef, module)
    }

    // SMELL - still only really using cellml file origin, but now extensible if we include other metadata
    updateCollections(module.mathRef, module.moduleRef)
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

  function createModuleForMath(mathRef) {
    if ([GHOST_MATH_REF, NEW_MODULE_MATH_REF].includes(mathRef)) return

    const { componentName } = parseMathRef(mathRef)
    const moduleRef = `${componentName}:default`
    const math = availableMath.value.get(mathRef)
    const module = buildModule(moduleRef, mathRef, math)
    addModule(module)
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

  function removeModule(moduleRef) {
    if (!availableModules.value.has(moduleRef)) return

    const mathRef = availableModules.value.get(moduleRef).mathRef
    const set = availableCollections.value.get(mathRef)
    if (!set) return

    set.delete(moduleRef)
    if (set.size === 0) availableCollections.value.delete(mathRef)

    availableModules.value.delete(moduleRef)
  }

  function updateStubStatus(mathRef) {
    if (!availableMath.value.has(mathRef)) return

    availableCollections.value.get(mathRef)?.forEach((moduleRef) => {
      const module = availableModules.value.get(moduleRef)
      if (module && module.isStub) {
        delete module.isStub
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
  function addUnitsFile(payload) {
    const existingFile = availableUnits.value.find((f) => f.componentFile === payload.componentFile) // SMELL - units files also called component files
    if (existingFile) {
      existingFile.model = payload.model
    } else {
      availableUnits.value.push(payload)
    }
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

  /** Each units name's SI base-unit expansion, for display. Derived, so never saved. */
  const unitExpansions = computed(() => expandUnits(availableUnits.value.map((file) => file.model)))

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

    // Derived State 
    globalVariables,
    availableUnitNames,
    unitExpansions,

    // Actions
    addConfigFile,
    addModule,
    addMathFile,
    addMath,
    addUnitsFile,
    assignGlobalConstant,
    createMathHash,
    resetGlobalConstants,
    loadState,
    removeModule,
    removeCollection,
    removeGlobalConstant,
    cleanupUnusedGlobalConstants,
    findMathRefByMath,
    getMathHashByRef,
    getMathRefsByHash,
    getMathAnalysis,
    ensureMathAnalysis,
    getMathDefaults,
    getMathLayout,
    setMathLayout,

    // Query
    getGlobalConstant,
    hasUnits,
    getState,
  }
})
