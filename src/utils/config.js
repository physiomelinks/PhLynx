import { PORT_TYPE_OPTIONS } from './constants'
import { toRaw } from 'vue'
import { extractVariablesFromMath } from './cellml'
import { parseMultiport } from './multiport'

export function parseMathRef(mathRef) {
  const [componentFile, componentName] = mathRef.split(':')
  return { componentFile, componentName }
}

export function parseModuleRef(moduleRef) {
  const [moduleType, moduleSubtype] = moduleRef.split(':')
  return { moduleType, moduleSubtype }
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
 *   numbered `_2`, `_3`, ... until free.
 */
export function uniqueModuleRef(moduleRef, mathRef, getModule) {
  const isFree = (ref) => !getModule(ref) || getModule(ref).mathRef === mathRef
  if (isFree(moduleRef)) return moduleRef

  const base = `${parseMathRef(mathRef).componentName}:default`
  let ref = base
  for (let i = 2; !isFree(ref); i++) ref = `${base}_${i}`
  return ref
}

export function normaliseConfig(config) {
  return {
    moduleRef: `${config.module_type}:${config.module_subtype}`,
    mathRef: `${config.component_file}:${config.component_type}`,
    ports: normalisePorts(config),
    variables: normaliseVariables(config.variables_and_units),
  }
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
