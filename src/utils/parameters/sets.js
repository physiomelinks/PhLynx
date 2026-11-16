/**
 * Lists a math's parameter sets for the pickers that choose one: the library card and the instance editor.
 *
 * @typedef {import('../../stores/defaultParametersStore').ParamSet} ParamSet
 */

/** The library card's choice of no parameter set: a new instance takes only its math's own values. */
export const NO_PARAMETER_SET = '__none__'

/**
 * Gives the ref a picker shows: the one chosen while the math still has it, else the default while it has that.
 *
 * @param {ParamSet[]} sets - The math's sets.
 * @param {string|null|undefined} chosenRef
 * @param {string|null|undefined} defaultRef - The config's default parameterisation.
 * @returns {string|null}
 */
export function pickedRef(sets, chosenRef, defaultRef) {
  const refs = new Set(sets.map((set) => set.ref))
  if (chosenRef && refs.has(chosenRef)) return chosenRef
  return defaultRef && refs.has(defaultRef) ? defaultRef : null
}

/**
 * Gives the index of the config a library card shows until one is chosen: the first, in library order, whose default
 * parameterisation is loaded for its math, so a drag seeds the instance with it; else the first.
 *
 * @param {Array<{mathRef: string, defaultParameterisation?: string}>} modules - The card's configs.
 * @param {(mathRef: string, paramRef: string) => unknown} getSet - Gives the set loaded under a math and ref, if any.
 * @returns {number}
 */
export function preferredModuleIndex(modules, getSet) {
  const index = modules.findIndex(
    (module) => module.defaultParameterisation && getSet(module.mathRef, module.defaultParameterisation)
  )
  return Math.max(index, 0)
}

/**
 * Gives a picker's options, marking the config's default.
 *
 * @param {ParamSet[]} sets
 * @param {string|null|undefined} defaultRef
 * @returns {Array<{label: string, value: string}>}
 */
export const parameterSetOptions = (sets, defaultRef) =>
  sets.map((set) => ({ label: set.ref === defaultRef ? `${set.ref} (default)` : set.ref, value: set.ref }))

/**
 * Gives the library card's options: "None" first, then the math's sets.
 *
 * @param {ParamSet[]} sets
 * @param {string|null|undefined} defaultRef
 * @returns {Array<{label: string, value: string}>}
 */
export const cardParameterSetOptions = (sets, defaultRef) => [
  { label: 'None', value: NO_PARAMETER_SET },
  ...parameterSetOptions(sets, defaultRef),
]

/**
 * Gives a set's entries as table rows, globals first; a value still to be filled is null.
 *
 * @param {ParamSet} set
 * @returns {Array<{name: string, value: string|null, units: string, kind: 'global'|'value'}>}
 */
export function parameterSetRows(set) {
  const rows = (params, kind) =>
    [...params].map(([name, param]) => ({ name, value: param.value, units: param.units ?? '', kind }))
  return [...rows(set.globals, 'global'), ...rows(set.values, 'value')]
}

/**
 * Gives an instance's context-menu entry for re-applying one of its math's sets: a submenu listing them, the
 * instance's own checked and the config's default marked. None when the math has no sets.
 *
 * @param {ParamSet[]} sets - The math's sets.
 * @param {string|null|undefined} currentRef - The instance's `parameterisation`.
 * @param {string|null|undefined} defaultRef - Its config's default parameterisation.
 * @param {(paramRef: string) => void} apply - Re-applies a set.
 * @returns {Array<{label: string, items: Array<{label: string, checked: boolean, action: Function}>}>}
 */
export function parameterSetMenu(sets, currentRef, defaultRef, apply) {
  if (!sets.length) return []
  const items = parameterSetOptions(sets, defaultRef).map(({ label, value }) => ({
    label,
    checked: value === currentRef,
    action: () => apply(value),
  }))
  return [{ label: 'Apply Parameter Set', items }]
}
