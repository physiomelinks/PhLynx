import { AFFINE_UNIT_CONVERSIONS, STANDARD_UNITS } from './constants'

export function extractUnitNames(modelXml) {
  if (typeof modelXml !== 'string' || !modelXml.trim()) return []

  const doc = new DOMParser().parseFromString(modelXml, 'application/xml')
  if (doc.querySelector('parsererror')) return []

  return Array.from(doc.documentElement.children)
    .filter((el) => el.localName === 'units')
    .map((el) => el.getAttribute('name'))
    .filter(Boolean)
}

/**
 * Ranks the units names that could complete what's typed: an exact match first, then names starting with it, then
 * names containing it, each shortest first. Matching ignores case.
 *
 * @param {string} typed
 * @param {Iterable<string>} names
 * @param {number} [limit]
 * @returns {string[]} Empty when nothing is typed, or when the only match is what's already typed.
 */
export function unitSuggestions(typed, names, limit = 8) {
  const query = (typed ?? '').trim().toLowerCase()
  if (!query) return []

  const matches = []
  for (const name of names) {
    const lower = name.toLowerCase()
    const position = lower.indexOf(query)
    if (position < 0) continue
    const rank = lower === query ? 0 : position === 0 ? 1 : 2
    matches.push({ name, rank })
  }
  matches.sort((a, b) => a.rank - b.rank || a.name.length - b.name.length || a.name.localeCompare(b.name))

  if (matches.length === 1 && matches[0].name === typed) return []
  return matches.slice(0, limit).map((match) => match.name)
}

// ── Units expansion ───────────────────────────────────────────────────────

/** CellML prefix names and their powers of ten. */
export const PREFIX_POWERS = new Map(
  Object.entries({
    yotta: 24, zetta: 21, exa: 18, peta: 15, tera: 12, giga: 9, mega: 6, kilo: 3, hecto: 2, deca: 1, deka: 1,
    deci: -1, centi: -2, milli: -3, micro: -6, nano: -9, pico: -12, femto: -15, atto: -18, zepto: -21, yocto: -24,
  })
)

const base = (dimensions, power = 0) => ({ coefficient: 1, power, dimensions, affine: false })

/** CellML's built-in units in SI base units; `power` is the power of ten (gram is 10⁻³ kg). */
const SI_UNITS = new Map(
  Object.entries({
    ampere: base({ A: 1 }),
    becquerel: base({ s: -1 }),
    candela: base({ cd: 1 }),
    coulomb: base({ s: 1, A: 1 }),
    dimensionless: base({}),
    farad: base({ kg: -1, m: -2, s: 4, A: 2 }),
    gram: base({ kg: 1 }, -3),
    gray: base({ m: 2, s: -2 }),
    henry: base({ kg: 1, m: 2, s: -2, A: -2 }),
    hertz: base({ s: -1 }),
    joule: base({ kg: 1, m: 2, s: -2 }),
    katal: base({ mol: 1, s: -1 }),
    kelvin: base({ K: 1 }),
    kilogram: base({ kg: 1 }),
    litre: base({ m: 3 }, -3),
    lumen: base({ cd: 1 }),
    lux: base({ cd: 1, m: -2 }),
    metre: base({ m: 1 }),
    mole: base({ mol: 1 }),
    newton: base({ kg: 1, m: 1, s: -2 }),
    ohm: base({ kg: 1, m: 2, s: -3, A: -2 }),
    pascal: base({ kg: 1, m: -1, s: -2 }),
    radian: base({}),
    second: base({ s: 1 }),
    siemens: base({ kg: -1, m: -2, s: 3, A: 2 }),
    sievert: base({ m: 2, s: -2 }),
    steradian: base({}),
    tesla: base({ kg: 1, s: -2, A: -1 }),
    volt: base({ kg: 1, m: 2, s: -3, A: -1 }),
    watt: base({ kg: 1, m: 2, s: -3 }),
    weber: base({ kg: 1, m: 2, s: -2, A: -1 }),
  })
)

const symbol = (unit) => base({ [unit]: 1 })

/** CellML's built-in units as themselves, so an expansion follows what the definitions wrote. */
const BUILT_IN_UNITS = new Map(
  Object.entries({
    ampere: symbol('A'),
    becquerel: symbol('Bq'),
    candela: symbol('cd'),
    celsius: symbol('°C'),
    coulomb: symbol('C'),
    dimensionless: base({}),
    fahrenheit: symbol('°F'),
    farad: symbol('F'),
    gram: symbol('g'),
    gray: symbol('Gy'),
    henry: symbol('H'),
    hertz: symbol('Hz'),
    joule: symbol('J'),
    katal: symbol('kat'),
    kelvin: symbol('K'),
    kilogram: symbol('kg'),
    litre: symbol('L'),
    lumen: symbol('lm'),
    lux: symbol('lx'),
    metre: symbol('m'),
    mole: symbol('mol'),
    newton: symbol('N'),
    ohm: symbol('Ω'),
    pascal: symbol('Pa'),
    radian: symbol('rad'),
    second: symbol('s'),
    siemens: symbol('S'),
    sievert: symbol('Sv'),
    steradian: symbol('sr'),
    tesla: symbol('T'),
    volt: symbol('V'),
    watt: symbol('W'),
    weber: symbol('Wb'),
  })
)

const SI_ORDER = ['kg', 'm', 's', 'A', 'K', 'mol', 'cd']
/** Prefix for base units a file declares itself, so a user "m" never merges with metre. */
const USER_DIMENSION = 'user:'
const SUPERSCRIPTS = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '-': '⁻' }

/** Reads a numeric attribute, treating missing or blank as the fallback. */
function readNumber(el, attribute, fallback) {
  const raw = el.getAttribute(attribute)
  return raw === null || !raw.trim() ? fallback : Number(raw)
}

function readPrefix(el) {
  const raw = el.getAttribute('prefix')
  if (raw === null || !raw.trim()) return 0
  return PREFIX_POWERS.get(raw.trim()) ?? Number(raw)
}

/**
 * Reads each `<units>` definition in a model. An empty parts list means the units is a base unit of its own.
 *
 * @param {string} modelXml
 * @returns {Map<string, Array<{ units: string, prefix: number, exponent: number, multiplier: number }>>} The first definition of each name.
 */
export function extractUnitDefinitions(modelXml) {
  const definitions = new Map()
  if (typeof modelXml !== 'string' || !modelXml.trim()) return definitions

  const doc = new DOMParser().parseFromString(modelXml, 'application/xml')
  if (doc.querySelector('parsererror')) return definitions

  for (const el of doc.documentElement.children) {
    const name = el.localName === 'units' && el.getAttribute('name')
    if (!name || definitions.has(name)) continue
    const parts =
      el.getAttribute('base_units') === 'yes'
        ? []
        : Array.from(el.children)
            .filter((child) => child.localName === 'unit')
            .map((child) => ({
              units: child.getAttribute('units') ?? '',
              prefix: readPrefix(child),
              exponent: readNumber(child, 'exponent', 1),
              multiplier: readNumber(child, 'multiplier', 1),
            }))
    definitions.set(name, parts)
  }
  return definitions
}

/** Splits a multiplier into an exact power of ten, when it is one, and what's left. */
function splitPowerOfTen(multiplier) {
  const power = Math.round(Math.log10(Math.abs(multiplier)))
  return 10 ** power === Math.abs(multiplier) ? { power, rest: Math.sign(multiplier) } : { power: 0, rest: multiplier }
}

/**
 * Expands a units name to SI base units as `coefficient × 10^power × dimensions`. Powers of ten are kept apart
 * so prefix chains stay exact.
 *
 * @param {string} name
 * @param {Map<string, Array<Object>>} definitions - From extractUnitDefinitions, across every library file.
 * @param {Map<string, Object|null>} cache - Shared across calls; also guards against cycles.
 * @param {Map<string, Object>} [leaves] - Where expansion stops: SI base units, or BUILT_IN_UNITS to keep them.
 * @returns {{ coefficient: number, power: number, dimensions: Object<string, number>, affine: boolean }|null}
 *   Null when the name is unknown, cyclic or malformed.
 */
export function resolveUnits(name, definitions, cache, leaves = SI_UNITS) {
  if (cache.has(name)) return cache.get(name)
  cache.set(name, null)

  let result = null
  const affine = AFFINE_UNIT_CONVERSIONS[name]
  if (leaves.has(name)) {
    result = leaves.get(name)
  } else if (Object.hasOwn(AFFINE_UNIT_CONVERSIONS, name)) {
    const kelvin = resolveUnits(affine.baseUnit, definitions, cache, leaves)
    if (kelvin) result = { ...kelvin, coefficient: kelvin.coefficient * affine.scale, affine: true }
  } else if (definitions.has(name)) {
    result = combineParts(name, definitions.get(name), definitions, cache, leaves)
  }

  cache.set(name, result)
  return result
}

/** Multiplies a definition's parts: each is multiplier × (10^prefix × units)^exponent. */
function combineParts(name, parts, definitions, cache, leaves) {
  if (!parts.length) return base({ [USER_DIMENSION + name]: 1 })

  const result = { coefficient: 1, power: 0, dimensions: {}, affine: false }
  for (const { units, prefix, exponent, multiplier } of parts) {
    const child = resolveUnits(units, definitions, cache, leaves)
    if (!child || !Number.isFinite(prefix) || !Number.isFinite(exponent) || !Number.isFinite(multiplier)) return null

    const scaled = splitPowerOfTen(multiplier)
    result.power += (prefix + child.power) * exponent + scaled.power
    result.coefficient *= child.coefficient ** exponent * scaled.rest
    result.affine ||= child.affine
    for (const [dimension, power] of Object.entries(child.dimensions)) {
      result.dimensions[dimension] = (result.dimensions[dimension] ?? 0) + power * exponent
    }
  }
  return Number.isFinite(result.coefficient) && result.coefficient !== 0 ? result : null
}

const superscript = (integer) => [...String(integer)].map((char) => SUPERSCRIPTS[char]).join('')
const roundTo = (value, places) => Math.round(value * 10 ** places) / 10 ** places

/** Formats the scale as "", "10", "10⁻³", "133.32" or "1.3332×10⁸". */
function formatScale(coefficient, power) {
  const whole = Math.floor(roundTo(power, 9))
  let mantissa = Math.abs(coefficient) * 10 ** (power - whole)
  let exponent = whole

  const shift = Math.floor(Math.log10(mantissa))
  mantissa = Number((mantissa / 10 ** shift).toPrecision(12))
  exponent += shift
  mantissa = Number(mantissa.toPrecision(6))
  if (mantissa >= 10) {
    mantissa /= 10
    exponent += 1
  }

  const sign = coefficient < 0 ? '-' : ''
  if (mantissa === 1 && exponent === 0) return sign
  if (mantissa === 1) return exponent === 1 ? `${sign}10` : `${sign}10${superscript(exponent)}`
  if (exponent >= -3 && exponent <= 5) return sign + String(Number(`${mantissa}e${exponent}`))
  return `${sign}${mantissa}×10${superscript(exponent)}`
}

/** Formats one term as "m", "s⁻¹" or "J^0.5". */
function formatTerm([unit, power]) {
  if (power === 1) return unit
  return Number.isInteger(power) ? unit + superscript(power) : `${unit}^${power}`
}

/**
 * Formats dimensions as "kg·m²·s⁻³": SI base units first and in SI order, or, when `written`, in the order the
 * definitions wrote them with positive powers first.
 */
function formatDimensions(dimensions, written = false) {
  const userDimensions = Object.keys(dimensions)
    .filter((dimension) => dimension.startsWith(USER_DIMENSION))
    .sort()
  const terms = (written ? Object.keys(dimensions) : [...SI_ORDER, ...userDimensions])
    .map((dimension) => [dimension.replace(USER_DIMENSION, ''), roundTo(dimensions[dimension] ?? 0, 6)])
    .filter(([, power]) => power !== 0)
  if (written) terms.sort((a, b) => (b[1] > 0) - (a[1] > 0))
  return terms.map(formatTerm).join('·')
}

/**
 * Formats an expansion from resolveUnits, e.g. "10⁻³ kg·m²·s⁻³·A⁻¹", "10⁻³ V" or "K (affine)".
 *
 * @param {{ coefficient: number, power: number, dimensions: Object<string, number>, affine: boolean }} expansion
 * @param {{ builtIn?: boolean }} [options] - builtIn: the expansion keeps CellML's built-in units, in written order.
 * @returns {string}
 */
export function formatUnitExpansion({ coefficient, power, dimensions, affine }, { builtIn = false } = {}) {
  const scale = formatScale(coefficient, power)
  const units = formatDimensions(dimensions, builtIn)
  const text = units ? [scale, units].filter(Boolean).join(' ') : scale || 'dimensionless'
  return affine ? `${text} (affine)` : text
}

/**
 * Reads the `<units>` definitions of several units files into one map.
 *
 * @param {string[]} models - Units files' XML, in library order; the first definition of a name wins.
 * @returns {Map<string, Array<{ units: string, prefix: number, exponent: number, multiplier: number }>>}
 */
export function mergeUnitDefinitions(models) {
  const definitions = new Map()
  for (const model of models) {
    for (const [name, parts] of extractUnitDefinitions(model)) {
      if (!definitions.has(name)) definitions.set(name, parts)
    }
  }
  return definitions
}

/**
 * Expands one definition whose parts are all CellML built-in units, as expandUnits would.
 *
 * @param {Array<{ units: string, prefix: number, exponent: number, multiplier: number }>} parts
 * @param {{ builtIn?: boolean }} [options] - builtIn: stop at CellML's built-in units.
 * @returns {string} The formatted expansion, or '' when a part isn't a built-in units.
 */
export function expandDefinition(parts, { builtIn = false } = {}) {
  if (!parts.length) return ''
  const expansion = combineParts('', parts, new Map(), new Map(), builtIn ? BUILT_IN_UNITS : SI_UNITS)
  return expansion ? formatUnitExpansion(expansion, { builtIn }) : ''
}

/**
 * Expands every built-in and library units name, for display: to SI base units, or only as far as CellML's
 * built-in units so "mV" reads "10⁻³ V". Built-in units are never inferred from base units.
 *
 * @param {string[]} models - Units files' XML, in library order; the first definition of a name wins.
 * @param {{ builtIn?: boolean }} [options] - builtIn: stop at CellML's built-in units.
 * @returns {Map<string, string>} Each resolvable name's formatted expansion.
 */
export function expandUnits(models, { builtIn = false } = {}) {
  const definitions = mergeUnitDefinitions(models)
  const leaves = builtIn ? BUILT_IN_UNITS : SI_UNITS
  const cache = new Map()
  const expansions = new Map()
  const names = new Set([...SI_UNITS.keys(), ...STANDARD_UNITS, ...Object.keys(AFFINE_UNIT_CONVERSIONS), ...definitions.keys()])
  for (const name of names) {
    const expansion = resolveUnits(name, definitions, cache, leaves)
    if (expansion) expansions.set(name, formatUnitExpansion(expansion, { builtIn }))
  }
  return expansions
}
