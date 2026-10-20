import { PORT_TYPE_OPTIONS } from './constants'
import { toRaw } from 'vue'
import { extractVariablesFromMath } from './cellml'
import { multiplyFactor, parseMultiport, variableTypes } from './multiport'

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

export function buildModule(moduleRef, mathRef, math) {
  return {
    moduleRef: moduleRef,
    mathRef: mathRef,
    ports: [],
    variables: extractVariablesFromMath(math),
  }
}

// applied on import
export function normalisePorts(config) {
  const ports = []

  PORT_TYPE_OPTIONS.forEach((portType) => {
    const list = config?.[portType.value] || []
    for (const p of list) {
      const port = {
        portType: portType.value,
        label: p.port_type,
        variables: p.variables || [],
        multiportType: parseMultiport(p.multi_port),
      }
      if (p.multiply_factor !== undefined) port.multiplyFactor = structuredClone(p.multiply_factor)
      ports.push(port)
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

    const multiPortValue = unparseMultiport(p.multiportType, p.variables)
    
    if (multiPortValue !== undefined) {
      portEntry.multi_port = multiPortValue
    }

    const factor = exportedMultiplyFactor(p)
    if (factor !== undefined) {
      portEntry.multiply_factor = factor
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

/**
 * A port's `multiply_factor` as circulatory_autogen reads it: one number when every Multiply variable has
 * the same factor, else a list aligned with the variables, null for the others (which needs CA's per-variable
 * form). Undefined for a port with no Multiply variable, as CA refuses a factor there.
 */
function exportedMultiplyFactor(port) {
  let types
  try {
    types = variableTypes(port)
  } catch {
    return undefined
  }
  const factors = types.map((type, i) => (type === 'Multiply' ? multiplyFactor(port, i) : null))
  const used = factors.filter((_, i) => types[i] === 'Multiply')
  if (!used.length) return undefined
  return new Set(used).size === 1 ? used[0] : factors
}

/**
 * A port's `multi_port`. A whole-port Sum or Multiply over several variables is written as a list, one entry
 * per variable, as CA takes the whole-port form for one variable only.
 */
function unparseMultiport(value, variables = []) {
  if (value === "None") return undefined
  if ((value === 'Sum' || value === 'Multiply') && variables.length > 1) return variables.map(() => value.toLowerCase())
  return value
}
