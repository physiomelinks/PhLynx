/**
 * Seeds a new instance from a parameter set, over the values taken out of its math: math defaults < the set < edits
 * made on the instance afterwards.
 *
 * @typedef {import('../../stores/defaultParametersStore').ParamSet} ParamSet
 */
import { applyParameterValues } from '../parameters'
import { NO_PARAMETER_SET } from './sets'

const GLOBAL_TYPE = 'global_constant'

/** A Param as `applyParameterValues` takes it, or undefined while it needs a value. */
const valueOf = (param) => (param && param.value !== null ? param : undefined)

/**
 * Gives the ref an instance is seeded with: the one chosen, else its module's default; none when "None" was chosen.
 *
 * @param {{defaultParameterisation?: string}|null} module - The library module.
 * @param {string} [chosenRef] - A set's ref, or NO_PARAMETER_SET.
 * @returns {string|null}
 */
export const seedRefFor = (module, chosenRef) =>
  chosenRef === NO_PARAMETER_SET ? null : chosenRef || module?.defaultParameterisation || null

/**
 * Seeds an instance's rows from a set. Each row follows its own type: a global constant row takes the set's global
 * of that name, any other row its value, either falling back to the other list (so a `Scale_*` a file lists under
 * `global` but the config types `constant` is still applied). Computed rows and values left to be filled are skipped.
 *
 * @param {Array} variables - The instance's rows; not changed.
 * @param {ParamSet} set
 * @returns {Array} The seeded rows.
 */
export function seedVariables(variables, set) {
  const types = new Map(variables.map((row) => [row.name.trim(), row.type]))
  const valueFor = (name) => {
    const global = valueOf(set.globals.get(name))
    const value = valueOf(set.values.get(name))
    return types.get(name) === GLOBAL_TYPE ? (global ?? value) : (value ?? global)
  }
  return applyParameterValues(variables, valueFor).variables
}

/**
 * Seeds a built instance node from its parameter set, recording the set's ref on it.
 *
 * @param {Object} node - From `buildInstance`; changed.
 * @param {ParamSet|null} set
 * @returns {Object} The node.
 */
export function seedInstance(node, set) {
  if (!set) return node
  node.data.variables = seedVariables(node.data.variables, set)
  node.data.parameterisation = set.ref
  return node
}
