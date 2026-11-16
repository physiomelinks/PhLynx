/**
 * Skins: SVG artwork a user loads to draw a cell, organelle or compartment of the physiology view with, in place of
 * its plain fill. A skin is kept as cleaned SVG text and always drawn as an image, never put into the page as
 * elements, so nothing in it can run or reach outside the drawing.
 */

/** The most a skin file may hold, and the most skins a workspace keeps. */
export const SKIN_LIMITS = Object.freeze({ bytes: 256 * 1024, count: 24, name: 64 })

/** A skin's id: a lower-case letter, then lower-case letters, digits and hyphens. */
export const SKIN_ID = /^[a-z][a-z0-9-]{0,47}$/

/**
 * How a skin fills its piece: 'contain' shows all of it, as big as fits; 'cover' fills the piece, cut where it
 * overflows; 'stretch' fills it exactly, out of proportion.
 */
export const SKIN_MODES = Object.freeze(['contain', 'cover', 'stretch'])

/** The preserveAspectRatio each mode draws the image with. */
export const SKIN_ASPECT = Object.freeze({ contain: 'xMidYMid meet', cover: 'xMidYMid slice', stretch: 'none' })

/** The elements a skin may be made of: shapes, text, groups, and what paints and clips them. */
const ALLOWED = new Set([
  'svg', 'g', 'defs', 'symbol', 'use', 'title', 'desc',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan',
  'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'pattern',
])

/** Whether an attribute's value reaches outside the drawing or could run. */
const isUnsafeValue = (value) => /javascript:|data:|@import|expression\(|url\(\s*['"]?(?!#)/i.test(value)

/**
 * Makes an id for a skin from its file's name.
 *
 * @param {string} name
 * @param {Iterable<string>} taken - Ids in use.
 * @returns {string}
 */
export function freeSkinId(name, taken) {
  const used = new Set(taken)
  const base = (String(name).toLowerCase().replace(/\.svg$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^[^a-z]+|-+$/g, '') || 'skin').slice(0, 40)
  if (!used.has(base)) return base
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`
}

/**
 * Cleans SVG text for use as a skin: only drawing elements are kept, and nothing that runs or points outside the
 * file (scripts, event handlers, foreign content, images, styles, links to other documents).
 *
 * @param {string} text - An SVG file's contents.
 * @param {{ parse?: (text: string) => Document, serialise?: (node: Node) => string }} [dom] - The page's
 *   DOMParser and XMLSerializer, unless given.
 * @returns {{ svg: string|null, errors: string[] }} The cleaned SVG, with a viewBox; null with why it can't be one.
 */
export function sanitiseSkin(text, dom = {}) {
  if (typeof text !== 'string' || !text.trim()) return { svg: null, errors: ['The file is empty.'] }
  if (new TextEncoder().encode(text).length > SKIN_LIMITS.bytes) {
    return { svg: null, errors: [`A skin must be at most ${SKIN_LIMITS.bytes / 1024} KB.`] }
  }
  const parse = dom.parse ?? ((source) => new DOMParser().parseFromString(source, 'image/svg+xml'))
  const serialise = dom.serialise ?? ((node) => new XMLSerializer().serializeToString(node))
  let root
  try {
    const document = parse(text)
    root = document.documentElement
    if (document.querySelector?.('parsererror')) root = null
  } catch {
    root = null
  }
  if (!root || root.tagName.toLowerCase() !== 'svg') return { svg: null, errors: ['The file is not an SVG drawing.'] }

  for (const element of [...root.querySelectorAll('*')]) {
    if (!ALLOWED.has(element.tagName.toLowerCase())) element.remove()
  }
  for (const element of [root, ...root.querySelectorAll('*')]) {
    for (const { name, value } of [...element.attributes]) {
      const key = name.toLowerCase()
      const isLink = key === 'href' || key.endsWith(':href')
      if (key.startsWith('on') || key === 'style' || (isLink && !value.trim().startsWith('#')) || (!isLink && isUnsafeValue(value))) {
        element.removeAttribute(name)
      }
    }
  }

  // A viewBox says what part of the drawing fills the piece; one is made from the drawing's size where it has none.
  if (!root.getAttribute('viewBox')) {
    const width = parseFloat(root.getAttribute('width'))
    const height = parseFloat(root.getAttribute('height'))
    if (!(width > 0) || !(height > 0)) return { svg: null, errors: ['The SVG needs a viewBox, or a width and height.'] }
    root.setAttribute('viewBox', `0 0 ${width} ${height}`)
  }
  // Sized by the piece it fills, not by itself.
  root.removeAttribute('width')
  root.removeAttribute('height')
  if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  if (!root.querySelector('path, rect, circle, ellipse, line, polyline, polygon, text, use')) {
    return { svg: null, errors: ['Nothing is left to draw once the SVG is cleaned: it may hold only images or scripts.'] }
  }
  return { svg: serialise(root), errors: [] }
}

/**
 * Gives a skin as the address of an image.
 *
 * @param {string} svg - Cleaned SVG text.
 * @returns {string} A data URI.
 */
export const skinHref = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
