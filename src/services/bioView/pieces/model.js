/**
 * The pieces the physiology view is built from (schema 4), and the validator that reads them. A template written in
 * this format is a list of pieces to drop onto the view; once dropped they are the workspace's own, edited like any
 * other.
 *
 * Every piece has an `id` (unique among the pieces), a `kind` and a `label`, and offers a site for modules unless
 * `site` is false:
 * - compartment: a space. `parent` is the compartment it stands in (none: the canvas); `frame` is where it is drawn,
 *   from its parent's corner; `docks` lie it against membrane sides or folds, on their inner or outer face, reaching
 *   `depth` from them. A docked compartment is drawn from its docks, and one a membrane encloses undocked (its bulk)
 *   fills the membrane, so only a compartment that is neither uses its frame.
 * - membrane: encloses compartments (`encloses`), all standing where the membrane does (`parent`); its `frame` is
 *   where the enclosure is drawn, and how big at least. Each side is a row of spans, each a site for membrane
 *   proteins; a side it doesn't list is one span named for the side.
 * - tube: joins two compartments (`ends`, upstream first) and carries one flux module; `bends` are its corners.
 * - fold: an invagination of a membrane, dipping in from one side `at` a point along it (0 to 1).
 * - zone: a process zone within a compartment, for process modules.
 * Positions along a side (`from`, `to`, `at`) run 0 to 1, left to right or top to bottom, so they hold as the
 * membrane is resized.
 */

import { FACETS, LATERAL_SIDES } from '../facets.js'
import { SKIN_ID, SKIN_MODES } from '../skins.js'
import {
  COMPARTMENT_STYLES,
  CURIE,
  DEFAULT_FLUX,
  DEFAULT_FOLD_AT,
  DEFAULT_TONE,
  FACES,
  FLUXES,
  LIMITS,
  PIECES_SCHEMA_VERSION,
  PIECE_ID,
  PIECE_KEYS,
  PIECE_KINDS,
  SIDES,
  TEMPLATE_ID,
  TONES,
} from './constants.js'
import { topologyOf } from './topology.js'

const LOCAL_PREFIX = 'local:'
const PIECE_ID_RULE = 'must start with a letter and use only lower-case letters, digits and hyphens (1-32 characters)'

const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value)
const isPieceId = (value) => typeof value === 'string' && PIECE_ID.test(value)
const isFraction = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
const isNumberIn = (value, { min, max }) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max

/** Warns about, and so drops, every key of `raw` that `known` does not list. */
function warnUnknown(raw, known, where, warnings) {
  for (const key of Object.keys(raw))
    if (!known.includes(key)) warnings.push(`${where}: unknown key "${key}" was ignored.`)
}

/** Reads a trimmed, bounded text: required, or undefined when left out. */
function readText(raw, field, max, where, errors, { required = false } = {}) {
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
  if (!text && required) errors.push(`${where}: "${field}" is required.`)
  else if (text.length > max) errors.push(`${where}: "${field}" must be at most ${max} characters.`)
  return text || undefined
}

/** Reads an optional reference to another piece, by its id. */
function readRef(raw, field, where, errors) {
  if (raw[field] === undefined) return undefined
  if (isPieceId(raw[field])) return raw[field]
  errors.push(`${where}: "${field}" must be a piece's id.`)
  return undefined
}

/** Copies `site: false`, the only value it may be set to besides true. */
function readSite(raw, out, where, errors) {
  if (raw.site === false) out.site = false
  else if (raw.site !== undefined && raw.site !== true) errors.push(`${where}: "site" must be true or false.`)
}

/** Reads an object of finite numbers within bounds, by key. */
function readNumbers(raw, field, keys, bounds, where, errors, warnings) {
  const value = raw[field]
  if (value === undefined) return undefined
  if (!isObject(value)) {
    errors.push(`${where}: "${field}" must be an object with ${keys.map((key) => `"${key}"`).join(', ')}.`)
    return undefined
  }
  warnUnknown(value, keys, `${where}, ${field}`, warnings)
  const out = {}
  for (const key of keys) {
    const range = bounds[key]
    if (isNumberIn(value[key], range)) out[key] = value[key]
    else errors.push(`${where}: "${field}.${key}" must be a number from ${range.min} to ${range.max}.`)
  }
  return Object.keys(out).length === keys.length ? out : undefined
}

const FRAME_BOUNDS = {
  x: LIMITS.at,
  y: LIMITS.at,
  width: LIMITS.size,
  height: LIMITS.size,
}
const readFrame = (raw, where, errors, warnings) =>
  readNumbers(raw, 'frame', PIECE_KEYS.frame, FRAME_BOUNDS, where, errors, warnings)

function readSkin(raw, where, errors, warnings) {
  if (raw === undefined) return undefined
  if (!isObject(raw) || typeof raw.ref !== 'string' || !SKIN_ID.test(raw.ref)) {
    errors.push(`${where}: "skin" must be an object whose "ref" is a skin's id.`)
    return undefined
  }
  warnUnknown(raw, PIECE_KEYS.skin, `${where}, skin`, warnings)
  const skin = { ref: raw.ref, mode: SKIN_MODES[0], opacity: 1 }
  if (raw.mode !== undefined) {
    if (SKIN_MODES.includes(raw.mode)) skin.mode = raw.mode
    else errors.push(`${where}: a skin's "mode" must be one of ${SKIN_MODES.join(', ')}.`)
  }
  if (raw.opacity !== undefined) {
    if (typeof raw.opacity === 'number' && raw.opacity > 0 && raw.opacity <= 1) skin.opacity = raw.opacity
    else errors.push(`${where}: a skin's "opacity" must be a number above 0, up to 1.`)
  }
  return skin
}

/** Reads a stretch along a side: `from` and `to`, 0 to 1, the whole side when left out. */
function readStretch(raw, out, where, errors) {
  const from = raw.from ?? 0
  const to = raw.to ?? 1
  if (!isFraction(from) || !isFraction(to) || from >= to) {
    errors.push(`${where}: "from" and "to" must be numbers from 0 to 1, "from" before "to".`)
    return
  }
  out.from = from
  out.to = to
}

function readDock(raw, where, errors, warnings) {
  if (!isObject(raw)) {
    errors.push(`${where} must be an object.`)
    return null
  }
  warnUnknown(raw, PIECE_KEYS.dock, where, warnings)
  const dock = { on: readRef(raw, 'on', where, errors) }
  if (!dock.on) errors.push(`${where}: "on" must name the membrane or fold it docks to.`)
  if (raw.side !== undefined) {
    if (SIDES.includes(raw.side)) dock.side = raw.side
    else errors.push(`${where}: "side" must be one of ${SIDES.join(', ')}.`)
  }
  if (FACES.includes(raw.face)) dock.face = raw.face
  else errors.push(`${where}: "face" must be one of ${FACES.join(', ')}.`)
  readStretch(raw, dock, where, errors)
  return dock
}

function readCompartment(raw, piece, where, errors, warnings) {
  const parent = readRef(raw, 'parent', where, errors)
  if (parent) piece.parent = parent
  const frame = readFrame(raw, where, errors, warnings)
  if (frame) piece.frame = frame
  if (raw.docks !== undefined) {
    if (!Array.isArray(raw.docks) || raw.docks.length > LIMITS.docks) {
      errors.push(`${where}: "docks" must be a list of at most ${LIMITS.docks}.`)
    } else if (raw.docks.length) {
      piece.docks = raw.docks
        .map((dock, index) => readDock(dock, `${where}, dock ${index + 1}`, errors, warnings))
        .filter(Boolean)
    }
  }
  // How far a docked compartment reaches out from, or in from, the sides it is docked to.
  if (raw.depth !== undefined) {
    if (isNumberIn(raw.depth, LIMITS.depth)) piece.depth = raw.depth
    else errors.push(`${where}: "depth" must be a number from ${LIMITS.depth.min} to ${LIMITS.depth.max}.`)
  }
  piece.tone = raw.tone ?? DEFAULT_TONE
  if (!TONES.includes(piece.tone)) errors.push(`${where}: "tone" must be one of ${TONES.join(', ')}.`)
  if (raw.term !== undefined) {
    if (typeof raw.term === 'string' && CURIE.test(raw.term)) piece.term = raw.term
    else errors.push(`${where}: "term" must be an ontology term's CURIE, such as GO:0005737.`)
  }
  if (raw.style !== undefined) {
    if (COMPARTMENT_STYLES.includes(raw.style)) piece.style = raw.style
    else errors.push(`${where}: "style" must be one of ${COMPARTMENT_STYLES.join(', ')}.`)
  }
  const skin = readSkin(raw.skin, where, errors, warnings)
  if (skin) piece.skin = skin
}

function readAnnotation(raw, where, errors, warnings) {
  if (raw === undefined) return undefined
  if (!isObject(raw) || !FACETS.includes(raw.facet)) {
    errors.push(`${where}: "annotation.facet" must be one of ${FACETS.join(', ')}.`)
    return undefined
  }
  warnUnknown(raw, PIECE_KEYS.annotation, `${where}, annotation`, warnings)
  const annotation = { facet: raw.facet }
  if (raw.at !== undefined) {
    if (raw.facet !== 'lateral')
      errors.push(`${where}: "annotation.at" is only allowed when "annotation.facet" is lateral.`)
    else if (!LATERAL_SIDES.includes(raw.at))
      errors.push(`${where}: "annotation.at" must be one of ${LATERAL_SIDES.join(', ')}.`)
    else annotation.at = raw.at
  }
  return annotation
}

/**
 * Reads the spans along one side: each runs from where the one before it ends to its own `to`, the last to the end
 * of the side.
 */
function readSide(raw, side, membraneLabel, where, errors, warnings) {
  if (raw === undefined) return [{ id: side, label: `${membraneLabel} (${side})`, from: 0, to: 1 }]
  if (!Array.isArray(raw) || !raw.length || raw.length > LIMITS.spans) {
    errors.push(`${where}: "sides.${side}" must be a list of 1 to ${LIMITS.spans} spans.`)
    return []
  }
  let from = 0
  return raw
    .map((entry, index) => {
      const at = `${where}, ${side} span ${index + 1}`
      if (!isObject(entry)) {
        errors.push(`${at} must be an object.`)
        return null
      }
      warnUnknown(entry, PIECE_KEYS.span, at, warnings)
      if (!isPieceId(entry.id)) errors.push(`${at}: "id" ${PIECE_ID_RULE}.`)
      const isLast = index === raw.length - 1
      const to = entry.to ?? (isLast ? 1 : undefined)
      if (!isFraction(to) || to <= from || (isLast && to !== 1)) {
        errors.push(
          `${at}: "to" must be where it ends along the side, past where the span before it ends, and only the last span reaches 1 (and may leave "to" out).`,
        )
      }
      const span = {
        id: entry.id,
        label: readText(entry, 'label', LIMITS.label, at, errors, {
          required: true,
        }),
        from,
        to,
      }
      from = isFraction(to) ? to : from
      const annotation = readAnnotation(entry.annotation, at, errors, warnings)
      if (annotation) span.annotation = annotation
      if (entry.group !== undefined) {
        if (isPieceId(entry.group)) span.group = entry.group
        else errors.push(`${at}: "group" ${PIECE_ID_RULE}.`)
      }
      readSite(entry, span, at, errors)
      return span
    })
    .filter(Boolean)
}

function readMembrane(raw, piece, where, errors, warnings) {
  const parent = readRef(raw, 'parent', where, errors)
  if (parent) piece.parent = parent
  const encloses = raw.encloses
  if (
    !Array.isArray(encloses) ||
    !encloses.length ||
    !encloses.every(isPieceId) ||
    new Set(encloses).size !== encloses.length
  ) {
    errors.push(`${where}: "encloses" must list the compartments it encloses, each once.`)
    piece.encloses = []
  } else piece.encloses = [...encloses]
  if (raw.sides !== undefined && !isObject(raw.sides))
    errors.push(`${where}: "sides" must be an object of spans by side.`)
  const sides = isObject(raw.sides) ? raw.sides : {}
  warnUnknown(sides, SIDES, `${where}, sides`, warnings)
  piece.sides = Object.fromEntries(
    SIDES.map((side) => [side, readSide(sides[side], side, piece.label ?? 'Membrane', where, errors, warnings)]),
  )
  const ids = SIDES.flatMap((side) => piece.sides[side].map((span) => span.id))
  for (const id of new Set(ids.filter((id, index) => ids.indexOf(id) !== index)))
    errors.push(`${where}: span "${id}" is named twice.`)
  // Where the membrane is drawn, from its parent's corner, and how big at least: what it encloses fills it.
  const frame = readFrame(raw, where, errors, warnings)
  if (frame) piece.frame = frame
  const skin = readSkin(raw.skin, where, errors, warnings)
  if (skin) piece.skin = skin
}

function readTube(raw, piece, where, errors, warnings) {
  const { ends } = raw
  if (Array.isArray(ends) && ends.length === 2 && ends.every(isPieceId) && ends[0] !== ends[1]) piece.ends = [...ends]
  else {
    errors.push(`${where}: "ends" must name the two different compartments it joins, upstream first.`)
    piece.ends = []
  }
  piece.flux = raw.flux ?? DEFAULT_FLUX
  if (!FLUXES.includes(piece.flux)) errors.push(`${where}: "flux" must be one of ${FLUXES.join(', ')}.`)
  if (raw.bends !== undefined) {
    if (!Array.isArray(raw.bends) || raw.bends.length > LIMITS.bends) {
      errors.push(`${where}: "bends" must be a list of at most ${LIMITS.bends} points.`)
    } else if (raw.bends.length) {
      piece.bends = raw.bends
        .map((point, index) =>
          readNumbers(
            { point },
            'point',
            PIECE_KEYS.point,
            { x: LIMITS.at, y: LIMITS.at },
            `${where}, bend ${index + 1}`,
            errors,
            warnings,
          ),
        )
        .filter(Boolean)
    }
  }
  // How its joint is drawn, where its two ends touch.
  const skin = readSkin(raw.skin, where, errors, warnings)
  if (skin) piece.skin = skin
}

function readFold(raw, piece, where, errors) {
  piece.membrane = readRef(raw, 'membrane', where, errors)
  if (!piece.membrane) errors.push(`${where}: "membrane" must name the membrane it is a fold of.`)
  piece.side = raw.side
  if (!SIDES.includes(raw.side))
    errors.push(`${where}: "side" must be the side it dips in from: one of ${SIDES.join(', ')}.`)
  piece.at = raw.at ?? DEFAULT_FOLD_AT
  if (!isFraction(piece.at)) errors.push(`${where}: "at" must be a number from 0 to 1 along its side.`)
  if (raw.depth !== undefined) {
    if (isNumberIn(raw.depth, LIMITS.fold)) piece.depth = raw.depth
    else errors.push(`${where}: "depth" must be a number from ${LIMITS.fold.min} to ${LIMITS.fold.max}.`)
  }
}

function readZone(raw, piece, where, errors, warnings) {
  piece.compartment = readRef(raw, 'compartment', where, errors)
  if (!piece.compartment) errors.push(`${where}: "compartment" must name the compartment it is within.`)
  const frame = readFrame(raw, where, errors, warnings)
  if (frame) piece.frame = frame
}

const READERS = {
  compartment: readCompartment,
  membrane: readMembrane,
  tube: readTube,
  fold: readFold,
  zone: readZone,
}

function readPiece(raw, index, errors, warnings) {
  if (!isObject(raw)) {
    errors.push(`Piece ${index + 1} must be an object.`)
    return null
  }
  const where = isPieceId(raw.id) ? `Piece "${raw.id}"` : `Piece ${index + 1}`
  if (!isPieceId(raw.id)) errors.push(`${where}: "id" ${PIECE_ID_RULE}.`)
  if (!PIECE_KINDS.includes(raw.kind)) {
    errors.push(`${where}: "kind" must be one of ${PIECE_KINDS.join(', ')}.`)
    return null
  }
  warnUnknown(raw, PIECE_KEYS[raw.kind], where, warnings)
  const piece = {
    id: raw.id,
    kind: raw.kind,
    label: readText(raw, 'label', LIMITS.label, where, errors, {
      required: true,
    }),
  }
  READERS[raw.kind](raw, piece, where, errors, warnings)
  readSite(raw, piece, where, errors)
  return piece
}

/** Checks that what each piece names is there, and is the right kind of piece. */
function checkReferences(pieces, errors) {
  const byId = new Map()
  for (const piece of pieces) {
    if (byId.has(piece.id)) errors.push(`Piece "${piece.id}" is named twice.`)
    byId.set(piece.id, piece)
  }
  const expect = (piece, id, kinds, what) => {
    if (id === undefined) return
    if (!kinds.includes(byId.get(id)?.kind))
      errors.push(`Piece "${piece.id}": ${what} "${id}" is not a ${kinds.join(' or ')}.`)
  }
  const enclosure = new Map()
  for (const piece of pieces) {
    if (piece.kind === 'compartment') {
      expect(piece, piece.parent, ['compartment'], 'its parent')
      for (const dock of piece.docks ?? []) {
        expect(piece, dock.on, ['membrane', 'fold'], 'what it docks to')
        const kind = byId.get(dock.on)?.kind
        if (kind === 'membrane' && !dock.side)
          errors.push(`Piece "${piece.id}": a dock to membrane "${dock.on}" must say which "side".`)
        if (kind === 'fold' && dock.side) errors.push(`Piece "${piece.id}": a dock to fold "${dock.on}" has no "side".`)
      }
    }
    if (piece.kind === 'membrane') {
      expect(piece, piece.parent, ['compartment'], 'its parent')
      for (const id of piece.encloses) {
        expect(piece, id, ['compartment'], 'what it encloses')
        if (enclosure.has(id))
          errors.push(`Compartment "${id}" is enclosed by both "${enclosure.get(id)}" and "${piece.id}".`)
        enclosure.set(id, piece.id)
        const enclosed = byId.get(id)
        if (enclosed?.kind === 'compartment' && enclosed.parent !== piece.parent) {
          errors.push(
            `Membrane "${piece.id}" encloses "${id}", which stands somewhere else: what a membrane encloses stands where it does.`,
          )
        }
      }
    }
    if (piece.kind === 'tube') piece.ends.forEach((id) => expect(piece, id, ['compartment'], 'its end'))
    if (piece.kind === 'fold') {
      expect(piece, piece.membrane, ['membrane'], 'its membrane')
      // Its membrane's spans and folds are told apart by their ids.
      const membrane = byId.get(piece.membrane)
      const spans = membrane?.kind === 'membrane' ? Object.values(membrane.sides).flat() : []
      if (spans.some((span) => span.id === piece.id)) {
        errors.push(`Fold "${piece.id}" has the id of a span of membrane "${piece.membrane}".`)
      }
    }
    if (piece.kind === 'zone') expect(piece, piece.compartment, ['compartment'], 'its compartment')
  }
  // No compartment stands, through others, in itself.
  for (const piece of pieces) {
    const seen = new Set()
    for (let at = piece; at?.kind === 'compartment' && at.parent; at = byId.get(at.parent)) {
      if (seen.has(at.id)) {
        errors.push(`Compartment "${piece.id}" stands, through others, in itself.`)
        break
      }
      seen.add(at.id)
    }
  }
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

/**
 * Validates a list of pieces, filling in what each leaves out: a side's single span, a dock's whole side, a fold's
 * place along its side, a compartment's tone and a tube's flux.
 *
 * @param {*} raw - Parsed JSON.
 * @returns {{ pieces: ReadonlyArray<Object>|null, errors: string[], warnings: string[] }} pieces: a clean, frozen
 *   copy, null when there are errors; its topology is topologyOf(pieces).
 */
export function validatePieces(raw) {
  const errors = []
  const warnings = []
  if (!Array.isArray(raw)) return { pieces: null, errors: ['"pieces" must be a list.'], warnings }
  if (raw.length > LIMITS.pieces)
    return {
      pieces: null,
      errors: [`There may be at most ${LIMITS.pieces} pieces.`],
      warnings,
    }
  const pieces = raw.map((entry, index) => readPiece(entry, index, errors, warnings)).filter(Boolean)
  if (!errors.length) checkReferences(pieces, errors)
  if (errors.length) return { pieces: null, errors, warnings }
  deepFreeze(pieces)
  const topology = topologyOf(pieces)
  errors.push(...topology.problems)
  if (topology.sites.length > LIMITS.sites)
    errors.push(`The pieces offer ${topology.sites.length} sites; at most ${LIMITS.sites} are allowed.`)
  return { pieces: errors.length ? null : pieces, errors, warnings }
}

/**
 * Writes validated pieces back as a file or a save writes them: a plain copy, with each side's spans as they are
 * written, each with its `to` but the last, and none with the `from` validation fills in. A side of one span named for
 * its side, as validation fills in for a side left out, is left out.
 *
 * @param {ReadonlyArray<Object>} pieces - Validated.
 * @returns {Array<Object>} Plain objects, which validate to the same pieces.
 */
export function writtenPieces(pieces) {
  return JSON.parse(JSON.stringify(pieces)).map((piece) => {
    if (piece.kind !== 'membrane' || !piece.sides) return piece
    for (const [side, spans] of Object.entries(piece.sides)) {
      piece.sides[side] = spans.map(({ from, to, ...span }, index) =>
        index === spans.length - 1 ? span : { ...span, to },
      )
    }
    return piece
  })
}

/**
 * Writes a validated template back as a file writes it (see writtenPieces).
 *
 * @param {Object} template - Validated.
 * @returns {Object} A plain object, which validates to the same template.
 */
export const writtenTemplate = (template) => ({ ...template, pieces: writtenPieces(template.pieces) })

/**
 * Validates a template written as pieces (schema 4).
 *
 * @param {*} raw - Parsed JSON, usually a template file.
 * @param {{ allowLocalId?: boolean }} [options] - Whether the id may carry the 'local:' prefix of the user's own.
 * @returns {{ template: Object|null, errors: string[], warnings: string[] }} A clean, frozen copy; null with errors.
 */
export function validatePiecesTemplate(raw, { allowLocalId = false } = {}) {
  const errors = []
  const warnings = []
  if (!isObject(raw))
    return {
      template: null,
      errors: ['A template must be a JSON object.'],
      warnings,
    }
  warnUnknown(raw, PIECE_KEYS.assembly, 'Template', warnings)
  if (raw.schemaVersion !== PIECES_SCHEMA_VERSION) errors.push(`"schemaVersion" must be ${PIECES_SCHEMA_VERSION}.`)
  const bare =
    allowLocalId && typeof raw.id === 'string' && raw.id.startsWith(LOCAL_PREFIX)
      ? raw.id.slice(LOCAL_PREFIX.length)
      : raw.id
  if (typeof bare !== 'string' || !TEMPLATE_ID.test(bare)) {
    errors.push('"id" must start with a letter and use only lower-case letters, digits and hyphens (2-48 characters).')
  }
  const template = {
    schemaVersion: PIECES_SCHEMA_VERSION,
    id: raw.id,
    name: readText(raw, 'name', LIMITS.name, 'Template', errors, {
      required: true,
    }),
  }
  for (const field of ['description', 'author', 'license']) {
    const text = readText(raw, field, LIMITS[field], 'Template', errors)
    if (text) template[field] = text
  }
  const read = validatePieces(raw.pieces ?? [])
  warnings.push(...read.warnings)
  errors.push(...read.errors)
  if (errors.length) return { template: null, errors, warnings }
  template.pieces = read.pieces
  return { template: Object.freeze(template), errors, warnings }
}
