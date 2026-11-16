/**
 * Reading and writing numbers as typed in a field, in decimal (0.001) or scientific notation (1e-20).
 */

// A decimal number with an optional exponent: 2, -0.5, .5, 3., 1e-20, 2.5E+3.
const NUMBER_PATTERN = /^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i

/**
 * Reads a number as typed. Spaces are ignored, and a typographic minus (−) counts as a minus.
 *
 * @param {string} text
 * @returns {number|null|undefined} The number; null for a blank field; undefined for text that isn't a finite number.
 */
export function parseScientificNumber(text) {
  const cleaned = String(text ?? '')
    .replace(/\s+/g, '')
    .replace(/−/g, '-')
  if (cleaned === '') return null
  if (!NUMBER_PATTERN.test(cleaned)) return undefined
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : undefined
}

/**
 * Writes a number as short as JavaScript writes it, which switches to scientific notation below 1e-6
 * (1e-7, 1e-20) and at 1e21 and above.
 *
 * @param {number|null|undefined} value
 * @returns {string} The text, or '' for no number.
 */
export function formatScientificNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
}
