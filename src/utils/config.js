import { PORT_TYPE_OPTIONS } from './constants'
import { toRaw } from 'vue'
import { extractVariablesFromMath } from './cellml'
import { parseMultiport } from './multiport'
import { moduleRefOf, namespaceOfModuleRef } from './namespaces'

export function parseMathRef(mathRef) {
  const [componentFile, componentName] = mathRef.split(':')
  return { componentFile, componentName }
}

/**
 * Splits a module ref into its type, subtype and, for a module in a namespace, the namespace.
 *
 * @param {string} moduleRef - `type:subtype` or `type:subtype:namespace`.
 * @returns {{ moduleType: string, moduleSubtype: string, namespace: string|null }}
 */
export function parseModuleRef(moduleRef) {
  const [moduleType, moduleSubtype] = moduleRef.split(':')
  return { moduleType, moduleSubtype, namespace: namespaceOfModuleRef(moduleRef) }
}

/**
 * Gives a module a ref no module on other math holds. MVP user modules all kept the template's
 * `new_module:phlynx`, a user copy of a library module kept the library's ref, and two files can
 * hold components of the same name.
 *
 * @param {string} moduleRef - The ref wanted.
 * @param {string} mathRef - The math the module uses.
 * @param {(ref: string) => Object|undefined} getModule - Finds a module taken so far by its ref.
 * @returns {string} The wanted ref when it is free or names the same math, else `<component>:default`,
 *   with the subtype numbered `_2`, `_3`, ... until free. The wanted ref's namespace is kept.
 */
export function uniqueModuleRef(moduleRef, mathRef, getModule) {
  const isFree = (ref) => !getModule(ref) || getModule(ref).mathRef === mathRef
  if (isFree(moduleRef)) return moduleRef

  const { componentName } = parseMathRef(mathRef)
  const namespace = namespaceOfModuleRef(moduleRef)
  let ref = moduleRefOf(componentName, 'default', namespace)
  for (let i = 2; !isFree(ref); i++) ref = moduleRefOf(componentName, `default_${i}`, namespace)
  return ref
}

/**
 * Makes a library module from a CA module config.
 *
 * @param {Object} config - One entry of a module config file. Its `component_file` must already be
 *   the library's key for the file (see resolveComponentFile).
 * @param {Object} [options]
 * @param {string|null} [options.namespace] - The namespace the config is loaded into; qualifies the module ref.
 * @returns {Object} The module, with `defaultParameterisation` when the config names one.
 */
export function normaliseConfig(config, { namespace = null } = {}) {
  const module = {
    moduleRef: moduleRefOf(config.module_type, config.module_subtype, namespace),
    mathRef: `${config.component_file}:${config.component_type}`,
    ports: normalisePorts(config),
    variables: normaliseVariables(config.variables_and_units),
  }
  if (config.default_parameterisation) module.defaultParameterisation = config.default_parameterisation
  return module
}

export function buildModule(moduleRef, mathRef, math, defaults) {
  return {
    moduleRef: moduleRef,
    mathRef: mathRef,
    ports: [],
    variables: extractVariablesFromMath(math, true, defaults),
  }
}

// applied on import
export function normalisePorts(config) {
  const ports = []

  PORT_TYPE_OPTIONS.forEach((portType) => {
    const list = config?.[portType.value] || []
    for (const p of list) {
      ports.push({
        portType: portType.value,
        label: p.port_type, 
        variables: p.variables || [],
        multiportType: parseMultiport(p.multi_port),
      })
    }
  })
  return ports
}

// applied on export
export function restorePorts(ports) {
  const config = {}
  
  PORT_TYPE_OPTIONS.forEach((portType) => {
    config[portType.value] = []
  })

  for (const p of (ports || [])) {
    if (!config[p.portType]) {
      config[p.portType] = []
    }

    const portEntry = {
      port_type: p.label,
      variables: toRaw(p.variables) || [],
    }

    const multiPortValue = unparseMultiport(p.multiportType)
    
    if (multiPortValue !== undefined) {
      portEntry.multi_port = multiPortValue
    }

    config[p.portType].push(portEntry)
  }

  return config
}

export function normaliseVariables(RawVariablesAndUnits = []) {
  return RawVariablesAndUnits.map(([name, units, access, type]) => ({
    name,
    value: null,
    units,
    access,
    type,
    data_reference: null,
  }))
}

export function restoreVariables(variables = []) {
  return variables.map(v => [
    v.name,
    v.units,
    v.access,
    v.type
  ])
}

function unparseMultiport(value) {
  if (value === "None") return undefined
  return value
}
