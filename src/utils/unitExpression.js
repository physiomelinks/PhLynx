/**
 * Units expressions in UCUM's notation (`mV/ms`, `mmol/L/s`, `kg.m-3`, `mm[Hg]`, `10*3/uL`), turned into CellML
 * `<units>` definitions made only of CellML's built-in units.
 */
import { AFFINE_UNIT_CONVERSIONS, CELLML_NS, STANDARD_UNITS } from './constants'
import { getUniqueName, sanitiseName } from './identifiers'
import { PREFIX_POWERS, expandDefinition, unitSuggestions } from './units'

/** UCUM's prefix symbols and the CellML prefix each one names. */
const UCUM_PREFIXES = new Map(
  Object.entries({
    Y: 'yotta', Z: 'zetta', E: 'exa', P: 'peta', T: 'tera', G: 'giga', M: 'mega', k: 'kilo', h: 'hecto', da: 'deca',
    d: 'deci', c: 'centi', m: 'milli', u: 'micro', n: 'nano', p: 'pico', f: 'femto', a: 'atto', z: 'zepto', y: 'yocto',
  })
)

/** Each power of ten's CellML prefix name. */
const PREFIX_NAMES = new Map([...PREFIX_POWERS].filter(([name]) => name !== 'deka').map(([name, power]) => [power, name]))

const metric = (units, factor = 1) => ({ units, factor, metric: true })
const plain = (units, factor = 1) => ({ units, factor, metric: false })

/** UCUM's units symbols as `factor × CellML built-in units`. Only metric ones take a prefix. */
const UCUM_ATOMS = new Map(
  Object.entries({
    m: metric('metre'), g: metric('gram'), s: metric('second'), A: metric('ampere'), K: metric('kelvin'),
    mol: metric('mole'), cd: metric('candela'), L: metric('litre'), l: metric('litre'), Hz: metric('hertz'),
    N: metric('newton'), Pa: metric('pascal'), J: metric('joule'), W: metric('watt'), C: metric('coulomb'),
    V: metric('volt'), F: metric('farad'), Ohm: metric('ohm'), S: metric('siemens'), Wb: metric('weber'),
    T: metric('tesla'), H: metric('henry'), lm: metric('lumen'), lx: metric('lux'), Bq: metric('becquerel'),
    Gy: metric('gray'), Sv: metric('sievert'), kat: metric('katal'), rad: metric('radian'), sr: metric('steradian'),
    eq: metric('mole'), osm: metric('mole'),
    min: plain('second', 60), h: plain('second', 3600), d: plain('second', 86400),
    'm[Hg]': metric('pascal', 133322), 'm[H2O]': metric('pascal', 9806.65),
    cal: metric('joule', 4.184), bar: metric('pascal', 1e5), atm: plain('pascal', 101325),
    '%': plain('dimensionless', 0.01), '[ppm]': plain('dimensionless', 1e-6),
  })
)

// Bracketed symbols also match without their brackets, so `mmHg` and `cmH2O` are understood.
for (const [symbol, atom] of [...UCUM_ATOMS]) {
  if (symbol.includes('[')) UCUM_ATOMS.set(symbol.replace(/[[\]]/g, ''), atom)
}

/** UCUM's affine temperature symbols and the affine units each one names. */
const AFFINE_SYMBOLS = new Map([['Cel', 'celsius'], ['[degF]', 'fahrenheit'], ['degF', 'fahrenheit']])

const BUILT_IN_NAMES = new Set(STANDARD_UNITS)

/** Powers of ten that get a word, so `10*9/L` reads `giga_per_L`. */
const FACTOR_WORDS = new Map([...PREFIX_NAMES].filter(([power]) => Math.abs(power) >= 3))

class ExpressionError extends Error {}

// ── Parsing ─────────────────────────────────────────────────────────────────

const POWER_OF_TEN = /10[*^]([+-]?\d+)/y
const SYMBOL = /(?:\[[^[\]]*\]|[A-Za-z0-9_%])+(?:[+-]\d+)?/y

/** Drops `{annotations}`: one on its own counts as 1, as in `{cells}/mL`. */
function stripAnnotations(text) {
  const stripped = text.replace(/\{[^{}]*\}/g, (match, offset) => (/[A-Za-z0-9_%\]]/.test(text[offset - 1] ?? '') ? '' : '1'))
  if (/[{}]/.test(stripped)) throw new ExpressionError('Unbalanced "{"')
  return stripped
}

/**
 * Parses a units expression in UCUM's notation. `.` multiplies and `/` divides, read left to right, so `mmol/L.s` is
 * (mmol/L)·s; `(...)` groups; a trailing integer is an exponent (`m2`, `s-1`); `10*3` and plain integers are factors.
 *
 * @param {string} text
 * @returns {{ factor: number, symbols: Array<{ text: string, sign: number }> } | { error: string }}
 *   Each symbol as written, with any exponent still attached, and whether it divides (-1) or multiplies (1).
 */
export function parseUnitExpression(text) {
  const trimmed = (text ?? '').trim()
  if (!trimmed) return { error: 'Nothing to read' }
  if (/\s/.test(trimmed)) return { error: "Spaces aren't allowed; use . to multiply" }

  try {
    const source = stripAnnotations(trimmed)
    let position = 0

    const peek = () => source[position]
    const fail = (message) => {
      throw new ExpressionError(message)
    }

    const readComponent = () => {
      if (peek() === '(') {
        position += 1
        const inner = readTerm()
        if (peek() !== ')') fail('Missing ")"')
        position += 1
        if (peek() !== undefined && !'./)'.includes(peek())) fail("A bracketed group can't take an exponent")
        return inner
      }

      POWER_OF_TEN.lastIndex = position
      const power = POWER_OF_TEN.exec(source)
      if (power) {
        position = POWER_OF_TEN.lastIndex
        return { factor: 10 ** Number(power[1]), symbols: [] }
      }

      SYMBOL.lastIndex = position
      const symbol = SYMBOL.exec(source)
      if (!symbol) {
        if (peek() === undefined) fail('Expected a units after the last operator')
        fail(peek() === '^' ? 'Write the exponent straight after the units, e.g. m2 or s-1' : `Unexpected "${peek()}"`)
      }
      position = SYMBOL.lastIndex
      return /^\d+$/.test(symbol[0])
        ? { factor: Number(symbol[0]), symbols: [] }
        : { factor: 1, symbols: [{ text: symbol[0], sign: 1 }] }
    }

    const readTerm = () => {
      const term = { factor: 1, symbols: [] }
      let sign = 1
      if (peek() === '/') {
        position += 1
        sign = -1
      }
      for (;;) {
        const component = readComponent()
        term.factor *= component.factor ** sign
        term.symbols.push(...component.symbols.map((symbol) => ({ ...symbol, sign: symbol.sign * sign })))
        if (peek() !== '.' && peek() !== '/') return term
        sign = peek() === '/' ? -1 : 1
        position += 1
      }
    }

    const expression = readTerm()
    if (peek() === '^') fail('Write the exponent straight after the units, e.g. m2 or s-1')
    if (position < source.length) fail(`Unexpected "${peek()}"`)
    return expression
  } catch (error) {
    if (error instanceof ExpressionError) return { error: error.message }
    throw error
  }
}

// ── Symbols ─────────────────────────────────────────────────────────────────

/** Finds a symbol with no exponent: a library name, a UCUM symbol, or a prefix and a metric UCUM symbol. */
function lookUpSymbol(text, names) {
  if (Object.hasOwn(AFFINE_UNIT_CONVERSIONS, text)) return { affine: text }
  if (names.has(text)) return { library: text }
  if (AFFINE_SYMBOLS.has(text)) return { affine: AFFINE_SYMBOLS.get(text) }
  if (UCUM_ATOMS.has(text)) return { atom: UCUM_ATOMS.get(text), prefix: 0 }

  for (const [symbol, prefix] of UCUM_PREFIXES) {
    const atom = text.startsWith(symbol) && UCUM_ATOMS.get(text.slice(symbol.length))
    if (atom?.metric) return { atom, prefix: PREFIX_POWERS.get(prefix) }
  }
  return null
}

/**
 * Resolves one symbol of an expression. Library names come first, so `Hz2` stays the library's units; only when the
 * whole symbol isn't known is a trailing integer read as its exponent.
 *
 * @param {string} text - The symbol as written, e.g. `mV`, `s-1` or `mm[Hg]`.
 * @param {Set<string>} names - Every library and built-in units name.
 * @returns {{ label: string, exponent: number, library?: string, affine?: string, atom?: Object, prefix?: number } | null}
 */
export function resolveSymbol(text, names) {
  const whole = lookUpSymbol(text, names)
  if (whole) return { ...whole, label: text, exponent: 1 }

  const split = /^(.*?[^\d+-])([+-]?\d+)$/.exec(text)
  const found = split && lookUpSymbol(split[1], names)
  return found ? { ...found, label: split[1], exponent: Number(split[2]) } : null
}

// ── Conversion ──────────────────────────────────────────────────────────────

const builtInPart = (units, prefix, exponent) => ({ units, prefix, exponent })

/**
 * Writes a library units in CellML's built-in units, as `factor × parts`.
 *
 * @returns {{ factor: number, parts: Array<{ units: string, prefix: number, exponent: number }> } | null}
 *   Null when it is unknown, cyclic, affine, or built on a base units of its own.
 */
function flattenUnits(name, definitions, visiting = new Set()) {
  if (BUILT_IN_NAMES.has(name)) return { factor: 1, parts: [builtInPart(name, 0, 1)] }
  const definition = definitions.get(name)
  if (!definition?.length || visiting.has(name)) return null

  visiting.add(name)
  const result = { factor: 1, parts: [] }
  for (const { units, prefix, exponent, multiplier } of definition) {
    if (![prefix, exponent, multiplier].every(Number.isFinite)) return null
    // Each part is multiplier × (10^prefix × units)^exponent.
    if (BUILT_IN_NAMES.has(units)) {
      result.factor *= multiplier
      result.parts.push(builtInPart(units, prefix, exponent))
      continue
    }
    const child = flattenUnits(units, definitions, visiting)
    if (!child) return null
    result.factor *= multiplier * (10 ** prefix * child.factor) ** exponent
    result.parts.push(...child.parts.map((part) => ({ ...part, exponent: part.exponent * exponent })))
  }
  visiting.delete(name)
  return result
}

/** Writes one resolved symbol, raised to its exponent, in CellML's built-in units. */
function symbolToParts(symbol, definitions) {
  const { exponent } = symbol
  if (symbol.atom) {
    const { units, factor } = symbol.atom
    return { factor: factor ** exponent, parts: [builtInPart(units, symbol.prefix, exponent)] }
  }
  const flat = flattenUnits(symbol.library, definitions)
  if (!flat) return null
  return { factor: flat.factor ** exponent, parts: flat.parts.map((part) => ({ ...part, exponent: part.exponent * exponent })) }
}

/** Merges parts with the same units and prefix, dropping the ones that cancel and any `dimensionless`. */
function mergeParts(parts) {
  const merged = new Map()
  for (const { units, prefix, exponent } of parts) {
    if (units === 'dimensionless') continue
    const key = `${units}:${prefix}`
    const existing = merged.get(key)
    if (existing) existing.exponent += exponent
    else merged.set(key, { units, prefix, exponent })
  }
  return [...merged.values()].filter((part) => Math.abs(part.exponent) > 1e-12)
}

const roundFactor = (value) => Number(value.toPrecision(12))

/** Names a factor: `giga` for 10⁹, `1e4` for other powers of ten, `2p5` otherwise; small ones divide. */
function factorTerm(factor) {
  const power = Math.round(Math.log10(factor))
  const isPower = roundFactor(10 ** power) === roundFactor(factor)
  if (isPower && FACTOR_WORDS.has(power)) return { text: FACTOR_WORDS.get(power), above: true }
  const above = factor > 1
  const size = roundFactor(above ? factor : 1 / factor)
  return { text: isPower ? `1e${Math.abs(power)}` : String(size).replace('.', 'p').replace(/[^A-Za-z0-9_]/g, ''), above }
}

/**
 * Names a units in the library's style from its symbols as written: `mV_per_ms`, `kg_per_m3`, `mmHg`, `giga_per_L`.
 *
 * @param {Array<{ label: string, exponent: number }>} symbols
 * @param {number} factor
 * @returns {string}
 */
export function nameUnits(symbols, factor) {
  const totals = new Map()
  for (const { label, exponent } of symbols) {
    const text = label.replace(/[[\]]/g, '').replace(/%/g, 'percent')
    totals.set(text, (totals.get(text) ?? 0) + exponent)
  }

  const term = ([text, exponent]) => (Math.abs(exponent) === 1 ? text : `${text}${Math.abs(exponent)}`)
  const above = [...totals].filter(([, exponent]) => exponent > 0).map(term)
  const below = [...totals].filter(([, exponent]) => exponent < 0).map(term)
  if (roundFactor(factor) !== 1) {
    const { text, above: isAbove } = factorTerm(factor)
    ;(isAbove ? above : below).unshift(text)
  }

  const name = [above.join('_'), ...below.map((text) => `per_${text}`)].filter(Boolean).join('_')
  return sanitiseName(name)
}

/**
 * Reads a units expression against the library.
 *
 * @param {string} text
 * @param {{ names: Set<string>, definitions: Map<string, Array<Object>>, expansions: Map<string, string> }} library
 *   Every units name, the library's definitions (mergeUnitDefinitions), and each name's SI expansion (expandUnits).
 * @returns {{ error: string }
 *   | { name: string, existing: true }
 *   | { name: string, parts: Array<Object>, expansion: string, equivalents: string[] }}
 *   An existing name when the expression is one, e.g. a library name or `Cel`; otherwise a new definition, made only
 *   of CellML built-in units, and the library names that expand to the same thing.
 */
export function interpretUnitExpression(text, { names, definitions, expansions }) {
  const parsed = parseUnitExpression(text)
  if (parsed.error) return parsed

  const symbols = []
  for (const { text: written, sign } of parsed.symbols) {
    const symbol = resolveSymbol(written, names)
    if (!symbol) return { error: `Unknown units "${written}"` }
    symbols.push({ ...symbol, exponent: symbol.exponent * sign })
  }

  const [only] = symbols
  if (symbols.length === 1 && parsed.factor === 1 && only.exponent === 1 && !only.atom) {
    return { name: only.library ?? only.affine, existing: true }
  }
  if (symbols.some((symbol) => symbol.affine)) return { error: "Celsius and Fahrenheit can't be combined with other units" }

  let factor = parsed.factor
  const allParts = []
  for (const symbol of symbols) {
    const written = symbolToParts(symbol, definitions)
    if (!written) return { error: `"${symbol.label}" can't be written in CellML's built-in units` }
    factor *= written.factor
    allParts.push(...written.parts)
  }
  factor = roundFactor(factor)
  if (!Number.isFinite(factor) || factor <= 0) return { error: 'The scale must be a positive number' }

  const merged = mergeParts(allParts)
  if (!merged.length && factor === 1) return { name: 'dimensionless', existing: true }
  const parts = (merged.length ? merged : [{ units: 'dimensionless', prefix: 0, exponent: 1 }]).map((part, index) => ({
    ...part,
    multiplier: index === 0 ? factor : 1,
  }))

  const expansion = expandDefinition(parts)
  const equivalents = [...expansions]
    .filter(([, other]) => other === expansion)
    .map(([name]) => name)
    .sort((a, b) => a.length - b.length || a.localeCompare(b))

  const name = nameUnits(symbols, parsed.factor) || 'units'
  if (names.has(name) && equivalents.includes(name)) return { name, existing: true }
  return { name: getUniqueName(name, names), parts, expansion, equivalents }
}

// ── Suggestions ─────────────────────────────────────────────────────────────

/**
 * Suggestions for a units field: library names matching the text, then, when the text is a units expression, the
 * library units equal to it and a new units for it.
 *
 * @param {string} typed
 * @param {{ names: Set<string>, definitions: Map<string, Array<Object>>, expansions: Map<string, string> }} library
 *   As for interpretUnitExpression.
 * @param {{ details?: Map<string, string>, builtIn?: boolean, limit?: number }} [options] - details: each name's
 *   expansion as shown; builtIn: show a new units' expansion in CellML's built-in units.
 * @returns {Array<{ value: string, detail: string, create?: { name: string, parts: Array<Object> } }>}
 *   `create` marks the new units, to add to the library when picked.
 */
export function suggestUnits(typed, library, { details = library.expansions, builtIn = false, limit = 8 } = {}) {
  const text = (typed ?? '').trim()
  const detailFor = (name) => details.get(name) ?? ''
  const items = unitSuggestions(text, library.names, limit).map((name) => ({ value: name, detail: detailFor(name) }))
  const listed = new Set(items.map((item) => item.value))
  if (!text) return items

  const result = interpretUnitExpression(text, library)
  if (result.error || (result.existing && result.name === text)) return items

  if (result.existing) {
    if (!listed.has(result.name)) items.unshift({ value: result.name, detail: detailFor(result.name) })
    return items.slice(0, limit)
  }

  const extra = result.equivalents
    .filter((name) => !listed.has(name))
    .slice(0, 3)
    .map((name) => ({ value: name, detail: `same as ${text} · ${detailFor(name)}` }))
  const create = {
    value: result.name,
    detail: `new · ${expandDefinition(result.parts, { builtIn })}`,
    create: { name: result.name, parts: result.parts },
  }
  return [...extra, create, ...items].slice(0, limit)
}

// ── CellML ──────────────────────────────────────────────────────────────────

const formatNumber = (value) => String(roundFactor(value)).replace('e+', 'e')

/** Writes one `<unit>`, leaving out default attributes. */
function unitXml({ units, prefix = 0, exponent = 1, multiplier = 1 }) {
  const attributes = [`units="${units}"`]
  if (prefix) attributes.push(`prefix="${PREFIX_NAMES.get(prefix) ?? formatNumber(prefix)}"`)
  if (exponent !== 1) attributes.push(`exponent="${formatNumber(exponent)}"`)
  if (multiplier !== 1) attributes.push(`multiplier="${formatNumber(multiplier)}"`)
  return `<unit ${attributes.join(' ')}/>`
}

/**
 * Writes a CellML 2.0 units file.
 *
 * @param {Map<string, Array<{ units: string, prefix?: number, exponent?: number, multiplier?: number }>>} definitions
 * @returns {string}
 */
export function unitsModelXml(definitions) {
  const units = [...definitions].map(
    ([name, parts]) => `  <units name="${name}">\n${parts.map((part) => `    ${unitXml(part)}`).join('\n')}\n  </units>`
  )
  return `<?xml version="1.0" encoding="UTF-8"?>\n<model xmlns="${CELLML_NS}" name="generated_units">\n${units.join('\n')}\n</model>\n`
}
