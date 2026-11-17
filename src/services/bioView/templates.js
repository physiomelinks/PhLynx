/**
 * Physiology templates: readable JSON scaffolds of cells, membrane facets, process areas and compartments
 * that modules can be dropped onto. Template pieces hold no maths; each one offers a site with a role,
 * and the user decides what goes on it. `bio-template.schema.json` describes the same format for IDEs.
 */

import { FACETS, LATERAL_SIDES } from './facets.js'
import { MIN_CELL } from './metrics.js'
import { SKIN_ID, SKIN_MODES } from './skins.js'

/** The template format this build understands. */
export const TEMPLATE_SCHEMA_VERSION = 1

/**
 * The version of a template with pieces version 1 has none of: an organelle, which is a cell `in` another; a
 * microdomain, which is a compartment `in` a cell; and a fold, which is a facet that dips in from a side of its cell. A template is written at the lowest version that reads it, so
 * one without them still loads in older PhLynx.
 */
export const TEMPLATE_SCHEMA_VERSION_NESTED = 2

/**
 * The version of a template with pieces placed freely or joined: a cell or compartment `at` a place of its own, a
 * compartment drawn as a tube, and links between its spaces.
 */
export const TEMPLATE_SCHEMA_VERSION_PLACED = 3

/** The shapes a compartment can be drawn in, other than a plain box. */
export const COMPARTMENT_SHAPES = ['tube']

/** What a link can carry: a flow along a conduit, a junction between two cells, or diffusion between two spaces. */
export const LINK_KINDS = ['flow', 'junction', 'diffusion']

/** How big an organelle is drawn unless its template says. */
export const ORGANELLE_SIZE = Object.freeze({ width: 280, height: 170 })

/** A template's own id. */
export const TEMPLATE_ID = /^[a-z][a-z0-9-]{1,47}$/

/** Prefixes the id of a template from the user's own library, so it never collides with a built-in. */
export const LOCAL_TEMPLATE_PREFIX = 'local:'

/**
 * @param {string} id
 * @returns {string} The id without the 'local:' prefix.
 */
export const bareTemplateId = (id) =>
  id.startsWith(LOCAL_TEMPLATE_PREFIX) ? id.slice(LOCAL_TEMPLATE_PREFIX.length) : id

/**
 * @param {*} id
 * @returns {boolean} Whether `id` is a template id from the user's own library.
 */
export const isLocalTemplateId = (id) =>
  typeof id === 'string' && id.startsWith(LOCAL_TEMPLATE_PREFIX) && TEMPLATE_ID.test(bareTemplateId(id))

/**
 * Picks an id for a template joining the user's library: `local:` and its own id, with a number added when
 * that is taken.
 *
 * @param {string} id - The template's own id, with or without the prefix.
 * @param {Iterable<string>} taken - Ids already in use.
 * @returns {string}
 */
export function freeLocalId(id, taken) {
  const prefix = LOCAL_TEMPLATE_PREFIX
  const used = new Set(taken)
  const bare = bareTemplateId(id)
  if (!used.has(prefix + bare)) return prefix + bare
  for (let n = 2; ; n++) {
    const suffix = `-${n}`
    const candidate = bare.slice(0, 48 - suffix.length) + suffix
    if (TEMPLATE_ID.test(candidate) && !used.has(prefix + candidate)) return prefix + candidate
  }
}

/** The id of a cell, facet, process, compartment or facet group within a template. */
export const PIECE_ID = /^[a-z][a-z0-9-]{0,31}$/

/** The edges of a cell a facet can lie along. */
export const EDGES = ['top', 'bottom', 'left', 'right']

/** The colours a compartment can be drawn in. */
export const TONES = ['sky', 'rose', 'teal', 'amber', 'violet', 'lime', 'slate']

/** The sides of the lateral facet an annotation can name. */
export const ANNOTATION_SIDES = LATERAL_SIDES

/** The facets an annotation can name. */
export const ANNOTATION_FACETS = FACETS

/** The site path a cell's membrane is offered at, so no facet or process may use it. */
export const MEMBRANE = 'membrane'

/** A template instance id, as it appears before the slash of a site reference. */
export const INSTANCE_ID = /^[A-Za-z0-9][A-Za-z0-9_:.-]*$/

export const LIMITS = {
  name: 64,
  description: 280,
  author: 64,
  license: 64,
  label: 64,
  cells: 16,
  processes: 8,
  compartments: 32,
  links: 32,
  rows: 16,
  sites: 64,
  bytes: 64 * 1024,
  size: { min: 120, max: 4000 },
  depth: { min: 20, max: 1000 },
  fold: { min: 80, max: 1000 },
  at: { min: -20000, max: 20000 },
}

/** The keys the validator knows for each kind of object, in the order a clean copy lists them. */
export const TEMPLATE_KEYS = {
  template: ['$schema', 'schemaVersion', 'id', 'name', 'description', 'author', 'license', 'cells', 'compartments', 'links'],
  cell: ['id', 'label', 'in', 'row', 'at', 'size', 'membrane', 'facets', 'processes', 'skin', 'site'],
  skin: ['ref', 'mode', 'opacity'],
  size: ['width', 'height'],
  membrane: ['label'],
  facet: ['id', 'label', 'edge', 'fold', 'depth', 'group', 'annotation', 'site'],
  annotation: ['facet', 'at'],
  process: ['id', 'label', 'between', 'site'],
  compartment: ['id', 'label', 'in', 'against', 'at', 'size', 'shape', 'term', 'tone', 'depth', 'skin', 'site'],
  at: ['x', 'y'],
  link: ['id', 'label', 'between', 'kind', 'site'],
}

const DEFAULT_MEMBRANE_LABEL = 'Plasma membrane'
const DEFAULT_ORGANELLE_MEMBRANE_LABEL = 'Membrane'
const DEFAULT_TONE = 'sky'
const OPPOSITE = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }
const SITE_PATH = /^[a-z][a-z0-9-]{0,31}(?:\.[a-z][a-z0-9-]{0,31})?$/

const PIECE_ID_RULE = '"id" must start with a letter and use only lower-case letters, digits and hyphens (1-32 characters).'

const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value)
const isPieceId = (value) => typeof value === 'string' && PIECE_ID.test(value)

/** Warns about, and so drops, every key of `raw` that `known` does not list. */
function warnUnknown(raw, known, where, warnings) {
  for (const key of Object.keys(raw)) {
    if (!known.includes(key)) warnings.push(`${where}: unknown key "${key}" was ignored.`)
  }
}

/** Reads a required, trimmed, bounded label. */
function requiredText(raw, field, max, where, errors) {
  if (raw[field] !== undefined && raw[field] !== null && typeof raw[field] !== 'string') {
    errors.push(`${where}: "${field}" must be text.`)
    return ''
  }
  const value = raw[field]?.trim() ?? ''
  if (!value) errors.push(`${where}: "${field}" is required.`)
  else if (value.length > max) errors.push(`${where}: "${field}" must be at most ${max} characters.`)
  return value
}

/** Reads an optional, trimmed, bounded string. */
function optionalText(raw, field, max, where, errors) {
  if (raw[field] === undefined || raw[field] === null || raw[field] === '') return undefined
  if (typeof raw[field] !== 'string') {
    errors.push(`${where}: "${field}" must be text.`)
    return undefined
  }
  const value = raw[field].trim()
  if (value.length > max) errors.push(`${where}: "${field}" must be at most ${max} characters.`)
  return value || undefined
}

/** Reads `site`, which may only switch a piece's site off. */
function siteFlag(raw, where, errors) {
  if (raw.site === undefined || raw.site === true) return true
  if (raw.site === false) return false
  errors.push(`${where}: "site" must be true or false.`)
  return true
}

/** Reads an optional finite number within bounds. */
function boundedNumber(value, { min, max }, label, errors) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    errors.push(`${label} must be a number from ${min} to ${max}.`)
    return undefined
  }
  return value
}

function readAnnotation(raw, where, errors, warnings) {
  if (raw === undefined) return undefined
  if (!isObject(raw)) {
    errors.push(`${where}: "annotation" must be an object.`)
    return undefined
  }
  warnUnknown(raw, TEMPLATE_KEYS.annotation, `${where}, annotation`, warnings)
  if (!ANNOTATION_FACETS.includes(raw.facet)) {
    errors.push(`${where}: "annotation.facet" must be one of ${ANNOTATION_FACETS.join(', ')}.`)
    return undefined
  }
  const annotation = { facet: raw.facet }
  if (raw.at !== undefined) {
    if (raw.facet !== 'lateral') {
      errors.push(`${where}: "annotation.at" is only allowed when "annotation.facet" is lateral.`)
    } else if (!ANNOTATION_SIDES.includes(raw.at)) errors.push(`${where}: "annotation.at" must be left or right.`)
    else annotation.at = raw.at
  }
  return annotation
}

function readFacet(raw, where, errors, warnings) {
  if (!isObject(raw)) {
    errors.push(`${where} must be an object.`)
    return null
  }
  warnUnknown(raw, TEMPLATE_KEYS.facet, where, warnings)
  if (!isPieceId(raw.id)) errors.push(`${where}: ${PIECE_ID_RULE}`)
  const facet = { id: raw.id, label: requiredText(raw, 'label', LIMITS.label, where, errors) }
  // A fold: an invagination of the membrane, in from the side named, in place of a stretch along a side.
  if (raw.fold !== undefined) {
    facet.fold = raw.fold
    if (!EDGES.includes(raw.fold)) errors.push(`${where}: "fold" must be the side it dips in from: one of ${EDGES.join(', ')}.`)
    if (raw.edge !== undefined) errors.push(`${where}: a fold has no "edge"; "fold" names the side it dips in from.`)
    if (raw.depth !== undefined) facet.depth = boundedNumber(raw.depth, LIMITS.fold, `${where}: "depth"`, errors)
  } else {
    facet.edge = raw.edge
    if (!EDGES.includes(raw.edge)) errors.push(`${where}: "edge" must be one of ${EDGES.join(', ')}.`)
    if (raw.depth !== undefined) errors.push(`${where}: only a fold has a "depth".`)
  }
  if (raw.group !== undefined) {
    if (isPieceId(raw.group)) facet.group = raw.group
    else errors.push(`${where}: "group" must start with a letter and use only lower-case letters, digits and hyphens.`)
  }
  const annotation = readAnnotation(raw.annotation, where, errors, warnings)
  if (annotation) facet.annotation = annotation
  if (!siteFlag(raw, where, errors)) facet.site = false
  return facet
}

function readProcess(raw, where, errors, warnings) {
  if (!isObject(raw)) {
    errors.push(`${where} must be an object.`)
    return null
  }
  warnUnknown(raw, TEMPLATE_KEYS.process, where, warnings)
  if (!isPieceId(raw.id)) errors.push(`${where}: ${PIECE_ID_RULE}`)
  const process = { id: raw.id, label: requiredText(raw, 'label', LIMITS.label, where, errors) }
  // A junction: what carries a flux between two spaces inside the cell, which are checked once the template's
  // compartments are read (see validateTemplate).
  if (raw.between !== undefined) {
    const isPair = Array.isArray(raw.between) && raw.between.length === 2 && raw.between.every(isPieceId) && raw.between[0] !== raw.between[1]
    if (isPair) process.between = [...raw.between]
    else errors.push(`${where}: "between" must name two different spaces inside the cell: the cell itself, or microdomains in it.`)
  }
  if (!siteFlag(raw, where, errors)) process.site = false
  return process
}

/**
 * Reads a place of a piece's own: where its top-left goes, from its template's.
 *
 * @returns {{x: number, y: number}|undefined}
 */
function readAt(raw, where, errors, warnings) {
  if (!isObject(raw)) {
    errors.push(`${where}: "at" must be an object with "x" and "y".`)
    return undefined
  }
  warnUnknown(raw, TEMPLATE_KEYS.at, `${where}, at`, warnings)
  const x = boundedNumber(raw.x, LIMITS.at, `${where}: "at.x"`, errors)
  const y = boundedNumber(raw.y, LIMITS.at, `${where}: "at.y"`, errors)
  return x === undefined || y === undefined ? undefined : { x, y }
}

function readSize(raw, where, errors, warnings, fallback = MIN_CELL) {
  if (raw === undefined) return { ...fallback }
  if (!isObject(raw)) {
    errors.push(`${where}: "size" must be an object with "width" and "height".`)
    return { ...MIN_CELL }
  }
  warnUnknown(raw, TEMPLATE_KEYS.size, `${where}, size`, warnings)
  return {
    width: boundedNumber(raw.width, LIMITS.size, `${where}: "size.width"`, errors),
    height: boundedNumber(raw.height, LIMITS.size, `${where}: "size.height"`, errors),
  }
}

/**
 * Reads the artwork a piece is drawn with: a skin of the workspace's, by its id, and how it fills the piece.
 *
 * @returns {{ref: string, mode: string, opacity: number}|null} Null for none, or one that can't be read.
 */
function readSkin(raw, where, errors, warnings) {
  if (raw === undefined) return null
  if (!isObject(raw)) {
    errors.push(`${where}: "skin" must be an object with a "ref".`)
    return null
  }
  warnUnknown(raw, TEMPLATE_KEYS.skin, `${where}, skin`, warnings)
  if (typeof raw.ref !== 'string' || !SKIN_ID.test(raw.ref)) {
    errors.push(`${where}: a skin's "ref" must be a skin's id: lower-case letters, digits and hyphens, starting with a letter.`)
    return null
  }
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

function readMembrane(raw, where, errors, warnings, fallback = DEFAULT_MEMBRANE_LABEL) {
  if (raw === undefined) return { label: fallback }
  if (raw === false) return false
  if (!isObject(raw)) {
    errors.push(`${where}: "membrane" must be an object with a "label", or false.`)
    return false
  }
  warnUnknown(raw, TEMPLATE_KEYS.membrane, `${where}, membrane`, warnings)
  return { label: requiredText(raw, 'label', LIMITS.label, `${where}, membrane`, errors) }
}

function readCell(raw, index, errors, warnings) {
  if (!isObject(raw)) {
    errors.push(`Cell ${index + 1} must be an object.`)
    return null
  }
  const where = isPieceId(raw.id) ? `Cell "${raw.id}"` : `Cell ${index + 1}`
  warnUnknown(raw, TEMPLATE_KEYS.cell, where, warnings)
  if (!isPieceId(raw.id)) errors.push(`${where}: ${PIECE_ID_RULE}`)
  const cell = { id: raw.id, label: requiredText(raw, 'label', LIMITS.label, where, errors) }

  cell.row = 0
  if (raw.row !== undefined) {
    if (!Number.isInteger(raw.row) || raw.row < 0 || raw.row >= LIMITS.rows) {
      errors.push(`${where}: "row" must be a whole number from 0 to ${LIMITS.rows - 1}.`)
    } else cell.row = raw.row
  }
  // An organelle: a cell inside another, which is checked once every cell is read (see validateTemplate).
  const isOrganelle = raw.in !== undefined
  if (isOrganelle) {
    if (isPieceId(raw.in)) cell.in = raw.in
    else errors.push(`${where}: "in" must be the id of the cell it is inside.`)
    if (raw.row !== undefined) errors.push(`${where}: an organelle has no "row"; it goes inside its cell.`)
    if (raw.at !== undefined) errors.push(`${where}: an organelle has no "at"; it goes inside its cell.`)
    delete cell.row
  } else if (raw.at !== undefined) {
    // A place of its own, in place of one in a row.
    if (raw.row !== undefined) errors.push(`${where}: a cell has a "row" or a place of its own ("at"), not both.`)
    const at = readAt(raw.at, where, errors, warnings)
    if (at) cell.at = at
    delete cell.row
  }
  cell.size = readSize(raw.size, where, errors, warnings, isOrganelle ? ORGANELLE_SIZE : MIN_CELL)
  cell.membrane = readMembrane(raw.membrane, where, errors, warnings, isOrganelle ? DEFAULT_ORGANELLE_MEMBRANE_LABEL : DEFAULT_MEMBRANE_LABEL)

  const ids = new Set()
  const claim = (id, label) => {
    if (!isPieceId(id)) return
    if (id === MEMBRANE) errors.push(`${where}, ${label}: "membrane" is reserved for the cell's membrane.`)
    else if (ids.has(id)) errors.push(`${where}, ${label}: id "${id}" is used more than once in this cell.`)
    ids.add(id)
  }

  cell.facets = []
  if (!Array.isArray(raw.facets) || raw.facets.length === 0) {
    errors.push(`${where}: "facets" must be a non-empty list.`)
  } else {
    const edges = new Map()
    const folds = new Map()
    const aliases = new Map()
    raw.facets.forEach((rawFacet, i) => {
      const label = `facet ${i + 1}`
      const facet = readFacet(rawFacet, `${where}, ${label}`, errors, warnings)
      if (!facet) return
      claim(facet.id, label)
      if (EDGES.includes(facet.fold)) {
        if (folds.has(facet.fold)) {
          errors.push(`${where}, ${label}: the ${facet.fold} side already has the fold "${folds.get(facet.fold)}"; a side has one at most.`)
        } else folds.set(facet.fold, facet.id)
      }
      // Several facets may share an edge: they take a stretch of it each, in the order given.
      if (EDGES.includes(facet.edge) && !edges.has(facet.edge)) edges.set(facet.edge, facet.id)
      if (facet.annotation) {
        const alias = `${facet.annotation.facet}${facet.annotation.at ? ` (${facet.annotation.at})` : ''}`
        if (aliases.has(alias)) {
          errors.push(`${where}, ${label}: annotation ${alias} is already given to facet "${aliases.get(alias)}".`)
        } else aliases.set(alias, facet.id)
      }
      cell.facets.push(facet)
    })
  }

  cell.processes = []
  if (raw.processes !== undefined) {
    if (!Array.isArray(raw.processes)) errors.push(`${where}: "processes" must be a list.`)
    else if (raw.processes.length > LIMITS.processes) {
      errors.push(`${where}: a cell can have at most ${LIMITS.processes} processes.`)
    } else {
      raw.processes.forEach((rawProcess, i) => {
        const label = `process ${i + 1}`
        const process = readProcess(rawProcess, `${where}, ${label}`, errors, warnings)
        if (!process) return
        claim(process.id, label)
        cell.processes.push(process)
      })
    }
  }

  const skin = readSkin(raw.skin, where, errors, warnings)
  if (skin) cell.skin = skin
  if (!siteFlag(raw, where, errors)) cell.site = false
  return cell
}

/**
 * Works out the shape a compartment takes from the facets it lies against.
 *
 * @param {Array<Object>} cells - Clean cells, in declaration order.
 * @param {Array<string>} against - 'cell.facet' references.
 * @returns {{ form: 'band'|'gap'|'column'|'free'|null, error?: string }} form is null when `against` is not allowed.
 */
function formOf(cells, against) {
  if (against.length === 0) return { form: 'free' }
  const resolved = []
  for (const [i, ref] of against.entries()) {
    const [cellId, facetId, extra] = typeof ref === 'string' ? ref.split('.') : []
    const cell = cells.find((entry) => entry.id === cellId)
    const facet = extra === undefined && cell?.facets.find((entry) => entry.id === facetId)
    if (!facet) {
      return { form: null, error: `"against" entry ${i + 1} (${JSON.stringify(ref)}) does not name a cell's facet as "cell.facet".` }
    }
    if (cell.in) {
      return { form: null, error: `"against" entry ${i + 1} (${JSON.stringify(ref)}) is an organelle's facet; a compartment lies against a cell's.` }
    }
    if (facet.fold) {
      return { form: null, error: `"against" entry ${i + 1} (${JSON.stringify(ref)}) is a fold; a compartment lies against a side of a cell, and fills the folds in from it.` }
    }
    if (resolved.some((entry) => entry.cell === cell && entry.facet === facet)) {
      return { form: null, error: `"against" names "${ref}" more than once.` }
    }
    resolved.push({ cell, facet })
  }

  const allowed =
    'A compartment lies against facets on the same top or bottom edge of cells in one row (a band), ' +
    'two facing facets of neighbouring cells (the gap between them), facets down one side of one cell (a column), ' +
    'facets on more than one side of one cell (all round it), or nothing.'
  const edges = resolved.map((entry) => entry.facet.edge)
  const horizontal = (edge) => edge === 'top' || edge === 'bottom'
  const isOneCell = resolved.every((entry) => entry.cell === resolved[0].cell)
  // A cell with a place of its own is in no row, so it shares no band or gap with another.
  if (!isOneCell && resolved.some((entry) => entry.cell.at)) {
    return { form: null, error: `a cell placed freely ("at") shares no compartment with another cell; join their spaces with a link. ${allowed}` }
  }
  const isOneEdge = edges.every((edge) => edge === edges[0])

  if (isOneCell && isOneEdge && !horizontal(edges[0])) return { form: 'column' }
  // The space round a cell, which the proteins on every side named meet.
  if (isOneCell && !isOneEdge) return { form: 'surround' }
  if (edges.every((edge) => edge === edges[0]) && horizontal(edges[0])) {
    if (resolved.every((entry) => entry.cell.row === resolved[0].cell.row)) return { form: 'band' }
    return { form: null, error: `the cells of a band must share a row. ${allowed}` }
  }
  if (resolved.length === 2 && OPPOSITE[edges[0]] === edges[1]) {
    const [first, second] = edges[0] === 'right' || edges[0] === 'bottom' ? resolved : [resolved[1], resolved[0]]
    const a = first.cell
    const b = second.cell
    if (first.facet.edge === 'right') {
      const row = cells.filter((cell) => cell.row === a.row && !cell.in)
      if (b.row === a.row && row[row.indexOf(a) + 1] === b) return { form: 'gap' }
      const error = `"${a.id}" and "${b.id}" must be neighbours in one row, "${a.id}" first, to share a gap.`
      return { form: null, error: `${error} ${allowed}` }
    }
    if (b.row === a.row + 1) return { form: 'gap' }
    return { form: null, error: `"${b.id}" must be in the row just below "${a.id}" to share a gap. ${allowed}` }
  }
  return { form: null, error: allowed }
}

/**
 * Says what is wrong with a microdomain's place, if anything.
 *
 * @param {Array<Object>} cells - Clean cells.
 * @param {*} inside - The id of the cell it is in.
 * @param {*} against - 'cell.facet' references.
 * @returns {string|null}
 */
function microdomainError(cells, inside, against) {
  const cell = isPieceId(inside) && cells.find((entry) => entry.id === inside)
  if (!cell) return `"in" must be the id of the cell it is inside.`
  if (cell.in) return `"${cell.id}" is an organelle; a microdomain is in a cell.`
  const rule =
    'A microdomain lies against facets of its cell, one facet of an organelle in that cell, or one of each on the same side; ' +
    'against a fold and an organelle, the organelle’s facet is its right one for a fold in from the top or bottom, and its bottom one for a fold in from the left or right.'
  if (!Array.isArray(against) || against.length < 1 || against.length > LIMITS.sites) return `"against" must name the facets it lies against. ${rule}`
  if (new Set(against).size !== against.length) return `"against" names a facet more than once. ${rule}`
  const found = []
  for (const ref of against) {
    const [cellId, facetId, extra] = typeof ref === 'string' ? ref.split('.') : []
    const owner = cells.find((entry) => entry.id === cellId)
    const facet = extra === undefined && owner?.facets.find((entry) => entry.id === facetId)
    if (!facet || (owner !== cell && owner.in !== cell.id)) return `"against" entry ${JSON.stringify(ref)} is not a facet of "${cell.id}" or of an organelle in it. ${rule}`
    found.push({ isOwn: owner === cell, edge: facet.edge, fold: facet.fold })
  }
  // Between the cell's membrane and an organelle's it has one facet of each; else any of the cell's own.
  const others = found.filter((entry) => !entry.isOwn)
  if (others.length > 1 || (others.length === 1 && found.length !== 2 && found.length !== 1)) return rule
  if (found.length === 2 && others.length === 1) {
    const own = found.find((entry) => entry.isOwn)
    const other = others[0]
    // A fold comes in at the far end of its side, so it is the organelle's far side that faces it.
    const facing = own.fold ? FOLD_FACES[own.fold] : own.edge
    if (other.edge !== facing) return rule
  }
  return null
}

/** An ontology term as a CURIE: a prefix, a colon and a local id. */
const TERM = /^[A-Za-z][A-Za-z0-9_]{0,15}:[A-Za-z0-9_]{1,32}$/

/** The side of an organelle that faces a fold in from each side of its cell. */
export const FOLD_FACES = Object.freeze({ top: 'right', bottom: 'right', left: 'bottom', right: 'bottom' })

function readCompartment(raw, index, cells, errors, warnings) {
  if (!isObject(raw)) {
    errors.push(`Compartment ${index + 1} must be an object.`)
    return null
  }
  const where = isPieceId(raw.id) ? `Compartment "${raw.id}"` : `Compartment ${index + 1}`
  warnUnknown(raw, TEMPLATE_KEYS.compartment, where, warnings)
  if (!isPieceId(raw.id)) errors.push(`${where}: ${PIECE_ID_RULE}`)
  const compartment = { id: raw.id, label: requiredText(raw, 'label', LIMITS.label, where, errors), against: [] }

  // A microdomain: a compartment inside a cell, against a facet of the cell, of an organelle in it, or of both.
  if (raw.in !== undefined) {
    compartment.in = raw.in
    const error = microdomainError(cells, raw.in, raw.against)
    if (error) errors.push(`${where}: ${error}`)
    else compartment.against = [...raw.against]
  } else if (raw.against !== undefined) {
    if (!Array.isArray(raw.against)) errors.push(`${where}: "against" must be a list of "cell.facet" names.`)
    else {
      const { form, error } = formOf(cells, raw.against)
      if (!form) errors.push(`${where}: ${error}`)
      compartment.against = [...raw.against]
    }
  }

  compartment.tone = DEFAULT_TONE
  if (raw.tone !== undefined) {
    if (!TONES.includes(raw.tone)) errors.push(`${where}: "tone" must be one of ${TONES.join(', ')}.`)
    else compartment.tone = raw.tone
  }
  if (raw.depth !== undefined) compartment.depth = boundedNumber(raw.depth, LIMITS.depth, `${where}: "depth"`, errors)
  // A place and a size of its own, for one that lies against nothing.
  const isFree = raw.in === undefined && !(Array.isArray(raw.against) && raw.against.length)
  if (raw.at !== undefined) {
    if (!isFree) errors.push(`${where}: only a compartment that lies against nothing has a place of its own ("at").`)
    const at = readAt(raw.at, where, errors, warnings)
    if (at) compartment.at = at
  }
  if (raw.size !== undefined) {
    if (!isFree) errors.push(`${where}: only a compartment that lies against nothing has a "size" of its own.`)
    compartment.size = readSize(raw.size, where, errors, warnings)
  }
  // Drawn as a tube: a stretch of vessel or duct, open at its two ends.
  if (raw.shape !== undefined) {
    if (!COMPARTMENT_SHAPES.includes(raw.shape)) errors.push(`${where}: "shape" must be one of ${COMPARTMENT_SHAPES.join(', ')}.`)
    else if (raw.in !== undefined) errors.push(`${where}: a microdomain has no "shape".`)
    else compartment.shape = raw.shape
  }
  // What annotations call the place, to tell it from the cell's other spaces: an ontology term, as a CURIE.
  if (raw.term !== undefined) {
    if (typeof raw.term === 'string' && TERM.test(raw.term)) compartment.term = raw.term
    else errors.push(`${where}: "term" must be an ontology term as a CURIE, such as GO:0001750.`)
  }
  const skin = readSkin(raw.skin, where, errors, warnings)
  if (skin) compartment.skin = skin
  if (!siteFlag(raw, where, errors)) compartment.site = false
  return compartment
}

/**
 * Reads a link: what carries a flux between two of the template's spaces, such as two stretches of a vessel or
 * two cells joined by gap junctions. Its ends are checked once every piece is read (see validateTemplate).
 */
function readLink(raw, index, errors, warnings) {
  if (!isObject(raw)) {
    errors.push(`Link ${index + 1} must be an object.`)
    return null
  }
  const where = isPieceId(raw.id) ? `Link "${raw.id}"` : `Link ${index + 1}`
  warnUnknown(raw, TEMPLATE_KEYS.link, where, warnings)
  if (!isPieceId(raw.id)) errors.push(`${where}: ${PIECE_ID_RULE}`)
  const link = { id: raw.id, label: requiredText(raw, 'label', LIMITS.label, where, errors), between: [], kind: LINK_KINDS[0] }
  const isPair = Array.isArray(raw.between) && raw.between.length === 2 && raw.between.every(isPieceId) && raw.between[0] !== raw.between[1]
  if (isPair) link.between = [...raw.between]
  else errors.push(`${where}: "between" must name two different spaces: cells or compartments of the template.`)
  if (raw.kind !== undefined) {
    if (LINK_KINDS.includes(raw.kind)) link.kind = raw.kind
    else errors.push(`${where}: "kind" must be one of ${LINK_KINDS.join(', ')}.`)
  }
  if (!siteFlag(raw, where, errors)) link.site = false
  return link
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

/**
 * Checks a template and returns a frozen clean copy, with defaults filled in and unknown keys dropped.
 *
 * @param {*} raw - Parsed JSON.
 * @param {Object} [options]
 * @param {boolean} [options.allowLocalId=false] - Accept ids with the 'local:' prefix.
 * @returns {{ template: Object|null, errors: Array<string>, warnings: Array<string> }} `template` is null when
 *   there are errors.
 */
export function validateTemplate(raw, { allowLocalId = false } = {}) {
  const errors = []
  const warnings = []
  if (!isObject(raw)) return { template: null, errors: ['A template must be a JSON object.'], warnings }

  let bytes = Infinity
  try {
    bytes = new TextEncoder().encode(JSON.stringify(raw)).length
  } catch {
    // Not serialisable, so too big to read.
  }
  if (bytes > LIMITS.bytes) {
    return { template: null, errors: [`A template must be at most ${LIMITS.bytes / 1024} KB.`], warnings }
  }

  const where = 'Template'
  warnUnknown(raw, TEMPLATE_KEYS.template, where, warnings)
  const versions = [TEMPLATE_SCHEMA_VERSION, TEMPLATE_SCHEMA_VERSION_NESTED, TEMPLATE_SCHEMA_VERSION_PLACED]
  if (!versions.includes(raw.schemaVersion)) errors.push(`${where}: "schemaVersion" must be ${versions.slice(0, -1).join(', ')} or ${versions.at(-1)}.`)
  const id = typeof raw.id === 'string' && allowLocalId ? bareTemplateId(raw.id) : raw.id
  if (typeof id !== 'string' || !TEMPLATE_ID.test(id)) {
    errors.push(`${where}: "id" must start with a letter and use only lower-case letters, digits and hyphens (2-48 characters).`)
  }
  const name = requiredText(raw, 'name', LIMITS.name, where, errors)
  const description = optionalText(raw, 'description', LIMITS.description, where, errors)
  const author = optionalText(raw, 'author', LIMITS.author, where, errors)
  const license = optionalText(raw, 'license', LIMITS.license, where, errors)

  const cells = []
  // A template of compartments alone, as a stretch of vessel is, has no cells.
  const hasCompartments = Array.isArray(raw.compartments) && raw.compartments.length > 0
  const isCellless = hasCompartments && (raw.cells === undefined || (Array.isArray(raw.cells) && raw.cells.length === 0))
  if (isCellless) {
    // No cells to read.
  } else if (!Array.isArray(raw.cells) || raw.cells.length === 0) errors.push(`${where}: "cells" must be a non-empty list, unless the template has compartments.`)
  else if (raw.cells.length > LIMITS.cells) errors.push(`A template can have at most ${LIMITS.cells} cells.`)
  else {
    raw.cells.forEach((rawCell, i) => {
      const cell = readCell(rawCell, i, errors, warnings)
      if (cell) cells.push(cell)
    })
  }

  // Organelles: each inside a cell that is not itself one, and only where the template's version has them.
  const organelles = cells.filter((cell) => cell.in)
  if (organelles.length && raw.schemaVersion === TEMPLATE_SCHEMA_VERSION) {
    errors.push(`${where}: an organelle (a cell "in" another) needs "schemaVersion" ${TEMPLATE_SCHEMA_VERSION_NESTED}.`)
  }
  for (const organelle of organelles) {
    const parent = cells.find((cell) => cell.id === organelle.in)
    if (!parent || parent === organelle) errors.push(`Cell "${organelle.id}": there is no other cell "${organelle.in}" for it to be in.`)
    else if (parent.in) errors.push(`Cell "${organelle.id}": "${parent.id}" is itself inside a cell; organelles don't nest.`)
  }
  if (cells.length && organelles.length === cells.length) errors.push(`${where}: at least one cell must not be inside another.`)
  // Folds, too, are read only at the version that has them, and only a cell has them.
  const folded = cells.filter((cell) => cell.facets.some((facet) => facet.fold))
  if (folded.length && raw.schemaVersion === TEMPLATE_SCHEMA_VERSION) {
    errors.push(`${where}: a fold (a facet with "fold") needs "schemaVersion" ${TEMPLATE_SCHEMA_VERSION_NESTED}.`)
  }
  for (const cell of folded) if (cell.in) errors.push(`Cell "${cell.id}": an organelle has no folds.`)

  const compartments = []
  if (raw.compartments !== undefined) {
    if (!Array.isArray(raw.compartments)) errors.push(`${where}: "compartments" must be a list.`)
    else if (raw.compartments.length > LIMITS.compartments) {
      errors.push(`A template can have at most ${LIMITS.compartments} compartments.`)
    } else {
      raw.compartments.forEach((rawCompartment, i) => {
        const compartment = readCompartment(rawCompartment, i, cells, errors, warnings)
        if (compartment) compartments.push(compartment)
      })
    }
  }

  // Microdomains, too, are read only at the version that has them; each facet is against one at most.
  const microdomains = compartments.filter((compartment) => compartment.in !== undefined)
  if (microdomains.length && raw.schemaVersion === TEMPLATE_SCHEMA_VERSION) {
    errors.push(`${where}: a microdomain (a compartment "in" a cell) needs "schemaVersion" ${TEMPLATE_SCHEMA_VERSION_NESTED}.`)
  }
  const within = new Map()
  for (const microdomain of microdomains) {
    for (const name of microdomain.against) {
      if (within.has(name)) errors.push(`Compartment "${microdomain.id}": facet "${name}" is already against the microdomain "${within.get(name)}".`)
      else within.set(name, microdomain.id)
    }
  }

  // Junctions: each between two of its cell's own spaces, and only where the template's version has them.
  const junctions = cells.flatMap((cell) => cell.processes.filter((process) => process.between).map((process) => [cell, process]))
  if (junctions.length && raw.schemaVersion === TEMPLATE_SCHEMA_VERSION) {
    errors.push(`${where}: a junction (a process "between" two spaces) needs "schemaVersion" ${TEMPLATE_SCHEMA_VERSION_NESTED}.`)
  }
  for (const [cell, process] of junctions) {
    const isSpace = (id) => id === cell.id || microdomains.some((microdomain) => microdomain.id === id && microdomain.in === cell.id)
    const unknown = process.between.find((id) => !isSpace(id))
    if (cell.in) errors.push(`Cell "${cell.id}": an organelle has no junctions.`)
    else if (unknown) errors.push(`Cell "${cell.id}", process "${process.id}": "${unknown}" is not the cell or a microdomain in it.`)
  }

  const filledBy = new Map()
  for (const compartment of compartments) {
    if (compartment.in !== undefined || formOf(cells, compartment.against).form !== 'gap') continue
    compartment.against.forEach(name => filledBy.set(name, compartment.id))
  }
  for (const compartment of compartments) {
    for (const name of compartment.against) {
      const gap = filledBy.get(name)
      if (gap && gap !== compartment.id) {
        errors.push(`Compartment "${compartment.id}": facet "${name}" is already filled by the gap "${gap}".`)
      }
    }
  }

  // Links: each between two spaces of the template, and no two between the same pair.
  const links = []
  if (raw.links !== undefined) {
    if (!Array.isArray(raw.links)) errors.push(`${where}: "links" must be a list.`)
    else if (raw.links.length > LIMITS.links) errors.push(`A template can have at most ${LIMITS.links} links.`)
    else {
      raw.links.forEach((rawLink, i) => {
        const link = readLink(rawLink, i, errors, warnings)
        if (link) links.push(link)
      })
    }
  }
  const joined = new Set()
  for (const link of links) {
    const unknown = link.between.find((id) => ![...cells, ...compartments].some((piece) => piece.id === id))
    if (unknown) errors.push(`Link "${link.id}": there is no cell or compartment "${unknown}".`)
    const pair = [...link.between].sort().join(' ')
    if (pair && joined.has(pair)) errors.push(`Link "${link.id}": "${link.between[0]}" and "${link.between[1]}" are already linked.`)
    joined.add(pair)
  }

  const seen = new Set()
  for (const piece of [...cells, ...compartments, ...links]) {
    if (!isPieceId(piece.id)) continue
    if (seen.has(piece.id)) errors.push(`Id "${piece.id}" is used by more than one cell, compartment or link.`)
    seen.add(piece.id)
  }

  // Pieces placed freely or joined are read only at the version that has them.
  const isPlaced =
    links.length > 0 ||
    isCellless ||
    cells.some((cell) => cell.at) ||
    compartments.some((compartment) => compartment.at || compartment.size || compartment.shape)
  if (isPlaced && versions.includes(raw.schemaVersion) && raw.schemaVersion < TEMPLATE_SCHEMA_VERSION_PLACED) {
    errors.push(`${where}: a place of a piece's own ("at"), a compartment's "size" or "shape", a link, or a template without cells needs "schemaVersion" ${TEMPLATE_SCHEMA_VERSION_PLACED}.`)
  }

  const isNested = organelles.length || microdomains.length || folded.length || junctions.length
  const schemaVersion = isPlaced ? TEMPLATE_SCHEMA_VERSION_PLACED : isNested ? TEMPLATE_SCHEMA_VERSION_NESTED : TEMPLATE_SCHEMA_VERSION
  const template = { schemaVersion, id: raw.id, name }
  if (description) template.description = description
  if (author) template.author = author
  if (license) template.license = license
  template.cells = cells
  template.compartments = compartments
  // Listed only where there are some, so a template without them reads as it did.
  if (links.length) template.links = links

  const sites = sitesOf(template).length
  if (sites > LIMITS.sites) errors.push(`A template can offer at most ${LIMITS.sites} sites; this one offers ${sites}.`)

  if (errors.length) return { template: null, errors, warnings }
  return { template: deepFreeze(template), errors, warnings }
}

/**
 * Lists the sites a template offers, cell by cell and then compartment by compartment.
 *
 * @param {Object} template - A validated template.
 * @returns {Array<{ path: string, role: string, kind: 'slots'|'single', label: string, cell?: string,
 *   facet?: string, process?: string, compartment?: string }>}
 */
export function sitesOf(template) {
  const sites = []
  for (const cell of template.cells) {
    const piece = { cell: cell.id }
    // An organelle's inside is a space enclosed by its membrane, as a cell's is: both are offered as one.
    if (cell.site !== false) sites.push({ path: cell.id, role: 'cytosol', kind: 'single', ...piece, label: cell.label })
    if (cell.membrane) {
      const label = cell.membrane.label
      sites.push({ path: `${cell.id}.${MEMBRANE}`, role: 'membrane', kind: 'single', ...piece, label })
    }
    for (const facet of cell.facets) {
      if (facet.site === false) continue
      const path = `${cell.id}.${facet.id}`
      sites.push({ path, role: 'membraneProtein', kind: 'slots', ...piece, facet: facet.id, label: facet.label })
    }
    for (const process of cell.processes) {
      if (process.site === false) continue
      const path = `${cell.id}.${process.id}`
      sites.push({ path, role: 'cytosolic', kind: 'slots', ...piece, process: process.id, label: process.label })
    }
  }
  for (const compartment of template.compartments) {
    if (compartment.site === false) continue
    const { id, label } = compartment
    sites.push({ path: id, role: 'region', kind: 'single', compartment: id, label })
  }
  // A link takes one module: what carries the flux between its two spaces, as a process does inside a cell.
  for (const link of template.links ?? []) {
    if (link.site === false) continue
    sites.push({ path: link.id, role: 'cytosolic', kind: 'single', link: link.id, label: link.label })
  }
  return sites
}

/**
 * Gives the shape a compartment of a validated template takes.
 *
 * @param {Object} template - A validated template.
 * @param {Object|string} compartment - The compartment, or its id.
 * @returns {'band'|'gap'|'column'|'surround'|'free'|'inner'|null} 'inner' for a microdomain; null when the
 *   template has no such compartment.
 */
export function compartmentForm(template, compartment) {
  const entry =
    typeof compartment === 'string' ? template.compartments.find((c) => c.id === compartment) : compartment
  if (!entry) return null
  if (entry.in !== undefined) return 'inner'
  return formOf(template.cells, entry.against ?? []).form
}

/**
 * Names a site of a template instance, as stored in `node.data.bioView.site`.
 *
 * @param {string} instanceId - The template instance, e.g. 'bt-x1'.
 * @param {string} path - The site's path, e.g. 'cell.apical'.
 * @returns {string|null} '<instanceId>/<path>', or null when either part is malformed.
 */
export function siteRef(instanceId, path) {
  if (typeof instanceId !== 'string' || !INSTANCE_ID.test(instanceId)) return null
  if (typeof path !== 'string' || !SITE_PATH.test(path)) return null
  return `${instanceId}/${path}`
}

/**
 * Splits a site reference into its template instance and site path.
 *
 * @param {*} ref - '<instanceId>/<path>'.
 * @returns {{ instance: string, path: string }|null} null when `ref` is not a site reference.
 */
export function parseSiteRef(ref) {
  if (typeof ref !== 'string') return null
  const slash = ref.indexOf('/')
  if (slash < 0) return null
  const instance = ref.slice(0, slash)
  const path = ref.slice(slash + 1)
  return siteRef(instance, path) ? { instance, path } : null
}

/**
 * The pairs of a template's sites that sit next to each other: each facet with its cell's inside and
 * membrane and with every compartment against it, each process area with its cell's inside, and each
 * cell's inside with its membrane. An organelle's facets have the inside of the cell it is in as their outside.
 * A facet against a microdomain has it, in place of the cell's inside, on the side the cell's inside would be.
 * Only offered sites count.
 *
 * @param {Object} template - A validated template.
 * @returns {Array<[string, string, string, string]>} [path, its neighbour, how the neighbour lies to the first,
 *   and how the first lies to it].
 */
function neighbourPairs(template) {
  const offered = new Set(sitesOf(template).map((site) => site.path))
  const pairs = []
  const pair = (a, b, toA, toB) => offered.has(a) && offered.has(b) && pairs.push([a, b, toA, toB])
  for (const cell of template.cells) {
    const membrane = `${cell.id}.${MEMBRANE}`
    if (cell.membrane) pair(cell.id, membrane, 'membrane', 'inside')
    for (const facet of cell.facets) {
      const path = `${cell.id}.${facet.id}`
      // The microdomain against it, if it offers a site: what the facet's proteins meet, not the cell's inside.
      const microdomain = template.compartments.find((entry) => entry.in !== undefined && entry.against.includes(path) && offered.has(entry.id))
      if (cell.in) {
        pair(path, cell.id, 'inside', 'protein')
        pair(path, microdomain?.id ?? cell.in, 'outside', 'protein')
      } else {
        pair(path, microdomain?.id ?? cell.id, 'inside', 'protein')
        // It is still in its cell's membrane, whose area and potential are the cell's to give.
        if (microdomain) pair(path, cell.id, 'membrane', 'embedded')
      }
      if (cell.membrane) pair(path, membrane, 'membrane', 'protein')
      // A fold's outside is that of the side it dips in from: its lumen is the same space.
      const side = facet.fold ? cell.facets.find((entry) => entry.edge === facet.fold) : facet
      const outer = side && `${cell.id}.${side.id}`
      for (const compartment of template.compartments) {
        if (compartment.in === undefined && compartment.against.includes(outer)) pair(path, compartment.id, 'outside', 'protein')
      }
    }
    for (const process of cell.processes) {
      const path = `${cell.id}.${process.id}`
      // A junction lies along the way from its first space to its second; any other process in its cell's inside.
      if (process.between) {
        pair(path, process.between[0], 'upstream', 'downstream')
        pair(path, process.between[1], 'downstream', 'upstream')
      } else pair(path, cell.id, 'inside', 'process')
    }
  }
  // A link lies along the way from its first space to its second, as a junction does inside a cell.
  for (const link of template.links ?? []) {
    pair(link.id, link.between[0], 'upstream', 'downstream')
    pair(link.id, link.between[1], 'downstream', 'upstream')
  }
  return pairs
}

/**
 * The sites next to one of a template's sites, which a module dropped there connects to: a facet's cell
 * inside, membrane and the compartments against it; a process area's cell inside; a cell's membrane,
 * facets and process areas; a membrane's cell and facets; a compartment's facets. The relation holds both
 * ways, so modules dropped in any order end up joined the same.
 *
 * @param {Object} template - A validated template.
 * @param {string} path - One of its site paths.
 * @returns {Array<{path: string, relation: 'inside'|'outside'|'membrane'|'protein'|'process'|'embedded'|'upstream'|'downstream'}>}
 *   relation: how the neighbour lies to the site ('embedded': a protein in the cell's membrane that meets a
 *   microdomain, not the cell's inside; 'upstream' and 'downstream': a junction and the spaces it joins); empty for
 *   a path the template doesn't offer.
 */
export function siteNeighbours(template, path) {
  const neighbours = []
  for (const [a, b, toA, toB] of neighbourPairs(template)) {
    if (a === path) neighbours.push({ path: b, relation: toA })
    else if (b === path) neighbours.push({ path: a, relation: toB })
  }
  return neighbours
}

/** The pieces a placed template can add to its template's own, by the key its edits list them under. */
const ADDED_KINDS = ['cells', 'facets', 'processes', 'compartments', 'links']

/**
 * Copies a placed template's own changes to its template, or gives null when there are none. Each added piece
 * is a template piece as written in a template file, a facet or process with the `cell` it belongs to; the
 * template's validation checks them once merged (see editedTemplate). Each removed path is a piece of the
 * template's own: a cell, a cell's membrane, facet or process, or a compartment. Each label is the name a piece, its
 * own or added, goes by here, by its path.
 *
 * @param {*} raw - From a saved instance.
 * @returns {{ added?: { cells?: Array<Object>, facets?: Array<Object>, processes?: Array<Object>,
 *   compartments?: Array<Object> }, removed?: string[], labels?: Object<string, string> }|null}
 */
export function normaliseEdits(raw) {
  if (!isObject(raw)) return null
  const edits = {}
  const added = {}
  for (const kind of ADDED_KINDS) {
    const pieces = Array.isArray(raw.added?.[kind]) ? raw.added[kind].filter(isObject) : []
    if (pieces.length) added[kind] = JSON.parse(JSON.stringify(pieces))
  }
  if (Object.keys(added).length) edits.added = added
  const removed = Array.isArray(raw.removed) ? raw.removed.filter((path) => typeof path === 'string' && SITE_PATH.test(path)) : []
  if (removed.length) edits.removed = [...new Set(removed)]
  const labels = Object.entries(isObject(raw.labels) ? raw.labels : {})
    .filter(([path, label]) => SITE_PATH.test(path) && typeof label === 'string' && label.trim())
    .map(([path, label]) => [path, label.trim().slice(0, LIMITS.label)])
  if (labels.length) edits.labels = Object.fromEntries(labels)
  // The skin a cell or compartment is drawn with here; null for none, over the template's own.
  const skins = Object.entries(isObject(raw.skins) ? raw.skins : {}).filter(
    ([path, skin]) => SITE_PATH.test(path) && !path.includes('.') && (skin === null || isObject(skin))
  )
  if (skins.length) edits.skins = JSON.parse(JSON.stringify(Object.fromEntries(skins)))
  // The place of its own a cell or compartment has here; null for none, over the template's own.
  const isPoint = (at) => isObject(at) && Number.isFinite(at.x) && Number.isFinite(at.y)
  const places = Object.entries(isObject(raw.places) ? raw.places : {}).filter(
    ([path, at]) => SITE_PATH.test(path) && !path.includes('.') && (at === null || isPoint(at))
  )
  if (places.length) edits.places = Object.fromEntries(places.map(([path, at]) => [path, at && { x: Math.round(at.x), y: Math.round(at.y) }]))
  return Object.keys(edits).length ? edits : null
}

/**
 * Takes pieces out of a raw template: a cell takes its facets and processes with it, and a compartment stops lying
 * against a facet that goes, going too when it lay against nothing else.
 *
 * @param {Object} raw - A template's plain copy, changed in place.
 * @param {string[]} paths
 */
function removePieces(raw, paths) {
  // A cell that goes takes its organelles with it, and with them what was against them.
  const cellsGone = new Set(paths.filter((path) => !path.includes('.')))
  for (const cell of raw.cells) if (cellsGone.has(cell.in)) cellsGone.add(cell.id)
  const gone = (entry) => paths.includes(entry) || cellsGone.has(entry.split('.')[0])
  for (const path of paths) {
    const [first, second] = path.split('.')
    if (second === undefined) {
      // A cell takes its organelles with it.
      raw.cells = raw.cells.filter((cell) => cell.id !== first && cell.in !== first)
      raw.compartments = (raw.compartments ?? []).filter((compartment) => compartment.id !== first)
      continue
    }
    const cell = raw.cells.find((entry) => entry.id === first)
    if (!cell) continue
    if (second === MEMBRANE) cell.membrane = false
    cell.facets = cell.facets.filter((facet) => facet.id !== second)
    cell.processes = (cell.processes ?? []).filter((process) => process.id !== second)
  }
  raw.compartments = (raw.compartments ?? []).flatMap((compartment) => {
    const against = compartment.against ?? []
    const kept = against.filter((entry) => !gone(entry))
    if (kept.length === against.length) return [compartment]
    return kept.length ? [{ ...compartment, against: kept }] : []
  })
  // A link goes by its own path, and with either of the spaces it joins.
  const spaces = new Set([...raw.cells, ...raw.compartments].map((piece) => piece.id))
  raw.links = (raw.links ?? []).filter((link) => !paths.includes(link.id) && (link.between ?? []).every((id) => spaces.has(id)))
  if (!raw.links.length) delete raw.links
}

/**
 * Merges a placed template's own changes into its template.
 *
 * @param {Object} template - A validated template.
 * @param {Object|null} edits - From normaliseEdits.
 * @returns {{ template: Object|null, errors: Array<string> }} The validated result; null when it has errors.
 */
export function editedTemplate(template, edits) {
  if (!edits) return { template, errors: [] }
  const raw = JSON.parse(JSON.stringify(template))
  const { cells = [], facets = [], processes = [], compartments = [], links = [] } = edits.added ?? {}
  // An added piece may be one only the highest version reads; the result is at the lowest that reads it.
  raw.schemaVersion = TEMPLATE_SCHEMA_VERSION_PLACED
  raw.cells = [...raw.cells, ...cells]
  if (links.length) raw.links = [...(raw.links ?? []), ...links]
  for (const [pieces, key] of [
    [facets, 'facets'],
    [processes, 'processes'],
    [compartments, null],
  ]) {
    for (const { cell: cellId, ...piece } of pieces) {
      if (!key) {
        raw.compartments = [...(raw.compartments ?? []), piece]
        continue
      }
      const cell = raw.cells.find((entry) => entry.id === cellId)
      if (cell) cell[key] = [...(cell[key] ?? []), piece]
      else return { template: null, errors: [`There is no cell "${cellId}" to add "${piece.id}" to.`] }
    }
  }
  for (const [path, label] of Object.entries(edits.labels ?? {})) {
    const [first, second] = path.split('.')
    const cell = raw.cells.find((entry) => entry.id === first)
    const piece = second
      ? [...(cell?.facets ?? []), ...(cell?.processes ?? [])].find((entry) => entry.id === second)
      : cell ?? [...(raw.compartments ?? []), ...(raw.links ?? [])].find((entry) => entry.id === first)
    // A name for a piece no longer there waits for it to come back.
    if (piece) piece.label = label
  }
  for (const [path, at] of Object.entries(edits.places ?? {})) {
    const cell = raw.cells.find((entry) => entry.id === path)
    const piece = cell ?? (raw.compartments ?? []).find((entry) => entry.id === path)
    if (!piece) continue
    if (at) {
      piece.at = at
      delete piece.row
    } else {
      delete piece.at
      if (cell && !cell.in && cell.row === undefined) cell.row = 0
    }
  }
  for (const [path, skin] of Object.entries(edits.skins ?? {})) {
    const piece = raw.cells.find((entry) => entry.id === path) ?? (raw.compartments ?? []).find((entry) => entry.id === path)
    if (!piece) continue
    if (skin) piece.skin = skin
    else delete piece.skin
  }
  removePieces(raw, edits.removed ?? [])
  const { template: edited, errors } = validateTemplate(raw, { allowLocalId: true })
  return { template: edited, errors }
}

/** An instance's edits object -> the template they were put on and the result: no JSON for edits seen before. */
const editedByEdits = new WeakMap()
/**
 * Template -> edits as JSON -> that template with them, for an equal copy of edits seen before (an undo or a move
 * copies an instance's edits). The most recently used few are kept.
 */
const editedCache = new WeakMap()
const EDITED_KEPT = 16

/**
 * The template a placed instance draws: its template with the instance's own changes, or the template alone when
 * those no longer fit it.
 *
 * @param {{ template: string, edits?: Object }} instance - Its edits are never changed in place (see
 *   setInstanceEdits), so they are known by their identity.
 * @param {Map<string, Object>} definitions - Template id -> its validated template.
 * @returns {Object|null}
 */
export function instanceTemplate(instance, definitions) {
  const template = definitions.get(instance.template) ?? null
  const { edits } = instance
  if (!template || !edits) return template
  const known = editedByEdits.get(edits)
  if (known?.template === template) return known.edited
  const key = JSON.stringify(edits)
  let byEdits = editedCache.get(template)
  if (!byEdits) editedCache.set(template, (byEdits = new Map()))
  let edited = byEdits.get(key)
  // Taken out and put back, so the Map's order says which were used last.
  if (edited) byEdits.delete(key)
  else {
    const result = editedTemplate(template, edits)
    if (!result.template) console.warn(`Ignoring the changes to template instance ${instance.id}:`, result.errors)
    edited = result.template ?? template
  }
  byEdits.set(key, edited)
  if (byEdits.size > EDITED_KEPT) byEdits.delete(byEdits.keys().next().value)
  editedByEdits.set(edits, { template, edited })
  return edited
}

/**
 * Picks an id for a piece added to a template: `base` and the first number free among the ids it must differ
 * from, a cell's own pieces for a facet or process, else every cell and compartment.
 *
 * @param {Object} template - A validated template.
 * @param {string} base - e.g. 'site'.
 * @param {string} [cellId] - The cell a facet or process goes in.
 * @param {string[]} [removed] - Paths removed from the template, which a restore would bring back.
 * @returns {string}
 */
export function freePieceId(template, base, cellId, removed = []) {
  const cell = cellId && template.cells.find((entry) => entry.id === cellId)
  const taken = new Set(
    cell
      ? [MEMBRANE, ...cell.facets.map((facet) => facet.id), ...cell.processes.map((process) => process.id)]
      : [...template.cells, ...template.compartments, ...(template.links ?? [])].map((piece) => piece.id)
  )
  for (const path of removed) {
    const [first, second] = path.split('.')
    if (cell ? first === cellId && second : second === undefined) taken.add(second ?? first)
  }
  for (let n = 1; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
}

/**
 * Adds a piece to a placed template's changes, checked against its template.
 *
 * @param {Object} template - The instance's validated template, without its changes.
 * @param {Object|null} edits - Its changes so far.
 * @param {'cells'|'facets'|'processes'|'compartments'} kind
 * @param {Object} piece - As in a template file, with `cell` for a facet or process.
 * @returns {{ edits: Object|null, errors: Array<string> }} The new changes; null when the piece doesn't fit.
 */
export function addToEdits(template, edits, kind, piece) {
  const added = { ...edits?.added, [kind]: [...(edits?.added?.[kind] ?? []), piece] }
  // (Its other changes, the names among them, carry over.)
  const next = { ...edits, added }
  const { template: edited, errors } = editedTemplate(template, next)
  return edited ? { edits: normaliseEdits(next), errors: [] } : { edits: null, errors }
}

/**
 * Names a piece of a placed template, its own or one added, in the placement's changes.
 *
 * @param {Object} template - The instance's validated template, without its changes.
 * @param {Object|null} edits - Its changes so far.
 * @param {string} path - The piece's path.
 * @param {string} label - Blank to go back to the name it had.
 * @returns {{ edits: Object|null, errors: Array<string> }} The new changes, null for none.
 */
export function labelInEdits(template, edits, path, label) {
  const labels = { ...edits?.labels }
  if (label.trim()) labels[path] = label
  else delete labels[path]
  const next = normaliseEdits({ ...edits, labels })
  const { template: edited, errors } = editedTemplate(template, next)
  return edited ? { edits: next, errors: [] } : { edits: edits ?? null, errors }
}

/**
 * Sets, or with null takes away, the skin a cell or compartment of a placed template is drawn with.
 *
 * @param {Object} template - The instance's validated template, without its changes.
 * @param {Object|null} edits - Its changes so far.
 * @param {string} path - The cell's or compartment's.
 * @param {{ref: string, mode?: string, opacity?: number}|null} skin
 * @returns {{ edits: Object|null, errors: Array<string> }} The new changes, null for none.
 */
export function skinInEdits(template, edits, path, skin) {
  const skins = { ...edits?.skins, [path]: skin }
  // No skin on a piece the template gives none is no change.
  const own = [...template.cells, ...template.compartments].find((piece) => piece.id === path)?.skin
  if (!skin && !own) delete skins[path]
  const next = normaliseEdits({ ...edits, skins })
  const { template: edited, errors } = editedTemplate(template, next)
  return edited ? { edits: next, errors: [] } : { edits: edits ?? null, errors }
}

/**
 * Takes a piece out of a placed template's changes: one it added goes from its additions, and one of the
 * template's own is listed as removed. Additions in what goes go with it, and so do added compartments against
 * it alone. Checked against its template.
 *
 * @param {Object} template - The instance's validated template, without its changes.
 * @param {Object|null} edits - Its changes so far.
 * @param {string} path - The piece's path.
 * @returns {{ edits: Object|null, errors: Array<string> }} The new changes, null for none; errors, and the
 *   changes as they were, when the template can't do without the piece, as with its last cell or a cell's last facet.
 */
export function removeFromEdits(template, edits, path) {
  const [first, second] = path.split('.')
  // Whether a piece goes: the path's own, and with a cell everything in it.
  const goes = (cellId, id) => (second === undefined ? (cellId ? cellId === first : id === first) : cellId === first && id === second)
  const added = JSON.parse(JSON.stringify(edits?.added ?? {}))
  const isAddition =
    second === undefined
      ? [...(added.compartments ?? []), ...(added.cells ?? []), ...(added.links ?? [])].some((piece) => piece.id === first)
      : [...(added.facets ?? []), ...(added.processes ?? [])].some((piece) => piece.cell === first && piece.id === second)
  for (const kind of ['facets', 'processes']) {
    if (added[kind]) added[kind] = added[kind].filter((piece) => !goes(piece.cell, piece.id))
  }
  // An added cell goes whole, and with the cell it is in.
  if (added.cells && second === undefined) added.cells = added.cells.filter((cell) => cell.id !== first && cell.in !== first)
  // An added link goes by its own path, and with either of the spaces it joins.
  if (added.links && second === undefined) added.links = added.links.filter((link) => link.id !== first && !(link.between ?? []).includes(first))
  if (added.compartments) {
    added.compartments = added.compartments.flatMap((piece) => {
      if (goes(undefined, piece.id)) return []
      const against = piece.against ?? []
      const kept = against.filter((entry) => !goes(...entry.split('.')))
      if (kept.length === against.length) return [piece]
      return kept.length ? [{ ...piece, against: kept }] : []
    })
  }
  const next = normaliseEdits({ ...edits, added, removed: [...(edits?.removed ?? []), ...(isAddition ? [] : [path])] })
  const { template: edited, errors } = editedTemplate(template, next)
  return edited ? { edits: next, errors: [] } : { edits: edits ?? null, errors }
}

/**
 * Gives, or with null takes away, the place of its own a cell or compartment of a placed template has there.
 *
 * @param {Object} template - The instance's validated template, without its changes.
 * @param {Object|null} edits - Its changes so far.
 * @param {string} path - The cell's or compartment's.
 * @param {{x: number, y: number}|null} at - Its top-left, from the template's.
 * @returns {{ edits: Object|null, errors: Array<string> }} The new changes, null for none; errors, and the changes
 *   as they were, where the piece can't be placed so, as a cell that shares a compartment with another.
 */
export function placeInEdits(template, edits, path, at) {
  const places = { ...edits?.places, [path]: at }
  // No place on a piece the template gives none is no change.
  const own = [...template.cells, ...template.compartments].find((piece) => piece.id === path)?.at
  if (!at && !own) delete places[path]
  const next = normaliseEdits({ ...edits, places })
  const { template: edited, errors } = editedTemplate(template, next)
  return edited ? { edits: next, errors: [] } : { edits: edits ?? null, errors }
}
