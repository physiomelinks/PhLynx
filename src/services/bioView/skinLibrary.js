/**
 * Skin libraries: the skins the physiology view's modules and compartments are drawn with, in a readable JSON
 * format (.skins.json). Each skin says what it is for (`appliesTo`, `terms`) and is one of two kinds:
 * - a symbol, for a protein or process: a short list of restricted shapes (paths, rectangles, circles, text) on a
 *   64×48 canvas, outside of the cell up, each painted with a colour slot rather than a colour, so dark mode and
 *   palettes still apply; no raw SVG is read, so nothing it holds can add scripts, links, styles or event handlers;
 * - an area skin, for a compartment: SVG text (`svg`), cleaned of all but drawing on every read (see sanitiseSkin)
 *   and only ever drawn as an image.
 */

import { isValidColour, normaliseColour } from '../../utils/nodeThemes.js'
import { LOCAL_TEMPLATE_PREFIX, bareTemplateId } from './localIds.js'
import { CURIE, TEMPLATE_ID } from './pieces/constants.js'
import { SKIN_TARGETS } from './skinContext.js'
import { sanitiseSkin } from './skins.js'

/** The skin library format this build understands. */
export const SKIN_SCHEMA_VERSION = 1

/** The one canvas a symbol is drawn on, in this version. */
export const SYMBOL_VIEW_BOX = '0 0 64 48'

/** The colour slots a symbol's shapes and arrows are painted with. */
export const SYMBOL_SLOTS = ['body', 'outline', 'pore', 'accent', 'accentText', 'arrow']

/** The shapes a symbol can be made of. */
export const SYMBOL_ELEMENT_TYPES = ['path', 'rect', 'circle', 'text']

/** The faces a symbol can anchor couplings to. */
export const SYMBOL_FACES = ['outside', 'inside', 'membrane']

/** A skin's or library's own id; the user's own carry the 'local:' prefix, as templates do. */
export const SKIN_LIBRARY_ID = TEMPLATE_ID

/** What a symbol can be drawn for: a module, or the joint of a tube where its two ends touch. */
export const SYMBOL_TARGETS = Object.freeze([...SKIN_TARGETS.module, ...SKIN_TARGETS.tube])

/** SBO term CURIEs. */
const SBO = /^SBO:\d{7}$/
/** Path data: commands and numbers only. */
const PATH_DATA = /^[Mm][MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]*$/

export const SKIN_LIBRARY_LIMITS = {
  name: 64,
  author: 64,
  license: 64,
  skins: 64,
  elements: 32,
  terms: 16,
  pathData: 2000,
  text: 12,
  bytes: 1024 * 1024,
  coordinate: { min: -64, max: 128 },
  strokeWidth: { min: 0, max: 8 },
  fontSize: { min: 3, max: 24 },
}

/** The keys the validator knows, in the order a clean copy lists them. */
export const SKIN_LIBRARY_KEYS = {
  library: ['$schema', 'schemaVersion', 'id', 'name', 'author', 'license', 'skins'],
  area: ['id', 'name', 'appliesTo', 'terms', 'svg', 'author', 'license'],
  symbol: [
    'id',
    'name',
    'appliesTo',
    'sbo',
    'terms',
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

/** Where a symbol without its own arrowRoom spreads its arrows. */
export const DEFAULT_ARROW_ROOM = Object.freeze({ left: 18, right: 46, top: 7, bottom: 41, colour: 'arrow' })

const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value)
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value)

/**
 * @param {*} id
 * @returns {boolean} Whether `id` is a skin or library id from the user's own library.
 */
export const isLocalSkinId = (id) =>
  typeof id === 'string' && id.startsWith(LOCAL_TEMPLATE_PREFIX) && SKIN_LIBRARY_ID.test(bareTemplateId(id))

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
  if ((allowNone && value === 'none') || SYMBOL_SLOTS.includes(value)) return value
  errors.push(`${where}: "${field}" must be ${allowNone ? '"none" or ' : ''}one of ${SYMBOL_SLOTS.join(', ')}.`)
  return fallback
}

/** Reads an {x, y} point within the canvas. */
function readPoint(raw, where, errors, warnings) {
  if (!isObject(raw)) {
    errors.push(`${where} must be an object with "x" and "y".`)
    return undefined
  }
  warnUnknown(raw, SKIN_LIBRARY_KEYS.point, where, warnings)
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
  if (!SYMBOL_ELEMENT_TYPES.includes(raw.type)) {
    errors.push(`${where}: "type" must be one of ${SYMBOL_ELEMENT_TYPES.join(', ')}.`)
    return null
  }
  const { type } = raw
  const before = errors.length
  // Strict, unlike the other keys: a shape's attributes are where SVG would carry links, styles and handlers.
  for (const key of Object.keys(raw)) {
    if (!SKIN_LIBRARY_KEYS[type].includes(key)) errors.push(`${where}: a ${type} cannot have "${key}".`)
  }
  const coordinate = (field, optional) => readNumber(raw, field, SKIN_LIBRARY_LIMITS.coordinate, where, errors, optional)
  const element = { type }

  if (type === 'path') {
    if (typeof raw.d !== 'string' || !PATH_DATA.test(raw.d.trim())) {
      errors.push(`${where}: "d" must be path data: commands (M, L, C, Q, A, Z…) and numbers only.`)
    } else if (raw.d.length > SKIN_LIBRARY_LIMITS.pathData) {
      errors.push(`${where}: "d" must be at most ${SKIN_LIBRARY_LIMITS.pathData} characters.`)
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
    const text = readText(raw, 'text', SKIN_LIBRARY_LIMITS.text, where, errors, true)
    if (text) element.text = text
    element.size = readNumber(raw, 'size', SKIN_LIBRARY_LIMITS.fontSize, where, errors, true) ?? 6
    if (raw.weight !== undefined && raw.weight !== 'normal' && raw.weight !== 'bold') {
      errors.push(`${where}: "weight" must be "normal" or "bold".`)
    }
    element.weight = raw.weight === 'bold' ? 'bold' : 'normal'
  }

  element.fill = readSlot(raw, 'fill', where, errors, { fallback: type === 'text' ? 'accentText' : 'body' })
  if (type !== 'text') {
    element.stroke = readSlot(raw, 'stroke', where, errors, { fallback: 'none' })
    const width = readNumber(raw, 'strokeWidth', SKIN_LIBRARY_LIMITS.strokeWidth, where, errors, true)
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
  warnUnknown(raw, SKIN_LIBRARY_KEYS.arrowRoom, at, warnings)
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
    if (!SYMBOL_FACES.includes(face)) warnings.push(`${where} "faces": unknown face "${face}" was ignored.`)
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
      if (!SYMBOL_SLOTS.includes(slot)) warnings.push(`${where} "palette.${mode}": unknown slot "${slot}" was ignored.`)
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
  if (typeof id !== 'string' || !SKIN_LIBRARY_ID.test(id)) {
    const rule = 'must start with a letter and use only lower-case letters, digits and hyphens (2-48 characters)'
    errors.push(`${where}: "id" ${rule}.`)
  }
  return raw.id
}

/**
 * Validates one symbol skin.
 *
 * @param {*} raw
 * @param {Object} [options]
 * @param {boolean} [options.allowLocalId=false] - Accept ids with the 'local:' prefix.
 * @param {string} [options.where] - How problems name it.
 * @returns {{ skin: Object|null, errors: Array<string>, warnings: Array<string> }} A frozen clean copy, or null
 *   when there are errors.
 */
export function validateSymbolSkin(raw, { allowLocalId = false, where: named } = {}) {
  const errors = []
  const warnings = []
  if (!isObject(raw)) return { skin: null, errors: [`${named ?? 'A skin'} must be a JSON object.`], warnings }
  const where = named ?? `Skin "${typeof raw.id === 'string' ? raw.id : '?'}"`
  warnUnknown(raw, SKIN_LIBRARY_KEYS.symbol, where, warnings)

  const skin = { id: readId(raw, where, errors, allowLocalId) }
  skin.name = readText(raw, 'name', SKIN_LIBRARY_LIMITS.name, where, errors, true)
  if (raw.sbo !== undefined) {
    if (typeof raw.sbo === 'string' && SBO.test(raw.sbo)) skin.sbo = raw.sbo
    else errors.push(`${where}: "sbo" must be a CURIE like SBO:0000284.`)
  }
  // What it can be drawn for: a protein in its membrane, a process, a tube's joint.
  const targets = SYMBOL_TARGETS
  if (!Array.isArray(raw.appliesTo) || !raw.appliesTo.length || !raw.appliesTo.every((target) => targets.includes(target))) {
    errors.push(`${where}: "appliesTo" must list one or more of ${targets.join(', ')}.`)
  } else skin.appliesTo = targets.filter((target) => raw.appliesTo.includes(target))
  readTerms(raw, skin, where, errors)
  if (raw.viewBox !== undefined && String(raw.viewBox).trim().replace(/\s+/g, ' ') !== SYMBOL_VIEW_BOX) {
    errors.push(`${where}: "viewBox" must be "${SYMBOL_VIEW_BOX}".`)
  }
  skin.viewBox = SYMBOL_VIEW_BOX

  if (!Array.isArray(raw.elements) || !raw.elements.length) {
    errors.push(`${where}: "elements" must be a non-empty list.`)
  } else if (raw.elements.length > SKIN_LIBRARY_LIMITS.elements) {
    errors.push(`${where}: "elements" can list at most ${SKIN_LIBRARY_LIMITS.elements} shapes.`)
  } else {
    skin.elements = raw.elements
      .map((element, i) => readElement(element, `${where} element ${i + 1}`, errors, warnings))
      .filter(Boolean)
  }
  skin.arrowRoom = readArrowRoom(raw.arrowRoom, where, errors, warnings)
  if (raw.faces !== undefined) {
    const faces = readFaces(raw.faces, where, errors, warnings)
    if (faces) skin.faces = faces
  }
  if (raw.palette !== undefined) {
    const palette = readPalette(raw.palette, where, errors, warnings)
    if (palette) skin.palette = palette
  }
  const author = readText(raw, 'author', SKIN_LIBRARY_LIMITS.author, where, errors)
  const license = readText(raw, 'license', SKIN_LIBRARY_LIMITS.license, where, errors)
  if (author) skin.author = author
  if (license) skin.license = license
  return errors.length ? { skin: null, errors, warnings } : { skin: deepFreeze(skin), errors, warnings }
}

/** Reads the ontology terms a skin stands for, which put it first for a thing annotated with one. */
function readTerms(raw, skin, where, errors) {
  if (raw.terms === undefined) return
  if (
    !Array.isArray(raw.terms) ||
    raw.terms.length > SKIN_LIBRARY_LIMITS.terms ||
    !raw.terms.every((curie) => typeof curie === 'string' && CURIE.test(curie))
  ) {
    errors.push(`${where}: "terms" must list at most ${SKIN_LIBRARY_LIMITS.terms} CURIEs like GO:0005412.`)
  } else if (raw.terms.length) skin.terms = [...new Set(raw.terms)]
}

/**
 * Validates one area skin: its SVG is cleaned as it is read (see sanitiseSkin).
 *
 * @param {*} raw
 * @param {Object} [options] - As for validateSymbolSkin, and dom: as for sanitiseSkin.
 * @returns {{ skin: Object|null, errors: Array<string>, warnings: Array<string> }}
 */
export function validateAreaSkin(raw, { allowLocalId = false, where: named, dom } = {}) {
  const errors = []
  const warnings = []
  if (!isObject(raw)) return { skin: null, errors: [`${named ?? 'A skin'} must be a JSON object.`], warnings }
  const where = named ?? `Skin "${typeof raw.id === 'string' ? raw.id : '?'}"`
  warnUnknown(raw, SKIN_LIBRARY_KEYS.area, where, warnings)
  const skin = { id: readId(raw, where, errors, allowLocalId) }
  skin.name = readText(raw, 'name', SKIN_LIBRARY_LIMITS.name, where, errors, true)
  // What it can fill: a cell's cytosol, an organelle's inside, a subcompartment, or a space outside cells.
  if (
    !Array.isArray(raw.appliesTo) ||
    !raw.appliesTo.length ||
    !raw.appliesTo.every((target) => SKIN_TARGETS.area.includes(target))
  ) {
    errors.push(`${where}: "appliesTo" must list one or more of ${SKIN_TARGETS.area.join(', ')}.`)
  } else skin.appliesTo = SKIN_TARGETS.area.filter((target) => raw.appliesTo.includes(target))
  readTerms(raw, skin, where, errors)
  const { svg, errors: drawing } = sanitiseSkin(raw.svg, dom)
  if (svg) skin.svg = svg
  else errors.push(...drawing.map((problem) => `${where}: ${problem}`))
  const author = readText(raw, 'author', SKIN_LIBRARY_LIMITS.author, where, errors)
  const license = readText(raw, 'license', SKIN_LIBRARY_LIMITS.license, where, errors)
  if (author) skin.author = author
  if (license) skin.license = license
  return errors.length ? { skin: null, errors, warnings } : { skin: deepFreeze(skin), errors, warnings }
}

/** How a skin is drawn: an area skin is SVG text, a symbol its shapes. */
export const rendererOf = (skin) => (isObject(skin) && 'svg' in skin ? 'area' : 'symbol')

/**
 * Validates one skin of either kind: an area skin where it has `svg`, else a symbol.
 *
 * @param {*} raw
 * @param {Object} [options] - As for validateAreaSkin.
 * @returns {{ skin: Object|null, errors: Array<string>, warnings: Array<string> }}
 */
export const validateSkin = (raw, options = {}) =>
  rendererOf(raw) === 'area' ? validateAreaSkin(raw, options) : validateSymbolSkin(raw, options)

/**
 * Validates a skin library file, modelled on validatePiecesTemplate: unknown keys are dropped with a warning, and
 * any error rejects the whole library.
 *
 * @param {*} raw - Parsed JSON.
 * @param {Object} [options]
 * @param {boolean} [options.allowLocalId=false] - Accept library and skin ids with the 'local:' prefix.
 * @param {Object} [options.dom] - As for sanitiseSkin.
 * @returns {{ library: Object|null, errors: Array<string>, warnings: Array<string> }} A frozen clean copy, or
 *   null when there are errors.
 */
export function validateSkinLibrary(raw, { allowLocalId = false, dom } = {}) {
  const errors = []
  const warnings = []
  if (!isObject(raw)) return { library: null, errors: ['A skin library must be a JSON object.'], warnings }
  let bytes = Infinity
  try {
    bytes = new TextEncoder().encode(JSON.stringify(raw)).length
  } catch {
    // Not serialisable, so too big to read.
  }
  if (bytes > SKIN_LIBRARY_LIMITS.bytes) {
    return { library: null, errors: [`A skin library must be at most ${SKIN_LIBRARY_LIMITS.bytes / 1024} KB.`], warnings }
  }

  const where = 'Skin library'
  warnUnknown(raw, SKIN_LIBRARY_KEYS.library, where, warnings)
  if (raw.schemaVersion !== SKIN_SCHEMA_VERSION) {
    errors.push(`${where}: "schemaVersion" must be ${SKIN_SCHEMA_VERSION}.`)
  }
  const library = { schemaVersion: SKIN_SCHEMA_VERSION, id: readId(raw, where, errors, allowLocalId) }
  library.name = readText(raw, 'name', SKIN_LIBRARY_LIMITS.name, where, errors, true)
  const author = readText(raw, 'author', SKIN_LIBRARY_LIMITS.author, where, errors)
  const license = readText(raw, 'license', SKIN_LIBRARY_LIMITS.license, where, errors)
  if (author) library.author = author
  if (license) library.license = license

  library.skins = []
  if (!Array.isArray(raw.skins) || !raw.skins.length) errors.push(`${where}: "skins" must be a non-empty list.`)
  else if (raw.skins.length > SKIN_LIBRARY_LIMITS.skins) {
    errors.push(`A skin library can have at most ${SKIN_LIBRARY_LIMITS.skins} skins.`)
  } else {
    const seen = new Set()
    raw.skins.forEach((rawSkin, i) => {
      const named = `Skin ${typeof rawSkin?.id === 'string' ? `"${rawSkin.id}"` : i + 1}`
      const result = validateSkin(rawSkin, { allowLocalId, where: named, dom })
      errors.push(...result.errors)
      warnings.push(...result.warnings)
      if (!result.skin) return
      if (seen.has(result.skin.id)) errors.push(`Id "${result.skin.id}" is used by more than one skin.`)
      seen.add(result.skin.id)
      library.skins.push(result.skin)
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

/** The suffix skin library files are saved with. */
export const SKIN_FILE_SUFFIX = '.skins.json'

/**
 * Writes a skin library as a file anyone can load: its own ids, without the `local:` prefix.
 *
 * @param {Object} library - A validated library.
 * @returns {{ filename: string, text: string }}
 */
export function skinLibraryFile(library) {
  const id = bareTemplateId(library.id)
  const skins = library.skins.map((skin) => ({ ...skin, id: bareTemplateId(skin.id) }))
  const text = JSON.stringify({ ...library, id, skins }, null, 2) + '\n'
  return { filename: `${id}${SKIN_FILE_SUFFIX}`, text }
}
