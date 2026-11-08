import { getPortVariables } from './math/reconcileRows'
import { buildInstance } from './import/buildWorkflow'
import { detachReactivity } from '../utils/reactivity'

/**
 * Gets the old ports an instance keeps on a module replacement: those whose variables all exist in the new module,
 * less any that would repeat one of its ports by label or by variables.
 *
 * @param {Array} oldPorts - The instance's ports.
 * @param {Array} newPorts - The new module's ports.
 * @param {Set<string>} variableNames - The variables an instance of the new module has.
 * @returns {Array}
 */
export function retainedPorts(oldPorts, newPorts, variableNames) {
  const variableKey = (port) => JSON.stringify([...getPortVariables([port])].sort())
  const labels = new Set(newPorts.map((port) => port.label))
  const keys = new Set(newPorts.map(variableKey))
  return (oldPorts ?? []).filter((port) => {
    const names = [...getPortVariables([port])]
    const isInMath = names.length > 0 && names.every((name) => variableNames.has(name))
    return isInMath && !labels.has(port.label) && !keys.has(variableKey(port))
  })
}

/**
 * Gets an instance's data after its module is replaced: the new module's as a fresh drop of it has them, plus, with
 * `retain`, the old ports whose variables the new math still has (see retainedPorts). Without them the instance
 * matches its new module.
 *
 * @param {Array} oldPorts - The instance's ports.
 * @param {{moduleRef: string, mathRef: string, ports: Array, variables: Array}} module - The new module.
 * @param {Object} [options]
 * @param {boolean} [options.retain=false]
 * @param {Object|null} [options.analysis=null] - The analysis of the module's math.
 * @param {Map<string, string>} [options.defaults] - The math's defaults.
 * @returns {{moduleRef: string, mathRef: string, variables: Array, ports: Array}}
 */
export function replacementData(oldPorts, module, { retain = false, analysis = null, defaults = new Map() } = {}) {
  const fresh = detachReactivity(module)
  const newPorts = fresh.ports ?? []
  const drop = (ports) => buildInstance(null, '', null, { ...fresh, ports }, [], null, analysis, defaults).data
  const dropped = drop(newPorts)
  const kept = retain ? retainedPorts(detachReactivity(oldPorts ?? []).map(({ _uid, ...port }) => port), newPorts, new Set(dropped.variables.map((row) => row.name))) : []
  const ports = [...newPorts, ...kept]
  // Kept ports carry variables the drop typed for the module's ports alone.
  const { variables } = kept.length ? drop(ports) : dropped
  return { moduleRef: fresh.moduleRef, mathRef: fresh.mathRef, variables, ports }
}
