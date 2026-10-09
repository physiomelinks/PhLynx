/**
 * Formats values as Python does, so messages ported from circulatory_autogen read exactly as CA's own.
 */

/**
 * Formats a number as Python's `format(x, 'g')`: six significant digits, trailing zeros dropped.
 *
 * @param {number} x
 * @returns {string}
 */
export function formatPythonG(x) {
  if (Number.isNaN(x)) return 'nan'
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf'
  if (x === 0) return Object.is(x, -0) ? '-0' : '0'
  // JavaScript rounds a tie up, Python to even, so the digits are rounded here from the exact value.
  const [mantissa, exponentText] = Math.abs(x).toExponential(99).split('e')
  let exponent = Number(exponentText)
  const digits = mantissa.replace('.', '')
  let kept = digits.slice(0, 6)
  const [next, ...rest] = digits.slice(6)
  const isTie = next === '5' && !rest.some((digit) => digit !== '0')
  if (next > '5' || (next === '5' && (!isTie || Number(kept.at(-1)) % 2 === 1))) {
    kept = String(Number(kept) + 1)
    if (kept.length > 6) [kept, exponent] = [kept.slice(0, 6), exponent + 1]
  }
  const sign = x < 0 ? '-' : ''
  const join = (whole, fraction) => (fraction.replace(/0+$/, '') ? `${whole}.${fraction.replace(/0+$/, '')}` : whole)
  if (exponent < -4 || exponent >= 6) {
    return `${sign}${join(kept[0], kept.slice(1))}e${exponent < 0 ? '-' : '+'}${String(Math.abs(exponent)).padStart(2, '0')}`
  }
  if (exponent < 0) return `${sign}${join('0', '0'.repeat(-exponent - 1) + kept)}`
  return `${sign}${join(kept.slice(0, exponent + 1), kept.slice(exponent + 1))}`
}

/**
 * Formats a number as Python's `repr` of a float: `1.0` rather than `1`, and exponents of two digits or more.
 *
 * @param {number} x
 * @returns {string}
 */
export function formatPythonFloat(x) {
  if (Number.isNaN(x)) return 'nan'
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf'
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0'
  const size = Math.abs(x)
  if (size >= 1e-4 && size < 1e16) return Number.isInteger(x) ? x.toFixed(1) : String(x)
  return x.toExponential().replace(/e([+-])(\d)$/, 'e$10$2')
}

/**
 * Formats a JSON value as Python's `repr` of what `json.load` gives for it.
 *
 * @param {*} value
 * @returns {string}
 */
export function formatPythonRepr(value) {
  if (value === null || value === undefined) return 'None'
  if (value === true) return 'True'
  if (value === false) return 'False'
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : formatPythonFloat(value)
  if (typeof value === 'string') return formatPythonString(value)
  if (Array.isArray(value)) return formatPythonList(value)
  return `{${Object.entries(value).map(([key, item]) => `${formatPythonRepr(key)}: ${formatPythonRepr(item)}`).join(', ')}}`
}

/**
 * Formats a value as Python's `str` of it: a string as it is, anything else as its repr.
 *
 * @param {*} value
 * @returns {string}
 */
export const formatPythonStr = (value) => (typeof value === 'string' ? value : formatPythonRepr(value))

/**
 * Formats a string as Python's `repr` of it: quoted, with backslashes, quotes and control characters escaped.
 *
 * @param {string} text
 * @returns {string}
 */
function formatPythonString(text) {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'"
  const ESCAPES = { '\\': '\\\\', '\n': '\\n', '\r': '\\r', '\t': '\\t' }
  const escaped = [...text]
    .map((character) => {
      if (character in ESCAPES) return ESCAPES[character]
      if (character === quote) return `\\${quote}`
      const code = character.codePointAt(0)
      return code < 0x20 || (code >= 0x7f && code <= 0xa0) ? `\\x${code.toString(16).padStart(2, '0')}` : character
    })
    .join('')
  return `${quote}${escaped}${quote}`
}

/**
 * Formats a list as Python's `repr` of it, e.g. `['a', 'b']`.
 *
 * @param {Array} items
 * @returns {string}
 */
export const formatPythonList = (items) => `[${items.map(formatPythonRepr).join(', ')}]`

/**
 * Names a JSON value's type as Python's `type(value).__name__` does. JSON's `1.0` reads as 1 here, so it is named
 * int where Python names it float; only messages differ.
 *
 * @param {*} value
 * @returns {string}
 */
export function getPythonTypeName(value) {
  if (value === null || value === undefined) return 'NoneType'
  if (typeof value === 'boolean') return 'bool'
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'float'
  if (typeof value === 'string') return 'str'
  if (Array.isArray(value)) return 'list'
  return 'dict'
}

/**
 * Whether a JSON value is falsy in Python: None, False, 0, an empty string, list or dict.
 *
 * @param {*} value
 * @returns {boolean}
 */
export function isPythonFalsy(value) {
  if (value == null || value === false || value === 0 || value === '') return true
  if (Array.isArray(value)) return value.length === 0
  return typeof value === 'object' && Object.keys(value).length === 0
}
