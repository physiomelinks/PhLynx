/**
 * The Annotations tab's unsaved edits to a math's sidecar: the module kind and each edited variable's property,
 * species and location. A draft never changes; each edit returns a new one, without edits that match the sidecar.
 */

import { canonicalCurie } from './iris.js'
import { buildVariableSubject } from './sidecarEdit.js'

/**
 * Creates an empty draft.
 *
 * @returns {{ componentKind: undefined, transporter: undefined, variables: Map<string, Object|null> }}
 */
export function createAnnotationDraft() {
  return { componentKind: undefined, transporter: undefined, variables: new Map() }
}

/**
 * Whether a draft changes anything.
 *
 * @param {Object} draft
 * @returns {boolean}
 */
export function hasDraftEdits(draft) {
  return draft.componentKind !== undefined || draft.variables.size > 0
}

/**
 * Whether an entry says anything about its variable.
 *
 * @param {Object|null} entry
 * @returns {boolean}
 */
export function isAnnotatedEntry(entry) {
  return !!(entry && (entry.property || entry.species?.length || entry.location))
}

/**
 * Builds an entry with only the fields the tab edits, species canonical and in order.
 *
 * @param {Object|null} entry
 * @returns {{ property: string|null, species: string[], location: string|null }|null}
 */
function normaliseEntry(entry) {
  if (!isAnnotatedEntry(entry)) return null
  return {
    property: entry.property ?? null,
    species: [...new Set((entry.species ?? []).map(canonicalCurie))],
    location: entry.location ?? null,
  }
}

const isSameEntry = (a, b) => JSON.stringify(normaliseEntry(a)) === JSON.stringify(normaliseEntry(b))

/**
 * Finds a variable's entry in a parsed sidecar.
 *
 * @param {Object|null|undefined} sidecar - From parseSidecar.
 * @param {string} variable
 * @returns {Object|null}
 */
export function findSidecarEntry(sidecar, variable) {
  return sidecar?.variables?.find((entry) => entry.variable === variable) ?? null
}

/**
 * Gets a variable's annotation as the draft leaves it.
 *
 * @param {Object} draft
 * @param {Object|null|undefined} sidecar
 * @param {string} variable
 * @returns {{ property: string|null, species: string[], location: string|null }|null}
 */
export function getDraftEntry(draft, sidecar, variable) {
  return draft.variables.has(variable) ? draft.variables.get(variable) : normaliseEntry(findSidecarEntry(sidecar, variable))
}

/**
 * Sets a variable's annotation, or clears it with null.
 *
 * @param {Object} draft
 * @param {Object|null|undefined} sidecar
 * @param {string} variable
 * @param {Object|null} entry - { property, species, location }.
 * @returns {Object} The new draft.
 */
export function setDraftEntry(draft, sidecar, variable, entry) {
  const variables = new Map(draft.variables)
  if (isSameEntry(entry, findSidecarEntry(sidecar, variable))) variables.delete(variable)
  else variables.set(variable, normaliseEntry(entry))
  return { ...draft, variables }
}

/**
 * Gets the module's kind and UniProt accession as the draft leaves them.
 *
 * @param {Object} draft
 * @param {Object|null|undefined} sidecar
 * @returns {{ componentKind: string|null, transporter: string|null }}
 */
export function getDraftKind(draft, sidecar) {
  if (draft.componentKind !== undefined) {
    return { componentKind: draft.componentKind, transporter: draft.transporter ?? null }
  }
  const componentKind = sidecar?.component?.kind ?? null
  const transporter = sidecar?.component?.is?.find((curie) => curie.startsWith('uniprot:')) ?? null
  return { componentKind, transporter: componentKind === 'transporter' ? transporter : null }
}

/**
 * Sets the module's kind and, for a transporter, its UniProt accession.
 *
 * @param {Object} draft
 * @param {Object|null|undefined} sidecar
 * @param {string|null} componentKind
 * @param {string|null} [transporter] - A uniprot CURIE.
 * @returns {Object} The new draft.
 */
export function setDraftKind(draft, sidecar, componentKind, transporter = null) {
  const saved = getDraftKind(createAnnotationDraft(), sidecar)
  const accession = componentKind === 'transporter' ? transporter : null
  if (saved.componentKind === componentKind && (componentKind !== 'transporter' || !accession || saved.transporter === accession)) {
    return { ...draft, componentKind: undefined, transporter: undefined }
  }
  return { ...draft, componentKind, transporter: accession ?? undefined }
}

/**
 * Applies a draft to a parsed sidecar, so its ports and chips show the edits before they are saved.
 *
 * @param {Object|null|undefined} sidecar - From parseSidecar.
 * @param {Object} draft
 * @param {string} mathRef - 'file:component'.
 * @returns {Object|null|undefined} The sidecar unchanged without edits.
 */
export function applyAnnotationDraft(sidecar, draft, mathRef) {
  if (!hasDraftEdits(draft)) return sidecar
  const base = sidecar ?? { mathRef, file: null, componentName: null, component: null, variables: [], warnings: [] }
  const variables = base.variables.flatMap((entry) => {
    if (!draft.variables.has(entry.variable)) return [entry]
    const edit = draft.variables.get(entry.variable)
    return edit ? [{ ...entry, ...edit }] : []
  })
  for (const [variable, edit] of draft.variables) {
    if (!edit || findSidecarEntry(base, variable)) continue
    variables.push({ variable, subject: buildVariableSubject(mathRef, variable, base.file ?? undefined), entity: null, ...edit })
  }
  const { componentKind } = getDraftKind(draft, base)
  const component = base.component ? { ...base.component, kind: componentKind } : componentKind ? { kind: componentKind, is: [] } : null
  return { ...base, component, variables }
}

/**
 * A draft as plain data, for comparing editor states.
 *
 * @param {Object} draft
 * @returns {Object}
 */
export function signDraft(draft) {
  return { componentKind: draft.componentKind, transporter: draft.transporter, variables: [...draft.variables] }
}

/**
 * What a row is to the Annotations tab: the VoI is never annotated, and constants are hidden unless asked for. A
 * boundary condition is a coupling's target, so it counts as a variable.
 *
 * @param {{ name: string, type?: string }} row - A parameter row.
 * @param {Map<string, string>|null} kinds - From classifyRows.
 * @returns {'voi'|'constant'|'variable'}
 */
export function classifyAnnotationRow(row, kinds) {
  const kind = kinds?.get(row.name)
  if (kind === 'voi') return 'voi'
  const isConstant = kind === 'constant' || kind === 'computed_constant'
  return isConstant && row.type !== 'boundary_condition' ? 'constant' : 'variable'
}
