/**
 * Finds the variable a protocol's parameter names, as circulatory autogen's VariableNameResolver does
 * (solver_wrappers/name_resolver.py), so PhLynx and CUFLynx read a name the same way.
 */

// The components PhLynx keeps a flattened model's parameters in. CA's resolver doesn't know them yet, and Myokit,
// merging connected variables, keeps a parameter only there; `withPhlynxComponents` adds them.
export const PHLYNX_INSTANCE_PARAMETERS = 'instance_parameters'
export const PHLYNX_GLOBAL_PARAMETERS = 'global_parameters'

/**
 * Lists the names a parameter may be under, in the order CA tries them: as given, then the conventions models hoist
 * parameters by. A name without a component has no others.
 *
 * @param {string} name - `component/variable`.
 * @param {Object} [options]
 * @param {boolean} [options.withPhlynxComponents] - Whether to try PhLynx's parameter components too, where CA tries
 *   the conventions of other generators.
 * @returns {string[]}
 */
export function findNameCandidates(name, { withPhlynxComponents = true } = {}) {
  const text = String(name).trim().replace('.', '/')
  const separator = text.indexOf('/')
  if (separator < 0) return [text]
  const component = text.slice(0, separator)
  const variable = text.slice(separator + 1)
  const bare = component.endsWith('_module') ? component.slice(0, -7) : component
  const phlynx = withPhlynxComponents
    ? [`${PHLYNX_INSTANCE_PARAMETERS}/${component}_${variable}`, `${PHLYNX_INSTANCE_PARAMETERS}/${variable}`, `${PHLYNX_GLOBAL_PARAMETERS}/${variable}`]
    : []
  return [
    text,
    `${bare}/${variable}`,
    `parameters/${variable}_${component}`,
    `parameters/${variable}_${bare}`,
    `parameters_${component}/${variable}`,
    `parameters_${bare}/${variable}`,
    `${bare}_module/${variable}`,
    `parameters/${component}_${variable}`,
    `parameters/${bare}_${variable}`,
    `parameters/${variable}`,
    `parameters_global/${variable}`,
    ...phlynx,
    variable,
  ]
}

/**
 * Resolves a parameter's name to the first of its candidates a model has.
 *
 * @param {string} name
 * @param {Function} isKnown - Whether the model has a `component/variable`.
 * @param {Object} [options] - As findNameCandidates takes.
 * @returns {string|null}
 */
export function resolveParameterName(name, isKnown, options) {
  return findNameCandidates(name, options).find((candidate) => isKnown(candidate)) ?? null
}
