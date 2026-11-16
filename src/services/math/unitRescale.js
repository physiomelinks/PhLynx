/**
 * Rescales values when regenerated math changes a variable's units to compatible ones, e.g. a CellDL module switched
 * from SI (mole) to Cellular (fmol), so each value keeps the quantity it had.
 */
import { cleanName } from '../../utils/identifiers'
import { resolveUnits, sameDimensions } from '../../utils/units'
import { isNumericLiteral } from '../../utils/variables'

/**
 * Gets the factor taking a value in one units to another, as `coefficient × 10^power`, so a power of ten stays exact.
 *
 * @param {string} from
 * @param {string} to
 * @param {Object} definitions
 * @param {Map<string, Array<Object>>} definitions.from - The units `from` is defined among (mergeUnitDefinitions).
 * @param {Map<string, Array<Object>>} definitions.to - The units `to` is defined among.
 * @returns {{coefficient: number, power: number}|null} Null when either can't be resolved, is affine, or their
 *   dimensions differ.
 */
export function unitsFactor(from, to, { from: fromDefinitions, to: toDefinitions }) {
  const a = resolveUnits(from, fromDefinitions, new Map())
  const b = resolveUnits(to, toDefinitions, new Map())
  if (!a || !b || a.affine || b.affine || !sameDimensions(a, b)) return null
  const coefficient = a.coefficient / b.coefficient
  // A coefficient that is a power of ten after all, e.g. from a multiplier, joins the power.
  const power = Math.round(Math.log10(coefficient))
  return Math.abs(coefficient / 10 ** power - 1) < 1e-12
    ? { coefficient: 1, power: a.power - b.power + power }
    : { coefficient, power: a.power - b.power }
}

/**
 * Scales a value by a factor, shifting its decimal exponent for the power of ten, so `5e-15` × 10¹⁵ is exactly `5`.
 *
 * @param {string|number} value
 * @param {{coefficient: number, power: number}} factor
 * @returns {string|null} The scaled value, or null when the value isn't a number.
 */
export function scaleValue(value, { coefficient, power }) {
  if (!isNumericLiteral(String(value ?? '').trim())) return null
  const number = Number(value)
  if (number === 0) return String(value).trim()
  const [mantissa, exponent] = number.toExponential().split('e')
  const shifted = Number(`${mantissa}e${Number(exponent) + power}`)
  // A coefficient's rounding error, e.g. 0.1 × 3, is dropped.
  return String(coefficient === 1 ? shifted : Number((shifted * coefficient).toPrecision(15)))
}

/**
 * Formats a factor for people, e.g. `×10¹⁵` or `×1000`.
 *
 * @param {{coefficient: number, power: number}} factor
 * @returns {string}
 */
export function formatFactor({ coefficient, power }) {
  const shown = (value) => Number(value.toPrecision(6))
  if (Math.abs(power) <= 4) return `×${shown(coefficient * 10 ** power)}`
  return coefficient === 1 ? `×10${toSuperscript(power)}` : `×${shown(coefficient)}×10${toSuperscript(power)}`
}

const SUPERSCRIPTS = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '-': '⁻' }
const toSuperscript = (integer) => [...String(integer)].map((char) => SUPERSCRIPTS[char]).join('')

/** Whether a factor changes values. */
export const isIdentityFactor = ({ coefficient, power }) => coefficient === 1 && power === 0

/**
 * Finds the variables whose units regenerated math changed to compatible ones, and the factor each value takes.
 * Variables new or gone, with the same units, or with incompatible ones are left out.
 *
 * @param {Map<string, string>} fromUnits - Each variable's units before, under its name after (renames applied).
 * @param {Map<string, string>} toUnits - Each variable's units in the regenerated math.
 * @param {{from: Map<string, Array<Object>>, to: Map<string, Array<Object>>}} definitions - See unitsFactor.
 * @returns {Array<{name: string, from: string, to: string, factor: {coefficient: number, power: number}}>}
 */
export function findUnitRescales(fromUnits, toUnits, definitions) {
  const rescales = []
  for (const [name, rawTo] of toUnits) {
    const from = cleanName(fromUnits.get(name))
    const to = cleanName(rawTo)
    if (!from || !to || from === to) continue
    const factor = unitsFactor(from, to, definitions)
    if (factor) rescales.push({ name, from, to, factor })
  }
  return rescales
}

/**
 * Adds the initialisers of rescaled states, e.g. `q_A_init` for `q_A`: rows of their own, not declared in the math,
 * that take their state's units (syncInitialiserUnits), so their values rescale with it.
 *
 * @param {Array<Object>} rescales - findUnitRescales'.
 * @param {Array<Object>} rows - The rows, under the names the rescales use.
 * @returns {Array<Object>}
 */
export function withInitialiserRescales(rescales, rows) {
  const byName = new Map(rescales.map((rescale) => [rescale.name, rescale]))
  const added = []
  for (const row of rows) {
    const rescale = byName.get(row.name)
    if (!rescale || !row.initialiser || byName.has(row.initialiser)) continue
    const initialiser = { ...rescale, name: row.initialiser }
    byName.set(row.initialiser, initialiser)
    added.push(initialiser)
  }
  return added.length ? [...rescales, ...added] : rescales
}

/**
 * Gets each declared variable's units in a model.
 *
 * @param {{declared: Array<{name: string, units: string}>}|null} analysis - analyzeMathXml's.
 * @param {Map<string, string>} [renames] - Old names to new, to key the units by.
 * @returns {Map<string, string>}
 */
export function declaredUnits(analysis, renames = new Map()) {
  return new Map((analysis?.declared ?? []).map(({ name, units }) => [renames.get(name) ?? name, units ?? '']))
}

/**
 * Rescales rows still in a rescale's old units: their values by its factor, and their units to its new ones. A row in
 * other units is left alone.
 *
 * @param {Array<Object>} rows - Never mutated.
 * @param {Array<Object>} rescales - findUnitRescales'.
 * @returns {Array<Object>} The rows, with copies for those rescaled.
 */
export function rescaleRows(rows, rescales) {
  if (!rescales?.length) return rows
  const byName = new Map(rescales.map((rescale) => [rescale.name, rescale]))
  return rows.map((row) => {
    const rescale = byName.get(row.name)
    if (!rescale || cleanName(row.units) !== rescale.from) return row
    const value = scaleValue(row.value, rescale.factor)
    return { ...row, units: rescale.to, ...(value !== null && { value }) }
  })
}

/**
 * Rescales values, e.g. a module's defaults, by name. A value that isn't a number is kept.
 *
 * @param {Map<string, string>} values - Never mutated.
 * @param {Array<Object>} rescales - findUnitRescales'.
 * @param {Map<string, string>} [renames] - Old names to new, when `values` is keyed by the old names.
 * @returns {Map<string, string>}
 */
export function rescaleValues(values, rescales, renames = new Map()) {
  if (!rescales?.length) return values
  const byName = new Map(rescales.map((rescale) => [rescale.name, rescale]))
  return new Map(
    [...values].map(([name, value]) => {
      const rescale = byName.get(renames.get(name) ?? name)
      const scaled = rescale ? scaleValue(value, rescale.factor) : null
      return [name, scaled ?? value]
    })
  )
}
