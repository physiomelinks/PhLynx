/**
 * parseCellMLConnections.js
 *
 * Parses a CellML 1.x/2.x file and extracts:
 *   - The connections between components as edges
 *   - The components as Vue Flow nodes (instances)
 *   - The components as normalized library modules ready for the store
 */

import { EXCLUDED_COMPONENTS, MAIN_NODE_TYPE, TIME_NAMES, TIME_UNITS } from '../../utils/constants'
import { isNumericLiteral } from '../../utils/variables'

/**
 * Lists the variables a component's math computes: each equation's left-hand side, or the variable
 * it differentiates.
 *
 * @param {Element} compElement
 * @returns {Set<string>}
 */
function getComputedVariables(compElement) {
  const computed = new Set()

  for (const mathEl of compElement.querySelectorAll('math')) {
    for (const apply of mathEl.children) {
      if (apply.tagName !== 'apply') continue
      const children = Array.from(apply.children)
      if (children[0]?.tagName !== 'eq') continue

      const lhs = children[1]
      if (lhs?.tagName === 'ci') {
        computed.add(lhs.textContent.trim())
      } else if (lhs?.tagName === 'apply') {
        // The differentiated variable, not the <bvar>'s.
        const diffCi = Array.from(lhs.children).find((child) => child.tagName === 'ci')
        if (diffCi) computed.add(diffCi.textContent.trim())
      }
    }
  }

  return computed
}

/**
 * Lists the variables a component owns: those its math computes, and those with an initial value.
 *
 * @param {Element} compElement
 * @param {Set<string>} computed - From getComputedVariables.
 * @returns {Set<string>}
 */
function getOwnedVariables(compElement, computed) {
  const owned = new Set(computed)

  for (const variable of compElement.querySelectorAll('variable')) {
    if (variable.getAttribute('initial_value') !== null) {
      const varName = variable.getAttribute('name')
      if (varName) owned.add(varName)
    }
  }

  return owned
}

/**
 * Builds a module row; a shared constant's value types it `constant`, otherwise `variable` for
 * reconcileRows to type (readers become boundary conditions).
 *
 * @param {string} name
 * @param {string} units
 * @param {string|null} sharedValue - A shared constant's value, else null.
 * @returns {Object}
 */
function buildVariableRow(name, units, sharedValue) {
  return {
    name,
    value: sharedValue,
    units,
    access: 'access',
    type: sharedValue === null ? 'variable' : 'constant',
    data_reference: null,
  }
}

/**
 * Finds the shared constants: per connected set of variables, its only owner when that owner has a
 * numeric initial value nothing computes. A set with several owners has none, so the conflict still
 * reaches checkScope.
 *
 * @param {Array<{comp1: string, var1: string, comp2: string, var2: string}>} mappings
 * @param {Map<string, Set<string>>} ownedVars - By component.
 * @param {Map<string, Map<string, string>>} constantValues - Candidate values, by component.
 * @returns {Map<string, Map<string, string>>} Each constant's value, by component.
 */
function findSharedConstants(mappings, ownedVars, constantValues) {
  const parent = new Map()
  const root = (key) => {
    while (parent.get(key) !== key) key = parent.get(key)
    return key
  }
  const add = (comp, name) => {
    const key = JSON.stringify([comp, name])
    if (!parent.has(key)) parent.set(key, key)
    return key
  }
  for (const { comp1, var1, comp2, var2 } of mappings) parent.set(root(add(comp1, var1)), root(add(comp2, var2)))

  const owners = new Map()
  for (const key of parent.keys()) {
    const [comp, name] = JSON.parse(key)
    if (!ownedVars.get(comp)?.has(name)) continue
    const set = root(key)
    owners.set(set, [...(owners.get(set) ?? []), { comp, name }])
  }

  const shared = new Map()
  for (const [owner, ...others] of owners.values()) {
    const value = constantValues.get(owner.comp)?.get(owner.name)
    if (others.length > 0 || value === undefined) continue
    if (!shared.has(owner.comp)) shared.set(owner.comp, new Map())
    shared.get(owner.comp).set(owner.name, value)
  }
  return shared
}

export function parseCellMLConnections(cellmlContent, componentFile) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(cellmlContent, 'application/xml')
  const parseError = doc.querySelector('parsererror')
  if (parseError) {
    throw new Error(`Failed to parse CellML XML: ${parseError.textContent}`)
  }

  const randomStr = Math.random().toString(36).slice(2, 11)
  const cellmlModuleSubtype = `cellml_import_${randomStr}`

  // --- 1. Detect time variable names from the environment component ---
  const excludedVarNames = new Set()
  for (const comp of doc.querySelectorAll('component')) {
    if (comp.getAttribute('name') === 'environment' || comp.getAttribute('name') === 'Environment') {
      for (const variable of comp.querySelectorAll('variable')) {
        const varName = variable.getAttribute('name')
        const varUnits = variable.getAttribute('units') ?? ''
        if (varName && (TIME_NAMES.has(varName) || TIME_UNITS.has(varUnits))) {
          excludedVarNames.add(varName)
        }
      }
      break
    }
  }

  // --- 2. Build component info, owned-variable sets and constant candidates ---
  const componentVariableInfo = new Map()
  const componentOwnedVars = new Map()
  // Numeric initial values nothing computes, by component: constants if they turn out to be shared.
  const componentConstantValues = new Map()

  for (const comp of doc.querySelectorAll('component')) {
    const compName = comp.getAttribute('name')
    if (!compName) continue

    const computed = getComputedVariables(comp)
    const varMap = new Map()
    const constantValues = new Map()
    for (const variable of comp.querySelectorAll('variable')) {
      const varName = variable.getAttribute('name')
      if (!varName) continue
      varMap.set(varName, {
        units: variable.getAttribute('units') ?? 'dimensionless',
      })
      const initialValue = variable.getAttribute('initial_value')?.trim()
      if (isNumericLiteral(initialValue) && !computed.has(varName)) constantValues.set(varName, initialValue)
    }
    componentVariableInfo.set(compName, varMap)
    componentOwnedVars.set(compName, getOwnedVariables(comp, computed))
    componentConstantValues.set(compName, constantValues)
  }

  // --- 3. Parse all <connection> blocks ---
  const pairInfoMap = new Map()
  const edgeSet = new Map()
  const allMappings = []

  for (const connection of doc.querySelectorAll('connection')) {
    let comp1, comp2
    const mapComponents = connection.querySelector('map_components')
    if (mapComponents) {
      comp1 = mapComponents.getAttribute('component_1')
      comp2 = mapComponents.getAttribute('component_2')
    } else {
      comp1 = connection.getAttribute('component_1')
      comp2 = connection.getAttribute('component_2')
    }

    if (!comp1 || !comp2) continue
    if (EXCLUDED_COMPONENTS.has(comp1) || EXCLUDED_COMPONENTS.has(comp2)) continue

    const pairKey = [comp1, comp2].sort().join('|||')

    const validMappings = []
    for (const mapVar of connection.querySelectorAll('map_variables')) {
      const var1 = mapVar.getAttribute('variable_1')
      const var2 = mapVar.getAttribute('variable_2')
      if (!var1 || !var2) continue
      if (excludedVarNames.has(var1) || excludedVarNames.has(var2)) continue
      validMappings.push({ var1, var2 })
    }

    if (validMappings.length === 0) continue
    allMappings.push(...validMappings.map(({ var1, var2 }) => ({ comp1, var1, comp2, var2 })))

    if (!pairInfoMap.has(pairKey)) {
      let chosen = validMappings.find(({ var1, var2 }) => {
        const o1 = componentOwnedVars.get(comp1)?.has(var1)
        const o2 = componentOwnedVars.get(comp2)?.has(var2)
        return (o1 && !o2) || (o2 && !o1)
      }) ?? validMappings[0]

      const { var1, var2 } = chosen
      const owned1 = componentOwnedVars.get(comp1)?.has(var1)
      const owned2 = componentOwnedVars.get(comp2)?.has(var2)

      let canonicalLabel, ownerComp
      if (owned1 && !owned2) {
        canonicalLabel = var1
        ownerComp = comp1
      } else if (owned2 && !owned1) {
        canonicalLabel = var2
        ownerComp = comp2
      } else {
        canonicalLabel = [var1, var2].sort()[0]
        ownerComp = canonicalLabel === var1 ? comp1 : comp2
      }

      pairInfoMap.set(pairKey, { canonicalLabel, ownerComp, comp1, comp2, mappings: validMappings })
      edgeSet.set(pairKey, { source: comp1, target: comp2 })
    }
  }

  const sharedConstants = findSharedConstants(allMappings, componentOwnedVars, componentConstantValues)

  // --- 4. Build Component Roster ---
  const validComponentNames = [...componentVariableInfo.keys()].filter(
    (name) =>
      !EXCLUDED_COMPONENTS.has(name) &&
      [...edgeSet.values()].some(({ source, target }) => source === name || target === name)
  )

  // --- 5. Generate Nodes & Modules ---
  const nodes = []
  const modules = []

  for (const compName of validComponentNames) {
    // A. Parse Normalized Ports
    const ports = [...edgeSet.values()]
      .filter(({ source, target }) => source === compName || target === compName)
      .reduce((acc, { source, target }) => {
        const pairKey = [source, target].sort().join('|||')
        const info = pairInfoMap.get(pairKey)
        if (!info) return acc

        for (const { var1, var2 } of info.mappings) {
          const owned1 = componentOwnedVars.get(info.comp1)?.has(var1)
          const owned2 = componentOwnedVars.get(info.comp2)?.has(var2)

          let canonicalLabel, ownerComp
          if (owned1 && !owned2) {
            canonicalLabel = var1
            ownerComp = info.comp1
          } else if (owned2 && !owned1) {
            canonicalLabel = var2
            ownerComp = info.comp2
          } else {
            canonicalLabel = [var1, var2].sort()[0]
            ownerComp = canonicalLabel === var1 ? info.comp1 : info.comp2
          }

          const portLabel = `${canonicalLabel}__${ownerComp}`
          const localVar = info.comp1 === compName ? var1 : var2

          // Checking against 'label' as defined in normalisePorts
          if (!acc.some((p) => p.label === portLabel)) {
            acc.push({
              portType: 'general_ports',
              label: portLabel,
              multiportType: 'True', 
              variables: [localVar],
            })
          }
        }
        return acc
      }, [])

    // B. Parse Normalized Variables
    const constants = sharedConstants.get(compName)
    const variables = []
    for (const [varName, { units }] of componentVariableInfo.get(compName)) {
      variables.push(buildVariableRow(varName, units, constants?.get(varName) ?? null))
    }
    
    const moduleRef = `${compName}:${cellmlModuleSubtype}`
    const mathRef = `${componentFile}:${compName}`

    // C. Build Vue Flow Node
    nodes.push({
      id: compName,
      type: MAIN_NODE_TYPE,
      position: { x: 0, y: 0 }, 
      data: {
        name: compName,
        moduleRef,
        mathRef,
        variables,
        ports,
      },
    })

    // D. Build Normalized Library Module
    modules.push({
      moduleRef,
      mathRef,
      name: compName,
      variables,
      ports,
    })
  }

  // --- 6. Generate Edges ---
  const edges = [...edgeSet.keys()].map((pairKey) => {
    const { source, target } = edgeSet.get(pairKey)
    const info = pairInfoMap.get(pairKey)
    
    return {
      id: `${source}--${target}`,
      source,
      target,
      data: {
        rawMappings: info.mappings 
      }
    }
  })

  return { components: validComponentNames, nodes, modules, edges, cellmlModuleSubtype }
}
