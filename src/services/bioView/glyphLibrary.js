/**
 * Glyph libraries: the cartoons membrane proteins are drawn as, in a readable JSON format. A glyph is a short
 * list of restricted shapes (paths, rectangles, circles, text) on a 64×48 canvas, outside of the cell up, each
 * painted with a colour slot rather than a colour, so dark mode and palettes still apply. No raw SVG is read:
 * nothing a file holds can add scripts, links, styles or event handlers.
 */

import { isValidColour, normaliseColour } from '../../utils/nodeThemes.js'
import { LOCAL_TEMPLATE_PREFIX, TEMPLATE_ID, bareTemplateId } from './templates.js'

/** The glyph library format this build understands. */
export const GLYPH_SCHEMA_VERSION = 1

/** The one canvas a glyph is drawn on, in this version. */
export const GLYPH_VIEW_BOX = '0 0 64 48'

/** The colour slots a glyph's shapes and arrows are painted with. */
export const GLYPH_SLOTS = ['body', 'outline', 'pore', 'accent', 'accentText', 'arrow']

/** The shapes a glyph can be made of. */
export const GLYPH_ELEMENT_TYPES = ['path', 'rect', 'circle', 'text']

/** The faces a glyph can anchor couplings to. */
export const GLYPH_FACES = ['outside', 'inside', 'membrane']

/** A glyph's or library's own id; the user's own carry the 'local:' prefix, as templates do. */
export const GLYPH_ID = TEMPLATE_ID

/** SBO term CURIEs. */
const SBO = /^SBO:\d{7}$/
/** GO term CURIEs. */
const GO_CURIE = /^GO:\d{7}$/
/** Path data: commands and numbers only. */
const PATH_DATA = /^[Mm][MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]*$/

export const GLYPH_LIMITS = {
  name: 64,
  author: 64,
  license: 64,
  glyphs: 64,
  elements: 32,
  goFunctions: 16,
  pathData: 2000,
  text: 12,
  bytes: 256 * 1024,
  coordinate: { min: -64, max: 128 },
  strokeWidth: { min: 0, max: 8 },
  fontSize: { min: 3, max: 24 },
}

/** The keys the validator knows, in the order a clean copy lists them. */
export const GLYPH_KEYS = {
  library: ['$schema', 'schemaVersion', 'id', 'name', 'author', 'license', 'glyphs'],
  glyph: [
    'id',
    'name',
    'sbo',
    'goFunctions',
    'viewBox',
    'elements',
    'arrowRoom',
    'faces',
    'palette',
    'author',
    'license',
  ],
  path: ['type', 'd', 'fill', 'stroke', 'strokeWidth', 'upright'],
  rect: ['type', 'x', 'y', 'width', 'height', 'rx', 'ry', 'fill', 'stroke', 'strokeWidth', 'upright'],
  circle: ['type', 'cx', 'cy', 'r', 'fill', 'stroke', 'strokeWidth', 'upright'],
  text: ['type', 'x', 'y', 'text', 'size', 'weight', 'fill', 'upright'],
  arrowRoom: ['left', 'right', 'top', 'bottom', 'colour'],
  point: ['x', 'y'],
}

/** Where a glyph without its own arrowRoom spreads its arrows. */
export const DEFAULT_ARROW_ROOM = Object.freeze({ left: 18, right: 46, top: 7, bottom: 41, colour: 'arrow' })

const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value)
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value)

/**
 * @param {*} id
 * @returns {boolean} Whether `id` is a glyph or library id from the user's own library.
 */
export const isLocalGlyphId = (id) =>
  typeof id === 'string' && id.startsWith(LOCAL_TEMPLATE_PREFIX) && GLYPH_ID.test(bareTemplateId(id))

/** Warns about, and so drops, every key of `raw` that `known` does not list. */
function warnUnknown(raw, known, where, warnings) {
  for (const key of Object.keys(raw)) {
    if (!known.includes(key)) warnings.push(`${where}: unknown key "${key}" was ignored.`)
  }
}

/** Reads a text field: required ones must be there, all must be text within `max`. */
function readText(raw, field, max, where, errors, required = false) {
  const value = raw[field]
  if (value === undefined || value === null || value === '') {
    if (required) errors.push(`${where}: "${field}" is required.`)
    return undefined
  }
  if (typeof value !== 'string') {
    errors.push(`${where}: "${field}" must be text.`)
    return undefined
  }
  const text = value.trim()
  if (required && !text) errors.push(`${where}: "${field}" is required.`)
  if (text.length > max) errors.push(`${where}: "${field}" must be at most ${max} characters.`)
  return text || undefined
}

/** Reads a number within bounds; undefined, with an error unless optional, when missing. */
function readNumber(raw, field, { min, max }, where, errors, optional = false) {
  const value = raw[field]
  if (value === undefined && optional) return undefined
  if (!isNumber(value) || value < min || value > max) {
    errors.push(`${where}: "${field}" must be a number from ${min} to ${max}.`)
    return undefined
  }
  return value
}

/** Reads a colour slot, or 'none' where `allowNone`. */
function readSlot(raw, field, where, errors, { allowNone = true, fallback } = {}) {
  const value = raw[field]
  if (value === undefined) return fallback
  if ((allowNone && value === 'none') || GLYPH_SLOTS.includes(value)) return value
  errors.push(`${where}: "${field}" must be ${allowNone ? '"none" or ' : ''}one of ${GLYPH_SLOTS.join(', ')}.`)
  return fallback
}

/** Reads an {x, y} point within the canvas. */
function readPoint(raw, where, errors, warnings) {
  if (!isObject(raw)) {
    errors.push(`${where} must be an object with "x" and "y".`)
    return undefined
  }
  warnUnknown(raw, GLYPH_KEYS.point, where, warnings)
  const x = readNumber(raw, 'x', { min: 0, max: 64 }, where, errors)
  const y = readNumber(raw, 'y', { min: 0, max: 48 }, where, errors)
  return x === undefined || y === undefined ? undefined : { x, y }
}

/** The point an element turns about to stay upright, when `upright` is true. */
function centreOf(element) {
  if (element.type === 'circle') return { x: element.cx, y: element.cy }
  if (element.type === 'rect') return { x: element.x + element.width / 2, y: element.y + element.height / 2 }
  // Text sits on its baseline, centred across: turn it about the middle of its letters, not the baseline.
  if (element.type === 'text') return { x: element.x, y: Math.round((element.y - element.size * 0.35) * 100) / 100 }
  return undefined
}

function readElement(raw, where, errors, warnings) {
  if (!isObject(raw)) {
    errors.push(`${where} must be an object.`)
    return null
  }
  if (!GLYPH_ELEMENT_TYPES.includes(raw.type)) {
    errors.push(`${where}: "type" must be one of ${GLYPH_ELEMENT_TYPES.join(', ')}.`)
    return null
  }
  const { type } = raw
  const before = errors.length
  // Strict, unlike the other keys: a shape's attributes are where SVG would carry links, styles and handlers.
  for (const key of Object.keys(raw)) {
    if (!GLYPH_KEYS[type].includes(key)) errors.push(`${where}: a ${type} cannot have "${key}".`)
  }
  const coordinate = (field, optional) => readNumber(raw, field, GLYPH_LIMITS.coordinate, where, errors, optional)
  const element = { type }

  if (type === 'path') {
    if (typeof raw.d !== 'string' || !PATH_DATA.test(raw.d.trim())) {
      errors.push(`${where}: "d" must be path data: commands (M, L, C, Q, A, Z…) and numbers only.`)
    } else if (raw.d.length > GLYPH_LIMITS.pathData) {
      errors.push(`${where}: "d" must be at most ${GLYPH_LIMITS.pathData} characters.`)
    } else element.d = raw.d.trim().replace(/\s+/g, ' ')
  } else if (type === 'rect') {
    element.x = coordinate('x')
    element.y = coordinate('y')
    element.width = readNumber(raw, 'width', { min: 0, max: 128 }, where, errors)
    element.height = readNumber(raw, 'height', { min: 0, max: 128 }, where, errors)
    const rx = readNumber(raw, 'rx', { min: 0, max: 64 }, where, errors, true)
    const ry = readNumber(raw, 'ry', { min: 0, max: 64 }, where, errors, true)
    if (rx !== undefined) element.rx = rx
    if (ry !== undefined) element.ry = ry
  } else if (type === 'circle') {
    element.cx = coordinate('cx')
    element.cy = coordinate('cy')
    element.r = readNumber(raw, 'r', { min: 0, max: 64 }, where, errors)
  } else {
    element.x = coordinate('x')
    element.y = coordinate('y')
    const text = readText(raw, 'text', GLYPH_LIMITS.text, where, errors, true)
    if (text) element.text = text
    element.size = readNumber(raw, 'size', GLYPH_LIMITS.fontSize, where, errors, true) ?? 6
    if (raw.weight !== undefined && raw.weight !== 'normal' && raw.weight !== 'bold') {
      errors.push(`${where}: "weight" must be "normal" or "bold".`)
    }
    element.weight = raw.weight === 'bold' ? 'bold' : 'normal'
  }

  element.fill = readSlot(raw, 'fill', where, errors, { fallback: type === 'text' ? 'accentText' : 'body' })
  if (type !== 'text') {
    element.stroke = readSlot(raw, 'stroke', where, errors, { fallback: 'none' })
    const width = readNumber(raw, 'strokeWidth', GLYPH_LIMITS.strokeWidth, where, errors, true)
    if (element.stroke !== 'none') element.strokeWidth = width ?? 2
  }

  if (raw.upright === true) {
    const centre = centreOf(element)
    if (!centre) errors.push(`${where}: a path needs "upright" as the point {x, y} it turns about.`)
    else element.upright = centre
  } else if (raw.upright !== undefined && raw.upright !== false) {
    const point = readPoint(raw.upright, `${where} "upright"`, errors, warnings)
    if (point) element.upright = point
  }
  return errors.length > before ? null : element
}

function readArrowRoom(raw, where, errors, warnings) {
  if (raw === undefined) return { ...DEFAULT_ARROW_ROOM }
  if (!isObject(raw)) {
    errors.push(`${where}: "arrowRoom" must be an object.`)
    return null
  }
  const at = `${where} "arrowRoom"`
  warnUnknown(raw, GLYPH_KEYS.arrowRoom, at, warnings)
  const left = readNumber(raw, 'left', { min: 0, max: 64 }, at, errors)
  const right = readNumber(raw, 'right', { min: 0, max: 64 }, at, errors)
  const top = readNumber(raw, 'top', { min: 0, max: 48 }, at, errors)
  const bottom = readNumber(raw, 'bottom', { min: 0, max: 48 }, at, errors)
  if (left > right) errors.push(`${at}: "left" must not be right of "right".`)
  if (bottom - top < 10) errors.push(`${at}: "bottom" must be at least 10 below "top".`)
  const colour = readSlot(raw, 'colour', at, errors, { allowNone: false, fallback: 'arrow' })
  return { left, right, top, bottom, colour }
}

function readFaces(raw, where, errors, warnings) {
  if (!isObject(raw)) {
    errors.push(`${where}: "faces" must be an object.`)
    return undefined
  }
  const faces = {}
  for (const [face, point] of Object.entries(raw)) {
    if (!GLYPH_FACES.includes(face)) warnings.push(`${where} "faces": unknown face "${face}" was ignored.`)
    else {
      const read = readPoint(point, `${where} "faces.${face}"`, errors, warnings)
      if (read) faces[face] = read
    }
  }
  return Object.keys(faces).length ? faces : undefined
}

function readPalette(raw, where, errors, warnings) {
  if (!isObject(raw)) {
    errors.push(`${where}: "palette" must be an object with "light" and/or "dark".`)
    return undefined
  }
  const palette = {}
  for (const [mode, colours] of Object.entries(raw)) {
    if (mode !== 'light' && mode !== 'dark') {
      warnings.push(`${where} "palette": unknown mode "${mode}" was ignored.`)
      continue
    }
    if (!isObject(colours)) {
      errors.push(`${where} "palette.${mode}" must be an object of slot colours.`)
      continue
    }
    const read = {}
    for (const [slot, colour] of Object.entries(colours)) {
      if (!GLYPH_SLOTS.includes(slot)) warnings.push(`${where} "palette.${mode}": unknown slot "${slot}" was ignored.`)
      else if (!isValidColour(colour)) {
        errors.push(`${where} "palette.${mode}.${slot}" must be a #rgb or #rrggbb colour.`)
      }
      else read[slot] = normaliseColour(colour)
    }
    if (Object.keys(read).length) palette[mode] = read
  }
  return Object.keys(palette).length ? palette : undefined
}

function readId(raw, where, errors, allowLocalId) {
  const id = typeof raw.id === 'string' && allowLocalId ? bareTemplateId(raw.id) : raw.id
  if (typeof id !== 'string' || !GLYPH_ID.test(id)) {
    const rule = 'must start with a letter and use only lower-case letters, digits and hyphens (2-48 characters)'
    errors.push(`${where}: "id" ${rule}.`)
  }
  return raw.id
}

/**
 * Validates one glyph.
 *
 * @param {*} raw
 * @param {Object} [options]
 * @param {boolean} [options.allowLocalId=false] - Accept ids with the 'local:' prefix.
 * @param {string} [options.where] - How problems name it.
 * @returns {{ glyph: Object|null, errors: Array<string>, warnings: Array<string> }} A frozen clean copy, or null
 *   when there are errors.
 */
export function validateGlyph(raw, { allowLocalId = false, where: named } = {}) {
  const errors = []
  const warnings = []
  if (!isObject(raw)) return { glyph: null, errors: [`${named ?? 'A glyph'} must be a JSON object.`], warnings }
  const where = named ?? `Glyph "${typeof raw.id === 'string' ? raw.id : '?'}"`
  warnUnknown(raw, GLYPH_KEYS.glyph, where, warnings)

  const glyph = { id: readId(raw, where, errors, allowLocalId) }
  glyph.name = readText(raw, 'name', GLYPH_LIMITS.name, where, errors, true)
  if (raw.sbo !== undefined) {
    if (typeof raw.sbo === 'string' && SBO.test(raw.sbo)) glyph.sbo = raw.sbo
    else errors.push(`${where}: "sbo" must be a CURIE like SBO:0000284.`)
  }
  if (raw.goFunctions !== undefined) {
    if (
      !Array.isArray(raw.goFunctions) ||
      raw.goFunctions.length > GLYPH_LIMITS.goFunctions ||
      !raw.goFunctions.every((curie) => typeof curie === 'string' && GO_CURIE.test(curie))
    ) {
      errors.push(`${where}: "goFunctions" must list at most ${GLYPH_LIMITS.goFunctions} CURIEs like GO:0005412.`)
    } else if (raw.goFunctions.length) glyph.goFunctions = [...new Set(raw.goFunctions)]
  }
  if (raw.viewBox !== undefined && String(raw.viewBox).trim().replace(/\s+/g, ' ') !== GLYPH_VIEW_BOX) {
    errors.push(`${where}: "viewBox" must be "${GLYPH_VIEW_BOX}".`)
  }
  glyph.viewBox = GLYPH_VIEW_BOX

  if (!Array.isArray(raw.elements) || !raw.elements.length) {
    errors.push(`${where}: "elements" must be a non-empty list.`)
  } else if (raw.elements.length > GLYPH_LIMITS.elements) {
    errors.push(`${where}: "elements" can list at most ${GLYPH_LIMITS.elements} shapes.`)
  } else {
    glyph.elements = raw.elements
      .map((element, i) => readElement(element, `${where} element ${i + 1}`, errors, warnings))
      .filter(Boolean)
  }
  glyph.arrowRoom = readArrowRoom(raw.arrowRoom, where, errors, warnings)
  if (raw.faces !== undefined) {
    const faces = readFaces(raw.faces, where, errors, warnings)
    if (faces) glyph.faces = faces
  }
  if (raw.palette !== undefined) {
    const palette = readPalette(raw.palette, where, errors, warnings)
    if (palette) glyph.palette = palette
  }
  const author = readText(raw, 'author', GLYPH_LIMITS.author, where, errors)
  const license = readText(raw, 'license', GLYPH_LIMITS.license, where, errors)
  if (author) glyph.author = author
  if (license) glyph.license = license
  return errors.length ? { glyph: null, errors, warnings } : { glyph: deepFreeze(glyph), errors, warnings }
}

/**
 * Validates a glyph library file, modelled on validateTemplate: unknown keys are dropped with a warning, and
 * any error rejects the whole library.
 *
 * @param {*} raw - Parsed JSON.
 * @param {Object} [options]
 * @param {boolean} [options.allowLocalId=false] - Accept library and glyph ids with the 'local:' prefix.
 * @returns {{ library: Object|null, errors: Array<string>, warnings: Array<string> }} A frozen clean copy, or
 *   null when there are errors.
 */
export function validateGlyphLibrary(raw, { allowLocalId = false } = {}) {
  const errors = []
  const warnings = []
  if (!isObject(raw)) return { library: null, errors: ['A glyph library must be a JSON object.'], warnings }
  let bytes = Infinity
  try {
    bytes = new TextEncoder().encode(JSON.stringify(raw)).length
  } catch {
    // Not serialisable, so too big to read.
  }
  if (bytes > GLYPH_LIMITS.bytes) {
    return { library: null, errors: [`A glyph library must be at most ${GLYPH_LIMITS.bytes / 1024} KB.`], warnings }
  }

  const where = 'Glyph library'
  warnUnknown(raw, GLYPH_KEYS.library, where, warnings)
  if (raw.schemaVersion !== GLYPH_SCHEMA_VERSION) {
    errors.push(`${where}: "schemaVersion" must be ${GLYPH_SCHEMA_VERSION}.`)
  }
  const library = { schemaVersion: GLYPH_SCHEMA_VERSION, id: readId(raw, where, errors, allowLocalId) }
  library.name = readText(raw, 'name', GLYPH_LIMITS.name, where, errors, true)
  const author = readText(raw, 'author', GLYPH_LIMITS.author, where, errors)
  const license = readText(raw, 'license', GLYPH_LIMITS.license, where, errors)
  if (author) library.author = author
  if (license) library.license = license

  library.glyphs = []
  if (!Array.isArray(raw.glyphs) || !raw.glyphs.length) errors.push(`${where}: "glyphs" must be a non-empty list.`)
  else if (raw.glyphs.length > GLYPH_LIMITS.glyphs) {
    errors.push(`A glyph library can have at most ${GLYPH_LIMITS.glyphs} glyphs.`)
  } else {
    const seen = new Set()
    raw.glyphs.forEach((rawGlyph, i) => {
      const named = `Glyph ${typeof rawGlyph?.id === 'string' ? `"${rawGlyph.id}"` : i + 1}`
      const result = validateGlyph(rawGlyph, { allowLocalId, where: named })
      errors.push(...result.errors)
      warnings.push(...result.warnings)
      if (!result.glyph) return
      if (seen.has(result.glyph.id)) errors.push(`Id "${result.glyph.id}" is used by more than one glyph.`)
      seen.add(result.glyph.id)
      library.glyphs.push(result.glyph)
    })
  }
  return errors.length ? { library: null, errors, warnings } : { library: deepFreeze(library), errors, warnings }
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

/** The suffix glyph library files are saved with. */
export const GLYPH_FILE_SUFFIX = '.glyphs.json'

/**
 * Writes a glyph library as a file anyone can load: its own ids, without the `local:` prefix.
 *
 * @param {Object} library - A validated library.
 * @returns {{ filename: string, text: string }}
 */
export function glyphLibraryFile(library) {
  const id = bareTemplateId(library.id)
  const glyphs = library.glyphs.map((glyph) => ({ ...glyph, id: bareTemplateId(glyph.id) }))
  const text = JSON.stringify({ ...library, id, glyphs }, null, 2) + '\n'
  return { filename: `${id}${GLYPH_FILE_SUFFIX}`, text }
}
