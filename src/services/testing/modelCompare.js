/**
 * Test support: compares two CellML models by what they mean rather than how they are written.
 *
 * areModelsEquivalent (utils/cellml.js) asks libcellml whether two models are equal, which depends on the order of
 * components, connections and equations and on every name. These helpers compare a canonical form instead
 * (canonicalModel, compareCanonical), or the trajectories the models simulate to (compareSimulations), so that two
 * exports of one network, written in different orders or with different names, compare equal.
 *
 * Needs libCellML initialised (see tests/vitest/helpers/libcellml-bootstrap.js) and a DOMParser (happy-dom).
 */
import { whenLibCellMLReady } from '../../utils/cellml.js'
import { BASELINE_SIMULATION_SETTINGS } from '../../utils/constants.js'
import { startSimulation } from '../simulation/engine.js'

const MATHML_NS = 'http://www.w3.org/1998/Math/MathML'
const CELLML_NS = 'http://www.cellml.org/cellml/2.0#'

// Operators whose operands can be given in any order.
const COMMUTATIVE = new Set(['plus', 'times', 'eq', 'neq', 'and', 'or', 'xor', 'max', 'min', 'gcd', 'lcm'])

// MathML elements that say nothing about the maths.
const IGNORED_MATH = new Set(['annotation', 'annotation-xml'])

// The SI prefixes CellML names, as powers of ten, so prefix="milli" and prefix="-3" read alike.
const PREFIXES = { yotta: 24, zetta: 21, exa: 18, peta: 15, tera: 12, giga: 9, mega: 6, kilo: 3, hecto: 2, deca: 1, deci: -1, centi: -2, milli: -3, micro: -6, nano: -9, pico: -12, femto: -15, atto: -18, zepto: -21, yocto: -24 }

let libcellml = null
whenLibCellMLReady().then(
  (instance) => (libcellml = instance),
  () => {}
)

let libOpenCORPromise = null

/**
 * Gives libCellML, once initialised.
 *
 * @returns {Object}
 */
function requireLibCellML() {
  if (!libcellml) throw new Error('modelCompare needs libCellML: await ensureLibCellmlReady() first.')
  return libcellml
}

/**
 * Turns a rename option into a function.
 *
 * @param {Function|Map|Object|undefined} rename - A function, or a Map or object from old names to new ones.
 * @returns {Function} Old name to new name; names it doesn't know keep their own.
 */
function toRenamer(rename) {
  if (!rename) return (name) => name
  if (typeof rename === 'function') return (name, ...rest) => rename(name, ...rest) ?? name
  if (rename instanceof Map) return (name) => rename.get(name) ?? name
  return (name) => (Object.hasOwn(rename, name) ? rename[name] : name)
}

/**
 * Normalises a number written in MathML or an initial value, so 1, 1.0 and 1e0 read alike.
 *
 * @param {string} text
 * @returns {string} The number, or the text trimmed when it isn't one.
 */
function normaliseNumber(text) {
  const trimmed = String(text).trim()
  if (trimmed === '') return trimmed
  const value = Number(trimmed)
  return Number.isNaN(value) ? trimmed : String(value)
}

/**
 * Gives an element's attribute by local name, whatever its prefix: happy-dom leaves a prefix declared below the root
 * (as on a reset's maths) in the local name.
 *
 * @param {Element} element
 * @param {string} localName
 * @returns {string|null}
 */
function attributeOf(element, localName) {
  for (const attribute of Array.from(element.attributes)) if (attribute.name.split(':').pop() === localName) return attribute.value
  return null
}

/** @param {Element} element @returns {Element[]} Its child elements. */
const childElements = (element) => Array.from(element.childNodes).filter((node) => node.nodeType === 1)

/** @param {Element} element @param {string} localName @returns {Element[]} Its child elements of that name. */
const childrenNamed = (element, localName) => childElements(element).filter((child) => child.localName === localName)

/**
 * Writes a MathML element as a canonical string: whitespace ignored, numbers normalised, identifiers renamed and,
 * optionally, the operands of commutative operators sorted. Constants such as <pi/> are written #pi, apart from a
 * variable named pi. A piecewise keeps its pieces' order: the first piece whose condition holds wins.
 *
 * @param {Element} element
 * @param {Function} renameVariable - Variable name to canonical name.
 * @param {boolean} sortCommutative
 * @param {Function} [renameUnits] - Units name to canonical name.
 * @returns {string}
 */
function mathToString(element, renameVariable, sortCommutative, renameUnits = (units) => units) {
  const name = element.localName
  const children = childElements(element).filter((child) => !IGNORED_MATH.has(child.localName))
  const write = (child) => mathToString(child, renameVariable, sortCommutative, renameUnits)

  if (name === 'ci') return renameVariable(element.textContent.trim())
  if (name === 'cn') {
    const type = attributeOf(element, 'type')
    const parts = Array.from(element.childNodes)
      .filter((node) => node.nodeType === 3)
      .map((node) => node.textContent.trim())
      .filter(Boolean)
    let value = normaliseNumber(element.textContent)
    if (type === 'e-notation' && parts.length === 2) value = String(Number(`${parts[0]}e${parts[1]}`))
    if (type === 'rational' && parts.length === 2) value = String(Number(parts[0]) / Number(parts[1]))
    const units = attributeOf(element, 'units')
    return units ? `${value}[${renameUnits(units)}]` : value
  }
  if (name === 'semantics') return children.length ? write(children[0]) : ''
  if (name === 'apply' && children.length) {
    const [operator, ...operands] = children
    const op = childElements(operator).length || operator.textContent.trim() ? write(operator) : operator.localName
    const args = operands.map(write)
    if (sortCommutative && COMMUTATIVE.has(operator.localName)) args.sort()
    return `${op}(${args.join(', ')})`
  }
  const text = children.length ? '' : element.textContent.trim()
  const args = children.map(write)
  if (args.length) return `${name}(${args.join(', ')})`
  return text ? `${name}:${text}` : `#${name}`
}

/**
 * Writes a reset as a canonical string.
 *
 * @param {Element} reset
 * @param {Function} renameVariable - Variable name to canonical name.
 * @param {boolean} sortCommutative
 * @param {Function} [renameUnits]
 * @returns {string}
 */
function resetToString(reset, renameVariable, sortCommutative, renameUnits) {
  const valueOf = (localName) =>
    childrenNamed(reset, localName)
      .flatMap((child) => childrenNamed(child, 'math'))
      .flatMap((math) => childElements(math).filter((element) => !IGNORED_MATH.has(element.localName)))
      .map((element) => mathToString(element, renameVariable, sortCommutative, renameUnits))
      .join('; ')
  const variable = renameVariable(reset.getAttribute('variable') ?? '')
  const testVariable = renameVariable(reset.getAttribute('test_variable') ?? '')
  return `reset ${variable} to ${valueOf('reset_value')} when ${testVariable} = ${valueOf('test_value')} (order ${normaliseNumber(reset.getAttribute('order') ?? '')})`
}

/**
 * Declares the cellml namespace on the maths of every reset that uses it without: libcellml's printer drops a reset's
 * maths it can't parse alone, as when cellml:units is declared only on the model.
 *
 * @param {Object} parent - A libcellml model or component.
 * @param {Function} keep - Registers a libcellml object for deletion.
 */
function declareResetNamespaces(parent, keep) {
  const declare = (math) => (math.includes('cellml:') && !math.includes('xmlns:cellml') ? math.replace(/<math\b/g, `<math xmlns:cellml="${CELLML_NS}"`) : math)
  for (let i = 0; i < parent.componentCount(); i++) {
    const component = keep(parent.componentByIndex(i))
    for (let j = 0; j < component.resetCount(); j++) {
      const reset = keep(component.reset(j))
      reset.setTestValue(declare(reset.testValue()))
      reset.setResetValue(declare(reset.resetValue()))
    }
    declareResetNamespaces(component, keep)
  }
}

/**
 * Parses a CellML string with libcellml, flattens any imports, and prints it again as CellML 2.0.
 *
 * @param {string} cellmlString
 * @param {Object<string, string>} [importSources] - The CellML of each imported file, keyed by its href.
 * @returns {string}
 */
function flattenToCellML2(cellmlString, importSources = {}) {
  const lib = requireLibCellML()
  const garbage = []
  const keep = (object) => (object && garbage.push(object), object)
  try {
    const parser = keep(new lib.Parser(false))
    const model = keep(parser.parseModel(cellmlString))
    if (!model) throw new Error('The model could not be parsed.')
    const parserErrors = Array.from({ length: parser.errorCount() }, (_, i) => {
      const issue = keep(parser.error(i))
      return issue.description()
    })
    if (parserErrors.length) throw new Error(`The model could not be parsed: ${parserErrors.join(' ')}`)

    let printable = model
    if (model.hasUnresolvedImports()) {
      const importer = keep(new lib.Importer(false))
      for (const [href, text] of Object.entries(importSources)) {
        const imported = keep(parser.parseModel(text))
        importer.addModel(imported, href)
      }
      importer.resolveImports(model, '.')
      if (model.hasUnresolvedImports()) throw new Error('The model imports files that importSources does not give.')
      printable = keep(importer.flattenModel(model))
      if (!printable || importer.errorCount()) {
        const errors = Array.from({ length: importer.errorCount() }, (_, i) => keep(importer.error(i)).description())
        throw new Error(`The model's imports could not be flattened: ${errors.join(' ')}`)
      }
    }
    declareResetNamespaces(printable, keep)
    const printer = keep(new lib.Printer())
    return printer.printModel(printable, false)
  } finally {
    garbage.reverse().forEach((object) => object.delete())
  }
}

/**
 * Groups the variables that connections join into equivalence sets: only the sets matter, not which pairs were
 * mapped, so different connection topologies giving the same sets compare alike.
 *
 * @param {Element} root - The model element.
 * @param {Function} keyOf - (componentName, variableName), as the model gives them, to a set member's key.
 * @param {Function} [isRelay] - (component, variable), by their own names: whether that variable only relays: it joins
 *   sets but is left out of them.
 * @returns {string[][]} Each set's keys sorted, the sets sorted by their first key.
 */
function equivalenceSets(root, keyOf, isRelay = () => false) {
  const parent = new Map()
  const find = (key) => {
    while (parent.get(key) !== key) {
      parent.set(key, parent.get(parent.get(key)))
      key = parent.get(key)
    }
    return key
  }
  const relayed = new Set()
  for (const connection of childrenNamed(root, 'connection')) {
    const c1 = connection.getAttribute('component_1')
    const c2 = connection.getAttribute('component_2')
    for (const map of childrenNamed(connection, 'map_variables')) {
      const a = keyOf(c1, map.getAttribute('variable_1'))
      const b = keyOf(c2, map.getAttribute('variable_2'))
      if (isRelay(c1, map.getAttribute('variable_1'))) relayed.add(a)
      if (isRelay(c2, map.getAttribute('variable_2'))) relayed.add(b)
      for (const key of [a, b]) if (!parent.has(key)) parent.set(key, key)
      const rootA = find(a)
      const rootB = find(b)
      if (rootA !== rootB) parent.set(rootA, rootB)
    }
  }
  const sets = new Map()
  for (const key of parent.keys()) {
    if (relayed.has(key)) continue
    const representative = find(key)
    if (!sets.has(representative)) sets.set(representative, [])
    sets.get(representative).push(key)
  }
  // A relay's variable joined to one other only leaves that one.
  return [...sets.values()]
    .filter((set) => set.length > 1)
    .map((set) => set.sort())
    .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))
}

/**
 * Builds a canonical, order-free form of a CellML model, to compare with another's.
 *
 * @param {string} cellmlString
 * @param {Object} [options]
 * @param {Function|Map|Object} [options.rename] - Component name to the name to compare it by.
 * @param {Function} [options.renameVariable] - (componentName, variableName) to the variable name to compare by; the
 *   component name is the model's own, before rename.
 * @param {string[]} [options.nameByConnection=[]] - Components (by either name) whose variables are named after what
 *   they connect to outside these components, as `<leaf_1/v>`: for generated components such as
 *   generated_summations, whose op_v, op_v_1... follow the order edges were exported in.
 * @param {Object<string, string>} [options.importSources] - CellML of imported files, keyed by href.
 * @param {boolean} [options.sortCommutative=true] - Sorts the operands of plus, times, eq and the like, so a + b reads
 *   as b + a.
 * @param {string[]|Function} [options.relays=[]] - Components (by either name, or a predicate on the model's own) that
 *   only pass values on, such as a hierarchical model's wrappers: left out, the variables they join joined directly.
 * @param {string[]} [options.partialRelays=[]] - Components (by either name) whose variables that no maths uses only
 *   pass values on, as relays do, such as a hierarchical model's wrappers that hold a self leaf's maths.
 * @param {boolean} [options.mergeRenamed=false] - Merges components renamed alike, rather than throwing; their variables
 *   must still compare by distinct names (see renameVariable).
 * @param {Function} [options.renameUnits] - Units name to the name to compare it by, in definitions, variables and maths.
 * @returns {{name: string, units: Object<string, string[]>, components: Object<string, Object>, equivalences: string[][],
 *   encapsulation: string[]}} Components keyed and sorted by (renamed) name, each with its variables
 *   ({units, initialValue, interface}), and its equations and resets as sorted canonical strings; equivalences as the sorted sets
 *   of `component/variable` that connections join; encapsulation as sorted `parent > child`.
 */
export function canonicalModel(
  cellmlString,
  { rename, renameVariable, nameByConnection = [], importSources, sortCommutative = true, relays = [], partialRelays = [], mergeRenamed = false, renameUnits = (units) => units } = {}
) {
  const renameComponent = toRenamer(rename)
  const givenName = renameVariable ? (component, variable) => renameVariable(component, variable) ?? variable : (_, variable) => variable

  const printed = flattenToCellML2(cellmlString, importSources)
  const doc = new DOMParser().parseFromString(printed, 'application/xml')
  const root = doc.documentElement

  const units = {}
  for (const element of childrenNamed(root, 'units')) {
    const own = element.getAttribute('name')
    const name = renameUnits(own)
    // Of units renamed alike, the one already of that name is compared.
    if (units[name] && own !== name) continue
    units[name] = childrenNamed(element, 'unit')
      .map((unit) => {
        const prefix = unit.getAttribute('prefix') ?? '0'
        const exponent = normaliseNumber(unit.getAttribute('exponent') ?? '1')
        const multiplier = normaliseNumber(unit.getAttribute('multiplier') ?? '1')
        return `${renameUnits(unit.getAttribute('units'))} prefix=${PREFIXES[prefix] ?? normaliseNumber(prefix)} exponent=${exponent} multiplier=${multiplier}`
      })
      .sort()
  }

  const componentNames = new Map()
  const nameOf = (original) => {
    if (!componentNames.has(original)) componentNames.set(original, renameComponent(original))
    return componentNames.get(original)
  }

  const relaySet = new Set(typeof relays === 'function' ? [] : relays)
  const isRelay = typeof relays === 'function' ? relays : (component) => relaySet.has(component) || relaySet.has(nameOf(component))
  // A partial relay's variables that no maths uses, nor gives an initial value.
  const partialSet = new Set(partialRelays)
  const unusedOf = new Map()
  for (const element of childrenNamed(root, 'component')) {
    const original = element.getAttribute('name')
    if (!partialSet.has(original) && !partialSet.has(nameOf(original))) continue
    const used = new Set(Array.from(element.getElementsByTagNameNS(MATHML_NS, 'ci')).map((ci) => ci.textContent.trim()))
    for (const variable of childrenNamed(element, 'variable')) {
      const initial = variable.getAttribute('initial_value')
      if (initial !== null) used.add(variable.getAttribute('name')).add(initial.trim())
    }
    unusedOf.set(original, new Set(childrenNamed(element, 'variable').map((variable) => variable.getAttribute('name')).filter((name) => !used.has(name))))
  }
  const isRelayVariable = (component, variable) => isRelay(component) || !!unusedOf.get(component)?.has(variable)

  // Variables of the components named by connection take the names of what they connect to.
  const byConnection = new Map()
  const listed = new Set(nameByConnection)
  if (listed.size) {
    const isListed = (component) => listed.has(component) || listed.has(nameOf(component))
    const listedKeys = new Set()
    const keyOf = (component, variable) => {
      const key = `${nameOf(component)}/${givenName(component, variable)}`
      if (isListed(component)) listedKeys.add(key)
      return key
    }
    for (const set of equivalenceSets(root, keyOf, isRelayVariable)) {
      const outside = set.filter((key) => !listedKeys.has(key))
      if (!outside.length) continue
      for (const key of set) if (listedKeys.has(key)) byConnection.set(key, `<${outside.join('|')}>`)
    }
  }
  const renameVar = (component, variable) => {
    const given = givenName(component, variable)
    return byConnection.get(`${nameOf(component)}/${given}`) ?? given
  }

  // Each component's variables as entries, so variables named alike by connection can be told apart once all are in.
  const components = {}
  for (const element of childrenNamed(root, 'component')) {
    const original = element.getAttribute('name')
    if (isRelay(original)) continue
    const name = nameOf(original)
    const merging = !!components[name] && mergeRenamed
    if (components[name] && !merging) throw new Error(`Components "${components[name].originalName}" and "${original}" both compare as "${name}".`)
    const rename = (v) => renameVar(original, v)
    const equationElements = childElements(element)
      .filter((child) => child.localName === 'math' && child.namespaceURI === MATHML_NS)
      .flatMap((math) => childElements(math).filter((equation) => !IGNORED_MATH.has(equation.localName)))
    // The equations a variable is in, itself written $: what tells apart two variables named alike by connection.
    const usesOf = (variable) =>
      equationElements
        .filter((equation) => Array.from(equation.getElementsByTagNameNS(MATHML_NS, 'ci')).some((ci) => ci.textContent.trim() === variable))
        .map((equation) => mathToString(equation, (v) => (v === variable ? '$' : rename(v)), sortCommutative, renameUnits))
        .sort()
        .join(' | ')
    const entries = merging ? components[name].entries : []
    for (const variable of childrenNamed(element, 'variable')) {
      const own = variable.getAttribute('name')
      if (unusedOf.get(original)?.has(own)) continue
      const initial = variable.getAttribute('initial_value')
      const number = initial === null ? null : normaliseNumber(initial)
      entries.push({
        name: rename(own),
        uses: () => usesOf(own),
        original,
        value: {
          units: renameUnits(variable.getAttribute('units')),
          initialValue: initial === null ? null : Number.isNaN(Number(number)) ? rename(initial.trim()) : number,
          interface: variable.getAttribute('interface') ?? 'none',
        },
      })
    }
    const equations = equationElements.map((equation) => mathToString(equation, rename, sortCommutative, renameUnits))
    const resets = childrenNamed(element, 'reset').map((reset) => resetToString(reset, rename, sortCommutative, renameUnits))
    if (merging) {
      equations.push(...components[name].equations)
      resets.push(...components[name].resets)
    }
    const originalName = merging ? components[name].originalName : original
    components[name] = { originalName, entries, equations: equations.sort(), resets: resets.sort() }
  }
  for (const component of Object.values(components)) {
    const counts = new Map()
    for (const { name } of component.entries) counts.set(name, (counts.get(name) ?? 0) + 1)
    const variables = {}
    for (const entry of component.entries) {
      const variableName = counts.get(entry.name) > 1 && byConnection.size ? `${entry.name} in ${entry.uses()}` : entry.name
      if (variables[variableName]) throw new Error(`Two variables of component "${entry.original}" both compare as "${variableName}".`)
      variables[variableName] = entry.value
    }
    component.variables = sortKeys(variables)
    delete component.entries
  }

  const equivalences = equivalenceSets(root, (component, variable) => `${nameOf(component)}/${renameVar(component, variable)}`, isRelayVariable)

  const encapsulation = []
  const walk = (element, parentName) => {
    for (const ref of childrenNamed(element, 'component_ref')) {
      const original = ref.getAttribute('component')
      const name = isRelay(original) ? parentName : nameOf(original)
      if (parentName && name !== parentName) encapsulation.push(`${parentName} > ${name}`)
      walk(ref, name)
    }
  }
  for (const element of childrenNamed(root, 'encapsulation')) walk(element, null)

  return { name: root.getAttribute('name'), units: sortKeys(units), components: sortKeys(components), equivalences, encapsulation: encapsulation.sort() }
}

/**
 * @param {Object} object
 * @returns {Object} A copy with its keys sorted.
 */
function sortKeys(object) {
  return Object.fromEntries(Object.keys(object).sort().map((key) => [key, object[key]]))
}

/**
 * Lists the items of one list not matched in another, counting repeats.
 *
 * @param {string[]} from
 * @param {string[]} other
 * @returns {string[]}
 */
function unmatched(from, other) {
  const counts = new Map()
  for (const item of other) counts.set(item, (counts.get(item) ?? 0) + 1)
  return from.filter((item) => {
    const count = counts.get(item) ?? 0
    if (count) counts.set(item, count - 1)
    return !count
  })
}

/**
 * Compares two CellML models by their canonical forms (see canonicalModel).
 *
 * @param {string|Object} a - CellML, or canonicalModel's result.
 * @param {string|Object} b - CellML, or canonicalModel's result.
 * @param {Object} [options]
 * @param {Function|Map|Object} [options.renameA] - A's component names to the names to compare by.
 * @param {Function|Map|Object} [options.renameB] - B's component names to the names to compare by.
 * @param {Function} [options.renameVariableA] - As canonicalModel's renameVariable, for A.
 * @param {Function} [options.renameVariableB] - As canonicalModel's renameVariable, for B.
 * @param {string[]} [options.nameByConnection] - As canonicalModel's, for both.
 * @param {Object<string, string>} [options.importSources] - CellML of imported files, keyed by href, for both.
 * @param {boolean} [options.sortCommutative=true] - As canonicalModel's.
 * @param {string[]|Function} [options.relays] - As canonicalModel's, for both.
 * @param {string[]} [options.partialRelays] - As canonicalModel's, for both.
 * @param {boolean} [options.mergeRenamed] - As canonicalModel's, for both.
 * @param {boolean} [options.equivalentUnits=false] - Compares units libcellml finds equivalent (milliV_per_V and
 *   millis_per_s) as one, named as the first of them by name: flattening an imported component takes the importing
 *   model's equivalent units for its own. Both models must be CellML.
 * @param {string[]} [options.ignore=[]] - Aspects not to compare: 'interface', 'encapsulation', 'units' (the units
 *   definitions; variables' units are always compared).
 * @param {boolean} [options.compareModelName=false] - Compares the models' names too.
 * @returns {{equal: boolean, differences: string[]}} Each difference worded for a test failure.
 */
export function compareCanonical(a, b, options = {}) {
  const { renameA, renameB, renameVariableA, renameVariableB, nameByConnection, importSources, sortCommutative = true, relays, partialRelays, mergeRenamed } = options
  const { ignore = [], compareModelName = false, equivalentUnits = false } = options
  const ignored = new Set(ignore)
  const renameUnits = equivalentUnits ? equivalentUnitsNames([a, b], importSources) : undefined
  const shared = { nameByConnection, importSources, sortCommutative, relays, partialRelays, mergeRenamed, renameUnits }
  const canonA = typeof a === 'string' ? canonicalModel(a, { rename: renameA, renameVariable: renameVariableA, ...shared }) : a
  const canonB = typeof b === 'string' ? canonicalModel(b, { rename: renameB, renameVariable: renameVariableB, ...shared }) : b
  const differences = []
  const label = (component, side) => {
    const original = side.components[component]?.originalName
    return original && original !== component ? `${component} (${original})` : component
  }

  if (compareModelName && canonA.name !== canonB.name) differences.push(`model name: "${canonA.name}" in A, "${canonB.name}" in B`)

  if (!ignored.has('units')) {
    for (const name of Object.keys(canonA.units)) if (!(name in canonB.units)) differences.push(`units ${name}: only in A`)
    for (const name of Object.keys(canonB.units)) if (!(name in canonA.units)) differences.push(`units ${name}: only in B`)
    for (const name of Object.keys(canonA.units)) {
      // Equivalent units merged under one name may be defined either way.
      if (renameUnits?.merged.has(name)) continue
      if (name in canonB.units && canonA.units[name].join('; ') !== canonB.units[name].join('; ')) {
        differences.push(`units ${name}: [${canonA.units[name].join('; ')}] in A, [${canonB.units[name].join('; ')}] in B`)
      }
    }
  }

  for (const name of Object.keys(canonA.components)) if (!(name in canonB.components)) differences.push(`component ${label(name, canonA)}: only in A`)
  for (const name of Object.keys(canonB.components)) if (!(name in canonA.components)) differences.push(`component ${label(name, canonB)}: only in B`)

  for (const [name, componentA] of Object.entries(canonA.components)) {
    const componentB = canonB.components[name]
    if (!componentB) continue
    const where = `component ${name}`
    for (const variable of Object.keys(componentA.variables)) {
      if (!(variable in componentB.variables)) differences.push(`${where}: variable ${variable} only in A`)
    }
    for (const variable of Object.keys(componentB.variables)) {
      if (!(variable in componentA.variables)) differences.push(`${where}: variable ${variable} only in B`)
    }
    for (const [variable, va] of Object.entries(componentA.variables)) {
      const vb = componentB.variables[variable]
      if (!vb) continue
      if (va.units !== vb.units) differences.push(`${where}: variable ${variable} has units ${va.units} in A, ${vb.units} in B`)
      if (va.initialValue !== vb.initialValue) {
        differences.push(`${where}: variable ${variable} has initial value ${va.initialValue ?? '(none)'} in A, ${vb.initialValue ?? '(none)'} in B`)
      }
      if (!ignored.has('interface') && va.interface !== vb.interface) {
        differences.push(`${where}: variable ${variable} has interface ${va.interface} in A, ${vb.interface} in B`)
      }
    }
    for (const equation of unmatched(componentA.equations, componentB.equations)) differences.push(`${where}: equation only in A: ${equation}`)
    for (const equation of unmatched(componentB.equations, componentA.equations)) differences.push(`${where}: equation only in B: ${equation}`)
    for (const reset of unmatched(componentA.resets, componentB.resets)) differences.push(`${where}: ${reset} only in A`)
    for (const reset of unmatched(componentB.resets, componentA.resets)) differences.push(`${where}: ${reset} only in B`)
  }

  const setsA = canonA.equivalences.map((set) => `{${set.join(', ')}}`)
  const setsB = canonB.equivalences.map((set) => `{${set.join(', ')}}`)
  for (const set of unmatched(setsA, setsB)) differences.push(`equivalent variables only in A: ${set}`)
  for (const set of unmatched(setsB, setsA)) differences.push(`equivalent variables only in B: ${set}`)

  if (!ignored.has('encapsulation')) {
    for (const edge of unmatched(canonA.encapsulation, canonB.encapsulation)) differences.push(`encapsulation only in A: ${edge}`)
    for (const edge of unmatched(canonB.encapsulation, canonA.encapsulation)) differences.push(`encapsulation only in B: ${edge}`)
  }

  return { equal: differences.length === 0, differences }
}

/**
 * Names units alike that libcellml finds equivalent, across models: each set after the first of its names.
 *
 * @param {string[]} models - CellML.
 * @param {Object<string, string>} [importSources]
 * @returns {Function} Units name to its set's name; its `merged` the set names standing for more than one units.
 */
function equivalentUnitsNames(models, importSources) {
  const lib = requireLibCellML()
  const garbage = []
  const keep = (object) => (object && garbage.push(object), object)
  try {
    const parser = keep(new lib.Parser(false))
    const all = models.flatMap((cellml) => {
      const model = keep(parser.parseModel(flattenToCellML2(cellml, importSources)))
      return Array.from({ length: model.unitsCount() }, (_, i) => keep(model.unitsByIndex(i)))
    })
    const names = new Map()
    for (const units of all) {
      if (names.has(units.name())) continue
      const match = all.find((other) => other.name() !== units.name() && names.has(other.name()) && lib.Units.equivalent(units, other))
      names.set(units.name(), match ? names.get(match.name()) : units.name())
    }
    // Each set after the first of its names.
    const first = new Map()
    const sizes = new Map()
    for (const [name, set] of names) {
      if (!first.has(set) || name < first.get(set)) first.set(set, name)
      sizes.set(set, (sizes.get(set) ?? 0) + 1)
    }
    const rename = (name) => (names.has(name) ? first.get(names.get(name)) : name)
    // The names standing for more than one units.
    rename.merged = new Set([...sizes].filter(([, size]) => size > 1).map(([set]) => first.get(set)))
    return rename
  } finally {
    garbage.reverse().forEach((object) => object.delete())
  }
}

/**
 * Gives one libOpenCOR for every comparison: a second instance in the same page breaks the first.
 *
 * @returns {Promise<Object>}
 */
function sharedLibOpenCOR() {
  if (!libOpenCORPromise) libOpenCORPromise = import('@opencor/libopencor').then(({ default: create }) => create())
  return libOpenCORPromise
}

/**
 * Renames a libOpenCOR variable name (`component/variable`) by a component rename.
 *
 * @param {string} name
 * @param {Function} renameComponent
 * @returns {string}
 */
function renameSeries(name, renameComponent) {
  const slash = name.indexOf('/')
  return slash < 0 ? name : `${renameComponent(name.slice(0, slash))}${name.slice(slash)}`
}

/**
 * Simulates two models the way the app does (engine.js's startSimulation, on libOpenCOR) and compares the
 * trajectories of their variables. A point matches when |a - b| <= absoluteTolerance + tolerance * max(|a|, |b|).
 *
 * @param {string} a - Flattened CellML.
 * @param {string} b - Flattened CellML.
 * @param {Object} [options]
 * @param {Array<string|[string, string]>} [options.variables] - libOpenCOR names (`component/variable`) to compare:
 *   one name for both models, after renameA and renameB, or a pair [name in A, name in B] as the models give them.
 *   By default, every state variable (or, for a model without ODEs, every algebraic and computed variable).
 * @param {Function|Map|Object} [options.renameA] - A's component names to the names to compare by.
 * @param {Function|Map|Object} [options.renameB] - B's component names to the names to compare by.
 * @param {number} [options.tolerance=1e-6] - Relative tolerance.
 * @param {number} [options.absoluteTolerance=1e-9]
 * @param {number} [options.endTime=1] - The time course's end.
 * @param {number} [options.pointInterval] - Defaults to a hundredth of endTime.
 * @param {Object} [options.settings] - Further simulation settings (solver, tolerance, maxSteps...), as the
 *   simulation settings store holds them.
 * @param {Object} [options.module] - A libOpenCOR module; one shared instance is created when not given.
 * @returns {Promise<{equal: boolean, maxError: number, details: Object}>} maxError is the largest absolute difference;
 *   details holds each variable's {name, nameA, nameB, maxAbsError, maxRelError, at, equal}, the names missing from
 *   either model, and the VOI's difference.
 */
export async function compareSimulations(a, b, options = {}) {
  const { variables, renameA, renameB, tolerance = 1e-6, absoluteTolerance = 1e-9, endTime = 1, pointInterval = endTime / 100, settings = {}, module } = options
  const loc = module ?? (await sharedLibOpenCOR())
  const runSettings = { ...BASELINE_SIMULATION_SETTINGS, startingPoint: 0, initialPoint: 0, endingPoint: endTime, pointInterval, ...settings }

  // One after the other: runs on one libOpenCOR must not overlap.
  const resultA = await startSimulation({ module: loc, cellml: a, settings: runSettings }).promise
  const resultB = await startSimulation({ module: loc, cellml: b, settings: runSettings }).promise

  const renamerA = toRenamer(renameA)
  const renamerB = toRenamer(renameB)
  const seriesOf = (result, renamer) => new Map([...result.variables].map(([name, series]) => [renameSeries(name, renamer), { ...series, name }]))
  const byNameA = seriesOf(resultA, renamerA)
  const byNameB = seriesOf(resultB, renamerB)

  let pairs
  if (variables) {
    pairs = variables.map((entry) =>
      Array.isArray(entry)
        ? { name: entry[0], a: [...byNameA.values()].find((s) => s.name === entry[0]), b: [...byNameB.values()].find((s) => s.name === entry[1]), wanted: entry }
        : { name: entry, a: byNameA.get(entry), b: byNameB.get(entry), wanted: [entry, entry] }
    )
  } else {
    const hasStates = [...byNameA.values(), ...byNameB.values()].some((series) => series.kind === 'state')
    const kinds = hasStates ? ['state'] : ['algebraic', 'computedConstant']
    const names = new Set([...byNameA, ...byNameB].filter(([, series]) => kinds.includes(series.kind)).map(([name]) => name))
    pairs = [...names].sort().map((name) => ({ name, a: byNameA.get(name), b: byNameB.get(name), wanted: [name, name] }))
  }

  const missing = []
  const compared = []
  let maxError = 0
  const voiA = resultA.voi.values
  const voiB = resultB.voi.values
  let voiError = voiA.length === voiB.length ? 0 : Infinity
  for (let i = 0; i < Math.min(voiA.length, voiB.length); i++) voiError = Math.max(voiError, Math.abs(voiA[i] - voiB[i]))
  for (const pair of pairs) {
    if (!pair.a || !pair.b) {
      missing.push(`${pair.name}: ${!pair.a ? `"${pair.wanted[0]}" not in A` : ''}${!pair.a && !pair.b ? ', ' : ''}${!pair.b ? `"${pair.wanted[1]}" not in B` : ''}`)
      continue
    }
    const valuesA = pair.a.values
    const valuesB = pair.b.values
    let maxAbsError = valuesA.length === valuesB.length ? 0 : Infinity
    let maxRelError = maxAbsError
    let at = null
    let equal = valuesA.length === valuesB.length
    for (let i = 0; i < Math.min(valuesA.length, valuesB.length); i++) {
      const error = Math.abs(valuesA[i] - valuesB[i])
      const scale = Math.max(Math.abs(valuesA[i]), Math.abs(valuesB[i]))
      if (Number.isNaN(error) && !(Number.isNaN(valuesA[i]) && Number.isNaN(valuesB[i]))) {
        equal = false
        maxAbsError = Infinity
        at ??= voiA[i] ?? i
        continue
      }
      if (error > maxAbsError) maxAbsError = error
      if (scale > 0 && error / scale > maxRelError) maxRelError = error / scale
      if (error > absoluteTolerance + tolerance * scale) {
        if (equal) at = voiA[i] ?? i
        equal = false
      }
    }
    maxError = Math.max(maxError, maxAbsError)
    compared.push({ name: pair.name, nameA: pair.a.name, nameB: pair.b.name, maxAbsError, maxRelError, at, equal })
  }

  const equal = missing.length === 0 && compared.length > 0 && compared.every((entry) => entry.equal) && voiError <= absoluteTolerance + tolerance * Math.abs(endTime)
  return {
    equal,
    maxError: missing.length ? Infinity : maxError,
    details: { variables: compared, missing, voiError, pointCount: [voiA.length, voiB.length], issues: { a: resultA.issues ?? [], b: resultB.issues ?? [] } },
  }
}
