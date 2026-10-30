/**
 * Physiology templates: readable JSON scaffolds of cells, membrane facets, process areas and compartments
 * that modules can be dropped onto. Template pieces hold no maths; each one offers a site with a role,
 * and the user decides what goes on it. `bio-template.schema.json` describes the same format for IDEs.
 */

import { FACETS } from '../annotations/apicoord.js'
import { MIN_CELL } from './metrics.js'

/** The template format this build understands. */
export const TEMPLATE_SCHEMA_VERSION = 1

/** A template's own id. */
export const TEMPLATE_ID = /^[a-z][a-z0-9-]{1,47}$/

/** The id of a cell, facet, process, compartment or facet group within a template. */
export const PIECE_ID = /^[a-z][a-z0-9-]{0,31}$/

/** The edges of a cell a facet can lie along. */
export const EDGES = ['top', 'bottom', 'left', 'right']

/** The colours a compartment can be drawn in. */
export const TONES = ['sky', 'rose', 'teal', 'amber', 'violet', 'lime', 'slate']

/** The sides of the lateral facet an annotation can name. */
export const ANNOTATION_SIDES = ['left', 'right']

/** The facets an annotation can name (ApiCoord). */
export const ANNOTATION_FACETS = FACETS

/** The site path a cell's membrane is offered at, so no facet or process may use it. */
export const MEMBRANE = 'membrane'

export const LIMITS = {
  name: 64,
  description: 280,
  author: 64,
  license: 64,
  label: 64,
  cells: 16,
  processes: 8,
  compartments: 32,
  rows: 16,
  sites: 64,
  bytes: 64 * 1024,
  size: { min: 120, max: 4000 },
  depth: { min: 20, max: 1000 },
}

/** The keys the validator knows for each kind of object, in the order a clean copy lists them. */
export const TEMPLATE_KEYS = {
  template: ['$schema', 'schemaVersion', 'id', 'name', 'description', 'author', 'license', 'cells', 'compartments'],
  cell: ['id', 'label', 'row', 'size', 'membrane', 'facets', 'processes', 'site'],
  size: ['width', 'height'],
  membrane: ['label'],
  facet: ['id', 'label', 'edge', 'group', 'annotation', 'site'],
  annotation: ['facet', 'at'],
  process: ['id', 'label', 'site'],
  compartment: ['id', 'label', 'against', 'tone', 'depth', 'site'],
}

const DEFAULT_MEMBRANE_LABEL = 'Plasma membrane'
const DEFAULT_TONE = 'sky'
const OPPOSITE = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }
const SITE_PATH = /^[a-z][a-z0-9-]{0,31}(?:\.[a-z][a-z0-9-]{0,31})?$/
const INSTANCE_ID = /^[A-Za-z0-9][A-Za-z0-9_:.-]*$/

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
  const facet = { id: raw.id, label: requiredText(raw, 'label', LIMITS.label, where, errors), edge: raw.edge }
  if (!EDGES.includes(raw.edge)) errors.push(`${where}: "edge" must be one of ${EDGES.join(', ')}.`)
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
  if (!siteFlag(raw, where, errors)) process.site = false
  return process
}

function readSize(raw, where, errors, warnings) {
  if (raw === undefined) return { ...MIN_CELL }
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

function readMembrane(raw, where, errors, warnings) {
  if (raw === undefined) return { label: DEFAULT_MEMBRANE_LABEL }
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
  cell.size = readSize(raw.size, where, errors, warnings)
  cell.membrane = readMembrane(raw.membrane, where, errors, warnings)

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
    const aliases = new Map()
    raw.facets.forEach((rawFacet, i) => {
      const label = `facet ${i + 1}`
      const facet = readFacet(rawFacet, `${where}, ${label}`, errors, warnings)
      if (!facet) return
      claim(facet.id, label)
      if (EDGES.includes(facet.edge)) {
        const taken = edges.get(facet.edge)
        if (taken) {
          errors.push(`${where}, ${label}: the ${facet.edge} edge already has facet "${taken}"; a cell has at most one facet per edge.`)
        } else edges.set(facet.edge, facet.id)
      }
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
    if (resolved.some((entry) => entry.cell === cell && entry.facet === facet)) {
      return { form: null, error: `"against" names "${ref}" more than once.` }
    }
    resolved.push({ cell, facet })
  }

  const allowed =
    'A compartment lies against facets on the same top or bottom edge of cells in one row (a band), ' +
    'two facing facets of neighbouring cells (the gap between them), one left or right facet (a column), or nothing.'
  const edges = resolved.map((entry) => entry.facet.edge)
  const horizontal = (edge) => edge === 'top' || edge === 'bottom'

  if (resolved.length === 1 && !horizontal(edges[0])) return { form: 'column' }
  if (edges.every((edge) => edge === edges[0]) && horizontal(edges[0])) {
    if (resolved.every((entry) => entry.cell.row === resolved[0].cell.row)) return { form: 'band' }
    return { form: null, error: `the cells of a band must share a row. ${allowed}` }
  }
  if (resolved.length === 2 && OPPOSITE[edges[0]] === edges[1]) {
    const [first, second] = edges[0] === 'right' || edges[0] === 'bottom' ? resolved : [resolved[1], resolved[0]]
    const a = first.cell
    const b = second.cell
    if (first.facet.edge === 'right') {
      const row = cells.filter((cell) => cell.row === a.row)
      if (b.row === a.row && row[row.indexOf(a) + 1] === b) return { form: 'gap' }
      const error = `"${a.id}" and "${b.id}" must be neighbours in one row, "${a.id}" first, to share a gap.`
      return { form: null, error: `${error} ${allowed}` }
    }
    if (b.row === a.row + 1) return { form: 'gap' }
    return { form: null, error: `"${b.id}" must be in the row just below "${a.id}" to share a gap. ${allowed}` }
  }
  return { form: null, error: allowed }
}

function readCompartment(raw, index, cells, errors, warnings) {
  if (!isObject(raw)) {
    errors.push(`Compartment ${index + 1} must be an object.`)
    return null
  }
  const where = isPieceId(raw.id) ? `Compartment "${raw.id}"` : `Compartment ${index + 1}`
  warnUnknown(raw, TEMPLATE_KEYS.compartment, where, warnings)
  if (!isPieceId(raw.id)) errors.push(`${where}: ${PIECE_ID_RULE}`)
  const compartment = { id: raw.id, label: requiredText(raw, 'label', LIMITS.label, where, errors), against: [] }

  if (raw.against !== undefined) {
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
  if (!siteFlag(raw, where, errors)) compartment.site = false
  return compartment
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
 * @returns {{ template: Object|null, errors: Array<string>, warnings: Array<string> }} `template` is null when
 *   there are errors.
 */
export function validateTemplate(raw) {
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
  if (raw.schemaVersion !== TEMPLATE_SCHEMA_VERSION) {
    errors.push(`${where}: "schemaVersion" must be ${TEMPLATE_SCHEMA_VERSION}.`)
  }
  if (typeof raw.id !== 'string' || !TEMPLATE_ID.test(raw.id)) {
    errors.push(`${where}: "id" must start with a letter and use only lower-case letters, digits and hyphens (2-48 characters).`)
  }
  const name = requiredText(raw, 'name', LIMITS.name, where, errors)
  const description = optionalText(raw, 'description', LIMITS.description, where, errors)
  const author = optionalText(raw, 'author', LIMITS.author, where, errors)
  const license = optionalText(raw, 'license', LIMITS.license, where, errors)

  const cells = []
  if (!Array.isArray(raw.cells) || raw.cells.length === 0) errors.push(`${where}: "cells" must be a non-empty list.`)
  else if (raw.cells.length > LIMITS.cells) errors.push(`A template can have at most ${LIMITS.cells} cells.`)
  else {
    raw.cells.forEach((rawCell, i) => {
      const cell = readCell(rawCell, i, errors, warnings)
      if (cell) cells.push(cell)
    })
  }

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

  const filledBy = new Map()
  for (const compartment of compartments) {
    if (formOf(cells, compartment.against).form !== 'gap') continue
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

  const seen = new Set()
  for (const piece of [...cells, ...compartments]) {
    if (!isPieceId(piece.id)) continue
    if (seen.has(piece.id)) errors.push(`Id "${piece.id}" is used by more than one cell or compartment.`)
    seen.add(piece.id)
  }

  const template = { schemaVersion: TEMPLATE_SCHEMA_VERSION, id: raw.id, name }
  if (description) template.description = description
  if (author) template.author = author
  if (license) template.license = license
  template.cells = cells
  template.compartments = compartments

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
  return sites
}

/**
 * Gives the shape a compartment of a validated template takes.
 *
 * @param {Object} template - A validated template.
 * @param {Object|string} compartment - The compartment, or its id.
 * @returns {'band'|'gap'|'column'|'free'|null} null when the template has no such compartment.
 */
export function compartmentForm(template, compartment) {
  const entry =
    typeof compartment === 'string' ? template.compartments.find((c) => c.id === compartment) : compartment
  if (!entry) return null
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
