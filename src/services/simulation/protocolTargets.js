/**
 * Finds the model variable each parameter of a protocol sets, as libOpenCOR reports it.
 */
import { resolveParameterName } from '@physiomelinks/protocol-kit'

import { mappingKey } from './variableMapping'

// The kinds of variable libOpenCOR can change between runs.
const CHANGEABLE_KINDS = new Set(['state', 'constant'])

/**
 * Finds the variable a protocol's parameter names, whatever its kind: a node's row, when it's named
 * `instance/variable` after a node's name and one of its rows; the variable libOpenCOR reports by that name; or the
 * first of the names circulatory autogen would try for it (resolveParameterName), such as `parameters/k_decay`.
 *
 * @param {string} parameter
 * @param {Object} options
 * @param {Array<Object>} options.nodes - The scope's nodes.
 * @param {Map<string, string>} options.mapping - `nodeId::name` to the name libOpenCOR reports.
 * @param {Map<string, Object>} options.variables - The model's variables, by reported name.
 * @returns {string|null} Its reported name, or null when the model has none.
 */
export function findProtocolTarget(parameter, { nodes, mapping, variables }) {
  const separator = parameter.indexOf('/')
  const [instanceName, variableName] = [parameter.slice(0, separator), parameter.slice(separator + 1)]
  const node = separator > 0 ? nodes.find((candidate) => candidate.data?.name === instanceName) : null
  return (node && mapping.get(mappingKey(node.id, variableName))) ?? resolveParameterName(parameter, (name) => variables.has(name))
}

/**
 * Resolves a protocol's parameters (see findProtocolTarget) to the variables they set.
 *
 * @param {Object} options
 * @param {string[]} options.parameters - The protocol's parameters.
 * @param {Array<Object>} options.nodes - The scope's nodes.
 * @param {Map<string, string>} options.mapping - `nodeId::name` to the name libOpenCOR reports.
 * @param {Map<string, {kind: string}>} options.variables - The model's variables, by reported name.
 * @returns {{targets: Map<string, string>, kinds: Map<string, string>, errors: string[]}} Each parameter's reported
 *   name and kind, and why any can't be set.
 */
export function resolveProtocolTargets({ parameters, nodes, mapping, variables }) {
  const targets = new Map()
  const kinds = new Map()
  const errors = []
  for (const parameter of parameters) {
    const reported = findProtocolTarget(parameter, { nodes, mapping, variables })
    if (!reported) {
      errors.push(`The protocol sets ${parameter}, which isn't in the model being simulated.`)
      continue
    }
    const { kind } = variables.get(reported) ?? {}
    if (!CHANGEABLE_KINDS.has(kind)) {
      errors.push(`The protocol sets ${parameter}, which the model computes, so it can't be set. Only constants and states can.`)
      continue
    }
    targets.set(parameter, reported)
    kinds.set(parameter, kind)
  }
  return { targets, kinds, errors }
}
