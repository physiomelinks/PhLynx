/**
 * The library's steady-state state: each math's steady-state setup (saved with the workspace, like its layout), and
 * the reduced math derived from it, cached by the math and its setup and computed in the steady-state worker.
 * Instances set to steady state use the reduced math wherever they would use their module's.
 */
import { markRaw, ref } from 'vue'

import { analyzeMathXml } from '../math/analyzeMath'
import { fillBlankValues, getPortVariables, reconcileRows } from '../math/reconcileRows'
import { cyrb53 } from '../../utils/misc'
import { analyseSteadyStateInBackground } from './steadyStateClient'
import { buildReducedModel, declarationsFromModel, reducedDefaults } from './reducedModel'

export const STEADY_STATE_KINETICS = 'steady'

/** Whether an instance runs its module at steady state. */
export const isSteadyInstance = (node) => node?.data?.kinetics === STEADY_STATE_KINETICS

/**
 * An instance's rows for its module's reduced math: its own values kept, and the rows the reduction adds (such as
 * the cycle's total) filled from the reduced math's defaults.
 *
 * @param {SteadyStateEntry} entry - A ready entry.
 * @param {Array} rows - The instance's rows.
 * @param {Array} [ports]
 * @returns {Array}
 */
export function steadyStateRows(entry, rows, ports = []) {
  const reconciled = reconcileRows(entry.analysis, rows ?? [], { portVariables: getPortVariables(ports), defaults: entry.defaults })
  return fillBlankValues(reconciled, entry.defaults)
}

/** Parameters named like transformer ratios, which a reduction recognises as multiples of F. */
const isRatioName = (name) => /^TF(_|$)/.test(name)

/** Plain data: a spec is posted to the worker and saved with the workspace. */
const plain = (value) => (value == null ? null : JSON.parse(JSON.stringify(value)))

/**
 * Whether a saved spec is usable: its cycle's states and flux are given.
 *
 * @param {*} spec
 * @returns {boolean}
 */
export function isSteadyStateSpec(spec) {
  return (
    spec !== null &&
    typeof spec === 'object' &&
    Array.isArray(spec.cycleStates) &&
    spec.cycleStates.every((name) => typeof name === 'string') &&
    (typeof spec.flux === 'string' || (spec.flux !== null && typeof spec.flux === 'object'))
  )
}

/**
 * @typedef {Object} SteadyStateEntry
 * @property {number} key - The math and setup it was derived from.
 * @property {'ready'|'error'} status
 * @property {string} [message] - Why there is no reduced math, when status is 'error'.
 * @property {Object} result - The worker's analysis (suggestions, spec used, issues, common form, numeric check).
 * @property {string} [xml] - The reduced math.
 * @property {Object|null} [layout] - Its sections, as a text layout.
 * @property {Object} [analysis] - Its MathAnalysis.
 * @property {Map<string, string>} [defaults] - Its default values.
 */

/**
 * @param {Object} options
 * @param {import('vue').Ref<Map<string, string>>} options.availableMath
 * @param {(mathRef: string) => Map<string, string>} options.getMathDefaults
 * @param {(mathRef: string) => (Object|null)} options.getMathAnalysis
 * @param {import('vue').Ref<Map>} options.unitDefinitions
 * @param {typeof analyseSteadyStateInBackground} [options.analyse] - For tests.
 */
export function createSteadyStateLibrary({ availableMath, getMathDefaults, getMathAnalysis, unitDefinitions, analyse = analyseSteadyStateInBackground }) {
  // mathRef -> the steady-state spec chosen for it. A math without one uses the first cycle found.
  const steadyStateConfigs = ref(new Map())
  // mathRef -> SteadyStateEntry. Non-reactive, like analyses; `revision` changes when one lands.
  const entries = markRaw(new Map())
  const pending = new Map() // mathRef -> { key, promise }
  const revision = ref(0)

  const keyOf = (mathRef) => {
    const math = availableMath.value.get(mathRef)
    return math === undefined ? null : cyrb53(`${math}\u0000${JSON.stringify(steadyStateConfigs.value.get(mathRef) ?? null)}`)
  }

  function getSteadyStateConfig(mathRef) {
    return steadyStateConfigs.value.get(mathRef) ?? null
  }

  /**
   * Saves a math's steady-state spec, or removes it when null, and derives its reduced math again.
   */
  function setSteadyStateConfig(mathRef, spec) {
    if (isSteadyStateSpec(spec)) steadyStateConfigs.value.set(mathRef, plain(spec))
    else steadyStateConfigs.value.delete(mathRef)
  }

  /**
   * Gets a math's reduced math, if it has been derived for its current math and setup.
   *
   * @param {string} mathRef
   * @returns {SteadyStateEntry|null}
   */
  function getSteadyState(mathRef) {
    void revision.value
    const entry = entries.get(mathRef)
    return entry && entry.key === keyOf(mathRef) ? entry : null
  }

  async function derive(mathRef, key) {
    const xml = availableMath.value.get(mathRef)
    const defaults = getMathDefaults(mathRef) ?? new Map()
    const values = {}
    for (const [name, value] of defaults) if (Number.isFinite(Number(value)) && value !== '') values[name] = Number(value)
    const result = await analyse({
      xml,
      spec: plain(steadyStateConfigs.value.get(mathRef) ?? null),
      values,
      ratios: Object.keys(values).filter(isRatioName),
    })
    if (!result?.reduced) {
      return { key, status: 'error', result, message: result?.issues?.[0]?.message ?? 'This module has no steady state.' }
    }
    const declarations = declarationsFromModel(xml)
    const built = buildReducedModel({ xml, analysis: result, unitDefinitions: unitDefinitions.value, declarations })
    if (!built) return { key, status: 'error', result, message: 'The steady-state math could not be built.' }
    if (built.unresolved.length) {
      return { key, status: 'error', result, message: `Units couldn't be worked out for ${built.unresolved.join(', ')}.` }
    }
    return {
      key,
      status: 'ready',
      result,
      xml: built.xml,
      layout: built.layout,
      analysis: analyzeMathXml(built.xml),
      defaults: reducedDefaults(defaults, declarations, result),
    }
  }

  /**
   * Derives a math's reduced math, unless it is already derived for its current math and setup.
   *
   * @param {string} mathRef
   * @returns {Promise<SteadyStateEntry|null>} Null when there's no such math.
   */
  function ensureSteadyState(mathRef) {
    const key = keyOf(mathRef)
    if (key === null) return Promise.resolve(null)
    const entry = entries.get(mathRef)
    if (entry?.key === key) return Promise.resolve(entry)
    const running = pending.get(mathRef)
    if (running?.key === key) return running.promise
    const promise = derive(mathRef, key)
      .catch((error) => ({ key, status: 'error', result: null, message: String(error?.message ?? error) }))
      .then((derived) => {
        if (pending.get(mathRef)?.promise === promise) pending.delete(mathRef)
        if (keyOf(mathRef) === key) {
          entries.set(mathRef, derived)
          revision.value++
        }
        return derived
      })
    pending.set(mathRef, { key, promise })
    return promise
  }

  /**
   * Derives the reduced math of every steady-state instance among `nodes`.
   *
   * @param {Array} nodes
   * @throws {Error} Naming the instances whose steady state can't be derived, and why.
   */
  async function ensureInstanceMath(nodes) {
    const steady = (nodes ?? []).filter(isSteadyInstance)
    const derived = await Promise.all(steady.map((node) => ensureSteadyState(node.data.mathRef)))
    const failures = steady.flatMap((node, i) =>
      derived[i]?.status === 'ready' ? [] : [`"${node.data.name ?? node.id}": ${derived[i]?.message ?? 'its module has no math.'}`]
    )
    if (failures.length) throw new Error(`These instances are set to steady state, but it can't be derived: ${failures.join('; ')}`)
  }

  /** The math an instance runs: its module's, or the reduced math when it is at steady state. */
  function getInstanceMath(node) {
    const mathRef = node?.data?.mathRef
    if (!isSteadyInstance(node)) return availableMath.value.get(mathRef) ?? null
    return getSteadyState(mathRef)?.xml ?? null
  }

  /** The analysis of the math an instance runs. */
  function getInstanceAnalysis(node) {
    if (!isSteadyInstance(node)) return getMathAnalysis(node?.data?.mathRef)
    return getSteadyState(node.data.mathRef)?.analysis ?? null
  }

  /** As getMathAnalysis, for callers that know the instance: resolveBoundaryValues. */
  function getNodeMathAnalysis(mathRef, node) {
    return node && isSteadyInstance(node) ? getInstanceAnalysis(node) : getMathAnalysis(mathRef)
  }

  /** Drops a math's setup and reduced math, as removeMath does. */
  function removeSteadyState(mathRef) {
    steadyStateConfigs.value.delete(mathRef)
    entries.delete(mathRef)
    pending.delete(mathRef)
  }

  /** Saved entries: `[mathRef, spec]`. */
  function getSteadyStateState() {
    return Array.from(steadyStateConfigs.value.entries())
  }

  /** Loads saved entries, skipping malformed ones. */
  function loadSteadyStateState(saved) {
    if (!Array.isArray(saved)) return
    for (const entry of saved) {
      if (Array.isArray(entry) && typeof entry[0] === 'string' && isSteadyStateSpec(entry[1])) steadyStateConfigs.value.set(entry[0], plain(entry[1]))
    }
  }

  function resetSteadyState() {
    steadyStateConfigs.value.clear()
    entries.clear()
    pending.clear()
  }

  return {
    steadyStateConfigs,
    getSteadyStateConfig,
    setSteadyStateConfig,
    getSteadyState,
    ensureSteadyState,
    ensureInstanceMath,
    getInstanceMath,
    getInstanceAnalysis,
    getNodeMathAnalysis,
    removeSteadyState,
    getSteadyStateState,
    loadSteadyStateState,
    resetSteadyState,
  }
}
