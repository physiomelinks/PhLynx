/**
 * The instance editor's steady-state preview: the module's cycles, and its math reduced with the setup being edited,
 * derived off the main thread. The library derives the same for saved setups (see steadyStateLibrary); this one follows
 * the setup as it is edited, before it is saved.
 */
import { computed, ref, shallowRef, toRaw, watch } from 'vue'

import { analyseSteadyStateInBackground } from '../services/steadyState/steadyStateClient'
import { buildReducedModel } from '../services/steadyState/reducedModel'

const DEBOUNCE_MS = 300

/** Parameters named like transformer ratios, which a reduction recognises as multiples of F. */
const isRatioName = (name) => /^TF(_|$)/.test(name)

/**
 * @param {Object} options
 * @param {import('vue').Ref<string>} options.xml - The module's full math.
 * @param {import('vue').Ref<Array>} options.rows - Parameter rows with values, for transformer ratios.
 * @param {import('vue').Ref<Map>} options.unitDefinitions - The library's units (mergeUnitDefinitions).
 * @param {import('vue').Ref<boolean>} options.isActive - Whether anything shows the preview; work waits until it does.
 */
export function useSteadyState({ xml, rows, unitDefinitions, isActive }) {
  /** The setup being edited, or null for the first cycle found. */
  const spec = ref(null)
  const analysis = shallowRef(null)
  const isPending = ref(false)
  const error = ref('')
  let sequence = 0
  let timer = null
  let latest = Promise.resolve(null)

  const values = () => {
    const result = {}
    for (const row of rows.value ?? []) {
      const value = Number(row.value)
      if (row.value !== '' && row.value !== undefined && Number.isFinite(value)) result[row.name] = value
    }
    return result
  }

  function run() {
    const id = ++sequence
    isPending.value = true
    error.value = ''
    const known = values()
    latest = analyseSteadyStateInBackground({
      xml: xml.value,
      spec: spec.value ? structuredClone(toRaw(spec.value)) : null,
      values: known,
      ratios: Object.keys(known).filter(isRatioName),
    })
      .then((result) => {
        if (id === sequence) analysis.value = result
        return result
      })
      .catch((e) => {
        if (id === sequence) error.value = String(e?.message ?? e)
        return null
      })
      .finally(() => {
        if (id === sequence) isPending.value = false
      })
    return latest
  }

  watch(
    [xml, spec, isActive],
    () => {
      if (!isActive.value) return
      clearTimeout(timer)
      timer = setTimeout(run, DEBOUNCE_MS)
    },
    { immediate: true, deep: true }
  )

  /** The reduced math: `{ xml, layout, added, unresolved }`, or null. */
  const reduced = computed(() =>
    analysis.value?.reduced ? buildReducedModel({ xml: xml.value, analysis: analysis.value, unitDefinitions: unitDefinitions.value }) : null
  )

  /**
   * Derives the preview now, for the current math and setup.
   *
   * @returns {Promise<ReturnType<typeof buildReducedModel>>}
   */
  async function ready() {
    clearTimeout(timer)
    await run()
    return reduced.value
  }

  /**
   * The reduced math as a module of its own, named `name`, with `values` as its initial values.
   *
   * @param {string} name
   * @param {Object<string, number>} [values]
   * @returns {{ xml: string, layout: Object|null }|{ error: string }}
   */
  function buildModule(name, values = {}) {
    const current = reduced.value
    if (!current) return { error: 'There is no steady state to create a module from.' }
    if (current.unresolved.length) return { error: `Units couldn't be worked out for ${current.unresolved.join(', ')}.` }
    return (
      buildReducedModel({ xml: xml.value, analysis: analysis.value, unitDefinitions: unitDefinitions.value, componentName: name, values }) ?? {
        error: 'The steady-state module could not be built.',
      }
    )
  }

  /** Back to the first cycle found, with its suggested settings. */
  function resetSpec() {
    spec.value = null
  }

  return { spec, analysis, reduced, isPending, error, ready, run, resetSpec, buildModule }
}
