import { PORT_TYPE_OPTIONS } from './constants'
import { toRaw } from 'vue'
import { extractVariablesFromMath } from './cellml'

export function parseMathRef(mathRef) {
  const [componentFile, componentName] = mathRef.split(':')
  return { componentFile, componentName }
}

export function parseModuleRef(moduleRef) {
  const [moduleType, moduleSubtype] = moduleRef.split(':')
  return { moduleType, moduleSubtype }
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

// Whole-port values are case-insensitive. A per-variable list is kept exactly as
// written, so it exports unchanged (see getVariableMultiportTypes).
export function parseMultiport(value) {
  if (Array.isArray(value)) return [...value]
  if (value === true) return 'True'
  if (typeof value !== 'string') return 'None'
  switch (value.toLowerCase()) {
    case 'true':
      return 'True'
    case 'sum':
      return 'Sum'
    case 'multiply':
      return 'Multiply'
    default:
      return 'None'
  }
}

function unparseMultiport(value) {
  if (value === 'None') return undefined
  if (Array.isArray(value)) return [...toRaw(value)]
  return value
}

/** Whether a port has a per-variable (list-form) multi_port. */
export function isPerVariableMultiport(port) {
  return Array.isArray(port?.multiportType)
}

/**
 * The per-variable multiport types of a list-form port, normalised to "Sum" or
 * "True", one per port variable; null for any other port.
 *
 * A "Sum" variable (normally an input) is the sum, over every module connected
 * through the port, of the neighbour's corresponding port variable. A "True"
 * variable is shared with every connected neighbour. The port accepts any number
 * of connections. Same semantics as circulatory_autogen.
 *
 * @throws {Error} when the list does not have one "sum"/"True" entry per variable.
 */
export function getVariableMultiportTypes(port) {
  if (!isPerVariableMultiport(port)) return null
  const entries = port.multiportType
  const variables = port.variables ?? []
  if (entries.length !== variables.length) {
    throw new Error(
      `Port "${port.label}" has a per-variable multi_port ${JSON.stringify(entries)} of length ` +
        `${entries.length}, but ${variables.length} variables; it needs one entry per variable.`
    )
  }
  return entries.map((entry, i) => {
    const type = parseMultiport(entry)
    if (type !== 'Sum' && type !== 'True') {
      throw new Error(
        `Port "${port.label}" has multi_port entry ${JSON.stringify(entry)} for variable ` +
          `"${variables[i]}"; per-variable entries must be "sum" or "True".`
      )
    }
    return type
  })
}

/** Display text for a port's multiportType. */
export function formatMultiportType(multiportType) {
  if (Array.isArray(multiportType)) return `Per variable: ${multiportType.join(', ')}`
  return multiportType ?? 'None'
}
