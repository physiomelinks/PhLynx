/**
 * Suggests a module's annotations from its variables' units, names and equations and from where a module of its kind
 * sits: pure and local, with no lookups. A suggestion is only a starting point the modeller reviews; nothing is
 * suggested for a variable that is annotated already.
 *
 * Adapted from the guesser of the closed annotations-guess branch.
 */

import { GO, OPB, allowsSpecies, isFlowProperty, isMolarFlow, takesSpecies } from './iris.js'
import { displayLabel } from './labels.js'
import { classifyAnnotationRow } from './draft.js'
import { propertiesForUnits } from './propertyUnits.js'
import { SPECIES_ALIASES, SPECIES_TOKENS } from './species.js'
import { childElements, parseXml } from '../../utils/xmlDom.js'

const MATHML_NS = 'http://www.w3.org/1998/Math/MathML'

/** Name suffixes, after the last underscore, and the side of a membrane each means. */
export const SUFFIX_SIDES = new Map([
  ['i', GO.cytoplasm],
  ['in', GO.cytoplasm],
  ['c', GO.cytoplasm],
  ['cyt', GO.cytoplasm],
  ['o', GO.extracellularRegion],
  ['e', GO.extracellularRegion],
  ['ext', GO.extracellularRegion],
  ['out', GO.extracellularRegion],
])

// The other side of the plasma membrane.
const OTHER_SIDE = { [GO.cytoplasm]: GO.extracellularRegion, [GO.extracellularRegion]: GO.cytoplasm }

/** Whole names and the property each reads as. */
const WHOLE_NAME_PROPERTIES = new Map([
  ['V_m', OPB.electricalPotential],
  ['Vm', OPB.electricalPotential],
  ['E_m', OPB.electricalPotential],
  ['u', OPB.electricalPotential],
  ['volume', OPB.fluidVolume],
  ['area', OPB.spatialArea],
])

/** Name prefixes, before the first underscore, and the property each reads as. */
const NAME_PROPERTIES = new Map([
  ['c', OPB.concentration],
  ['conc', OPB.concentration],
  ['q', OPB.amount],
  ['n', OPB.amount],
  ['v', OPB.molarFlowRate],
  ['J', OPB.molarFlowRate],
  ['j', OPB.molarFlowRate],
  ['I', OPB.chargeFlowRate],
  ['i', OPB.chargeFlowRate],
  ['u', OPB.electricalPotential],
  ['mu', OPB.chemicalPotential],
  ['volume', OPB.fluidVolume],
  ['vol', OPB.fluidVolume],
  ['W', OPB.fluidVolume],
  ['area', OPB.spatialArea],
])

/** Name tokens that mark a parameter rather than a coupled quantity, e.g. c_Na_init or u_rev. */
const PARAMETER_TOKENS = new Set(['init', 'rev', 'ref', 'max', 'min', 'half', 'raw', 'eq', '0', 'Km'])

/** Words in a component's name that say what kind of module it is. */
const COMPONENT_NAME_KINDS = [
  [/membrane/i, 'membrane'],
  [/compartment|pool|cell|cyto|lumen|blood|capillary|interstitium|space/i, 'compartment'],
  [/transport|channel|pump|exchanger|porter|ase$/i, 'transporter'],
]

const KIND_TEXT = { compartment: 'a compartment', membrane: 'a membrane', transporter: 'a transporter' }

/**
 * Builds the species each name token stands for: the pinned symbols match by case, so 'K' is potassium but a rate
 * constant 'k' is not; names of three letters or more match in any case.
 *
 * @returns {{ symbols: Map<string, string>, names: Map<string, string> }} CURIEs by symbol and by lower-case name.
 */
function buildSpeciesTokens() {
  const symbols = new Map([...SPECIES_TOKENS].map(([curie, symbol]) => [symbol, curie]))
  const names = new Map()
  for (const { curie, aliases } of SPECIES_ALIASES) {
    for (const alias of aliases) if (alias.length >= 3 && !alias.includes(' ')) names.set(alias, curie)
  }
  for (const [symbol, curie] of symbols) if (symbol.length >= 3) names.set(symbol.toLowerCase(), curie)
  return { symbols, names }
}

const TOKENS = buildSpeciesTokens()

/**
 * Splits a variable name at its underscores.
 *
 * @param {string} name
 * @returns {{ prefix: string|null, middle: string[], suffix: string|null }} The prefix when it names a property, the
 *   suffix when it names a side, and the tokens between.
 */
export function splitVariableName(name) {
  const parts = String(name).split('_').filter(Boolean)
  const prefix = parts.length > 1 && NAME_PROPERTIES.has(parts[0]) ? parts[0] : null
  const rest = prefix ? parts.slice(1) : parts
  const last = rest[rest.length - 1]
  const suffix = rest.length > (prefix ? 0 : 1) && SUFFIX_SIDES.has(last) ? last : null
  return { prefix, middle: suffix ? rest.slice(0, -1) : rest, suffix }
}

// Splits a name token at case changes and digits, e.g. 'NaK' into 'Na' and 'K'.
const splitToken = (token) => token.match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+/g) ?? []

const findTokenSpecies = (token, learned) =>
  learned.get(token) ?? TOKENS.symbols.get(token) ?? TOKENS.names.get(token.toLowerCase()) ?? null

/**
 * Finds the species a name's middle tokens mention, a whole token before its parts.
 *
 * @param {string[]} tokens - From splitVariableName.
 * @param {Map<string, string>} learned - CURIEs by token, from the workspace's side-cars; these win.
 * @returns {Array<{ curie: string, token: string, isLearned: boolean }>}
 */
export function findNameSpecies(tokens, learned = new Map()) {
  const found = new Map()
  for (const token of tokens) {
    const whole = findTokenSpecies(token, learned)
    const matches = whole ? [[token, whole]] : splitToken(token).map((part) => [part, findTokenSpecies(part, learned)])
    for (const [part, curie] of matches) {
      if (curie && !found.has(curie)) found.set(curie, { curie, token: part, isLearned: learned.has(part) })
    }
  }
  return [...found.values()]
}

/**
 * Learns the species each name token stands for from annotated side-cars: a variable whose name has one middle token
 * and whose annotation has one species teaches that token.
 *
 * @param {Array<Object|null>} sidecars - From parseSidecar.
 * @returns {Map<string, string>}
 */
export function learnSpeciesTokens(sidecars) {
  const learned = new Map()
  for (const sidecar of sidecars) {
    for (const entry of sidecar?.variables ?? []) {
      const { middle } = splitVariableName(entry.variable)
      if (middle.length === 1 && entry.species?.length === 1 && !learned.has(middle[0])) {
        learned.set(middle[0], entry.species[0])
      }
    }
  }
  return learned
}

/**
 * The signed terms of each state's derivative: for d(x)/dt = (a - b)/W, a is +1 and b and W -1 or +1 as they sit.
 * Only sums, differences, negations, products and quotients are followed.
 *
 * @param {string} cellml - The math.
 * @returns {Map<string, Map<string, 1|-1>>} The terms by state.
 */
export function derivativeTerms(cellml) {
  const terms = new Map()
  const doc = cellml ? parseXml(cellml) : null
  if (!doc) return terms
  const children = (node) => (node ? childElements(node) : [])
  const operator = (apply) => children(apply)[0]?.localName
  const collect = (node, sign, into) => {
    if (node.localName === 'ci') {
      const name = node.textContent.trim()
      if (name && !into.has(name)) into.set(name, sign)
      return
    }
    if (node.localName !== 'apply') return
    const [, ...args] = children(node)
    const op = operator(node)
    if (op === 'plus' || op === 'times') for (const arg of args) collect(arg, sign, into)
    else if (op === 'minus') args.forEach((arg, index) => collect(arg, args.length === 1 || index ? -sign : sign, into))
    else if (op === 'divide') collect(args[0], sign, into)
  }
  for (const math of Array.from(doc.getElementsByTagNameNS(MATHML_NS, 'math'))) {
    if (math.parentNode?.localName !== 'component') continue
    for (const equation of children(math)) {
      if (equation.localName !== 'apply' || operator(equation) !== 'eq') continue
      const [, lhs, rhs] = children(equation)
      if (lhs?.localName !== 'apply' || operator(lhs) !== 'diff' || !rhs) continue
      const state = children(lhs).find((child) => child.localName === 'ci')?.textContent.trim()
      if (!state) continue
      const into = new Map()
      collect(rhs, 1, into)
      into.delete(state)
      terms.set(state, into)
    }
  }
  return terms
}

/**
 * Suggests the module's kind from its variables and its component's name.
 *
 * @param {Array<{ property: string|null, suffix: string|null, isState: boolean, species: Array }>} facts
 * @param {string} componentName
 * @returns {{ kind: string, why: string }|null}
 */
function suggestKind(facts, componentName) {
  const has = (test) => facts.some(test)
  const isFlow = (fact) => isFlowProperty(fact.property)
  const flowsInto = (side) => has((fact) => isFlow(fact) && SUFFIX_SIDES.get(fact.suffix) === side)
  if (flowsInto(GO.cytoplasm) && flowsInto(GO.extracellularRegion) && !has((fact) => fact.isState)) {
    return { kind: 'transporter', why: 'Flows on both sides of a membrane and no states' }
  }
  if (has((fact) => fact.isState && fact.property === OPB.concentration) && has((f) => f.property === OPB.fluidVolume)) {
    return { kind: 'compartment', why: 'Concentration states and a volume' }
  }
  const hasPotential = has((fact) => fact.property === OPB.electricalPotential)
  const hasNetCurrent = has((fact) => fact.property === OPB.chargeFlowRate && !fact.species.length)
  if (hasPotential && hasNetCurrent && !has((fact) => fact.property === OPB.concentration)) {
    return { kind: 'membrane', why: 'A potential and a current of no one ion' }
  }
  const named = COMPONENT_NAME_KINDS.find(([pattern]) => pattern.test(componentName ?? ''))
  return named ? { kind: named[1], why: `Its name, ${componentName}, reads as ${KIND_TEXT[named[1]]}` } : null
}

/**
 * Suggests where a quantity is, relative to a module of a kind.
 *
 * @param {Object} fact
 * @param {string|null} kind
 * @returns {{ location: string|null, from?: string|null, why: string, basis: string }|null}
 */
function suggestPlace(fact, kind) {
  const { property, suffix, species } = fact
  const side = SUFFIX_SIDES.get(suffix) ?? null
  const isNetCurrent = property === OPB.chargeFlowRate && !species.length
  if (property === OPB.electricalPotential || isNetCurrent) {
    const what = isNetCurrent ? 'current' : 'potential'
    if (kind === 'membrane') return { location: 'self', why: `A membrane’s own ${what}`, basis: 'topology' }
    if (kind === 'compartment') {
      return { location: `self+${GO.plasmaMembrane}`, why: `The ${what} of the compartment’s membrane`, basis: 'topology' }
    }
    if (kind === 'transporter') {
      return { location: GO.plasmaMembrane, why: `The ${what} of the membrane it sits in`, basis: 'topology' }
    }
    return null
  }
  if (property === OPB.spatialArea) {
    if (kind === 'compartment') return { location: `self+${GO.plasmaMembrane}`, why: 'The area of its membrane', basis: 'topology' }
    if (kind === 'membrane') return { location: 'self', why: 'A membrane’s own area', basis: 'topology' }
    if (kind === 'transporter') return { location: GO.plasmaMembrane, why: 'The area of its membrane', basis: 'topology' }
    return null
  }
  if (property === OPB.fluidVolume) {
    return kind === 'compartment' ? { location: 'self', why: 'A compartment’s own volume', basis: 'topology' } : null
  }
  if (kind === 'transporter' && side) {
    const label = displayLabel(side)
    if (!isFlowProperty(property)) return { location: side, why: `_${suffix} reads as the ${label}`, basis: 'name' }
    return {
      location: side,
      from: OTHER_SIDE[side],
      why: `_${suffix} reads as into the ${label}, so from the other side of the membrane`,
      basis: 'topology',
    }
  }
  if ((kind === 'compartment' || kind === 'membrane') && !side) {
    return { location: 'self', why: `No side suffix, so of ${KIND_TEXT[kind]} itself`, basis: 'name' }
  }
  return null
}

/**
 * Suggests annotations for a module's variables that have none.
 *
 * @param {Object} input
 * @param {Array<{ name: string, units?: string, type?: string }>} input.rows - Parameter rows.
 * @param {Map<string, string>|null} [input.kinds] - Each variable's kind, from classifyRows.
 * @param {string} [input.cellml] - The math, for the terms of each state's derivative.
 * @param {string} [input.componentName]
 * @param {string|null} [input.componentKind] - The module's kind when it has one; else one is suggested.
 * @param {Map<string, Array<Object>>} [input.unitDefinitions]
 * @param {Set<string>} [input.annotated] - Variables to leave alone.
 * @param {Array<Object|null>} [input.sidecars] - Parsed side-cars whose species teach name tokens.
 * @returns {{ componentKind: { kind: string, why: string }|null, variables: Map<string, { entry: { property: string,
 *   species: string[], location: string|null, from: string|null }, why: string[], basis: string[] }> }} basis says
 *   what each suggestion rests on: 'units', 'name', 'topology' or 'equations'.
 */
export function suggestAnnotations({
  rows = [],
  kinds = null,
  cellml = '',
  componentName = '',
  componentKind = null,
  unitDefinitions = new Map(),
  annotated = new Set(),
  sidecars = [],
} = {}) {
  const cache = new Map()
  const learned = learnSpeciesTokens(sidecars)

  const facts = rows
    .map((row) => ({ row, role: classifyAnnotationRow(row, kinds) }))
    .filter(({ role }) => role !== 'voi')
    .map(({ row, role }) => {
      const { prefix, middle, suffix } = splitVariableName(row.name)
      const byUnits = propertiesForUnits(row.units, unitDefinitions, cache)
      const byName = WHOLE_NAME_PROPERTIES.get(row.name) ?? (prefix ? NAME_PROPERTIES.get(prefix) : null) ?? null
      return {
        name: row.name,
        units: row.units,
        role,
        middle,
        suffix,
        byName,
        property: pickProperty(byUnits, byName),
        species: findNameSpecies(middle, learned),
        isState: kinds?.get(row.name) === 'state',
        isParameter: middle.some((token) => PARAMETER_TOKENS.has(token)),
      }
    })

  const suggestedKind = componentKind ? null : suggestKind(facts, componentName)
  const kind = componentKind ?? suggestedKind?.kind ?? null

  const variables = new Map()
  for (const fact of facts) {
    if (!fact.property || annotated.has(fact.name) || fact.isParameter) continue
    // A constant of a species, such as a Km, is a parameter, not a coupled quantity.
    if (fact.role === 'constant' && takesSpecies(fact.property)) continue
    const why = [unitsWhy(fact)]
    const basis = new Set(['units'])
    if (fact.byName === fact.property) basis.add('name')
    const species = allowsSpecies(fact.property) ? fact.species.map((found) => found.curie) : []
    for (const found of allowsSpecies(fact.property) ? fact.species : []) {
      why.push(`${found.token} is ${displayLabel(found.curie)}${found.isLearned ? ', as other side-cars say' : ''}`)
      basis.add('name')
    }
    const place = suggestPlace({ ...fact, species }, kind)
    if (place) {
      why.push(place.why)
      basis.add(place.basis)
    }
    variables.set(fact.name, {
      entry: { property: fact.property, species, location: place?.location ?? null, from: place?.from ?? null },
      why,
      basis,
    })
  }

  followDerivatives(variables, derivativeTerms(cellml), kind)
  carryCurrents(variables, kind)
  return {
    componentKind: suggestedKind,
    variables: new Map([...variables].map(([name, s]) => [name, { ...s, basis: [...s.basis] }])),
  }
}

/**
 * The property a variable's units and name agree on. Units decide; a name says which when its units fit more than
 * one, and a current may be written as the amount of charge it carries, so a current's name wins over a molar flow.
 *
 * @param {string[]} byUnits - The properties its units fit.
 * @param {string|null} byName - The property its name reads as.
 * @returns {string|null}
 */
function pickProperty(byUnits, byName) {
  if (byName === OPB.chargeFlowRate && byUnits.some(isMolarFlow)) return OPB.chargeFlowRate
  if (byName && byUnits.includes(byName)) return byName
  const offered = byUnits.filter((property) => property !== OPB.amountDensityFlowRate)
  return offered.length === 1 ? offered[0] : null
}

const NOUNS = {
  [OPB.concentration]: 'a concentration',
  [OPB.amount]: 'an amount',
  [OPB.molarFlowRate]: 'a molar flow',
  [OPB.chargeFlowRate]: 'a current',
  [OPB.electricalPotential]: 'a potential',
  [OPB.fluidVolume]: 'a volume',
  [OPB.spatialArea]: 'an area',
  [OPB.chemicalPotential]: 'a chemical potential',
}
const noun = (fact) => NOUNS[fact.property] ?? displayLabel(fact.property)

function unitsWhy(fact) {
  if (fact.property === OPB.chargeFlowRate && fact.byName === OPB.chargeFlowRate && !fact.units?.includes('A')) {
    return `${fact.units} is a flow, and ${fact.name} reads as a current`
  }
  return `${fact.units} is ${noun(fact)}`
}

/**
 * Follows each state's derivative: a molar flow added to d(c)/dt is a flow into the module's own place, of the state's
 * species; one taken away leaves it, so where it goes is left to the modeller.
 *
 * @param {Map<string, Object>} variables - The suggestions so far, edited in place.
 * @param {Map<string, Map<string, 1|-1>>} terms - From derivativeTerms.
 * @param {string|null} kind
 */
function followDerivatives(variables, terms, kind) {
  for (const [state, used] of terms) {
    const stateSuggestion = variables.get(state)
    for (const [name, sign] of used) {
      const flow = variables.get(name)
      if (!flow || !isMolarFlow(flow.entry.property)) continue
      if (!flow.entry.species.length && stateSuggestion?.entry.species.length) {
        flow.entry.species = [...stateSuggestion.entry.species]
        flow.why.push(`It changes d(${state})/dt, so it is of the same species`)
        flow.basis.add('equations')
      }
      if (kind !== 'compartment') continue
      if (sign > 0) {
        flow.entry.location = 'self'
        flow.entry.from = null
        flow.why.push(`It adds to d(${state})/dt, so it flows into the compartment`)
      } else {
        flow.entry.location = null
        flow.entry.from = null
        flow.why.push(`It takes from d(${state})/dt, so it leaves; choose where it goes`)
      }
      flow.basis.add('equations')
    }
  }
}

/**
 * A transporter's current of one ion crosses the membrane as that ion's molar flow does, so it takes the flow's sides
 * when its own name gives none.
 *
 * @param {Map<string, Object>} variables - Edited in place.
 * @param {string|null} kind
 */
function carryCurrents(variables, kind) {
  if (kind !== 'transporter') return
  const flows = [...variables].filter(([, { entry }]) => isMolarFlow(entry.property) && entry.from)
  for (const [, current] of variables) {
    const { entry } = current
    if (entry.property !== OPB.chargeFlowRate || entry.species.length !== 1 || entry.from) continue
    const carrier = flows.find(([, flow]) => flow.entry.species.length === 1 && flow.entry.species[0] === entry.species[0])
    if (!carrier) continue
    const [name, flow] = carrier
    entry.location = flow.entry.location
    entry.from = flow.entry.from
    current.why.push(`Carried across the membrane as ${name} is; check its sign`)
    current.basis.add('topology')
  }
}
