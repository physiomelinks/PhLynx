/**
 * The Annotations tab's unsaved edits to a math's sidecar: an imported sidecar that replaces it, the module kind, a
 * compartment's space kind and each edited variable's property, species, location and, for a flow, where it comes
 * from. A draft never changes; each edit returns a new one, without edits that match the sidecar.
 */

import { canonicalCurie, isFlowProperty } from './iris.js'
import { buildVariableSubject } from './sidecarEdit.js'

/**
 * Creates an empty draft.
 *
 * @returns {{ imported: undefined, componentKind: undefined, transporter: undefined, spaceKind: undefined,
 *   variables: Map<string, Object|null> }}
 */
export function createAnnotationDraft() {
  return {
    imported: undefined,
    componentKind: undefined,
    transporter: undefined,
    spaceKind: undefined,
    variables: new Map(),
  }
}

/**
 * A draft that replaces the math's sidecar with an imported one; earlier edits go, as they were of the old one.
 *
 * @param {string} text - The imported sidecar Turtle.
 * @param {Object} sidecar - It parsed against the math (see parseSidecar).
 * @returns {Object} The new draft.
 */
export function importDraftSidecar(text, sidecar) {
  return { ...createAnnotationDraft(), imported: { text, sidecar } }
}

/**
 * The sidecar a draft's edits apply to: an imported one, else the math's.
 *
 * @param {Object} draft
 * @param {Object|null|undefined} sidecar - The math's, from parseSidecar.
 * @returns {Object|null|undefined}
 */
export function draftBaseSidecar(draft, sidecar) {
  return draft.imported ? draft.imported.sidecar : sidecar
}

/**
 * Whether a draft changes anything.
 *
 * @param {Object} draft
 * @returns {boolean}
 */
export function hasDraftEdits(draft) {
  const { imported, componentKind, spaceKind, variables } = draft
  return imported !== undefined || componentKind !== undefined || spaceKind !== undefined || variables.size > 0
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
 * Builds an entry with only the fields the tab edits, species canonical and in order. `from` is a flow's source
 * location, null for none and for anything else.
 *
 * @param {Object|null} entry
 * @returns {{ property: string|null, species: string[], location: string|null, from: string|null }|null}
 */
function normaliseEntry(entry) {
  if (!isAnnotatedEntry(entry)) return null
  const property = entry.property ?? null
  return {
    property,
    species: [...new Set((entry.species ?? []).map(canonicalCurie))],
    location: entry.location ?? null,
    from: isFlowProperty(property) ? (entry.from ?? null) : null,
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
 * @returns {{ property: string|null, species: string[], location: string|null, from: string|null }|null}
 */
export function getDraftEntry(draft, sidecar, variable) {
  return draft.variables.has(variable) ? draft.variables.get(variable) : normaliseEntry(findSidecarEntry(sidecar, variable))
}

/**
 * Sets a variable's annotation, or clears it with null. An entry without `from` keeps a saved flow's source while
 * its location is the saved one.
 *
 * @param {Object} draft
 * @param {Object|null|undefined} sidecar
 * @param {string} variable
 * @param {Object|null} entry - { property, species, location, from }.
 * @returns {Object} The new draft.
 */
export function setDraftEntry(draft, sidecar, variable, entry) {
  const variables = new Map(draft.variables)
  const saved = findSidecarEntry(sidecar, variable)
  // A level becoming a flow has no source to keep, so it has none.
  const keepsSource = isFlowProperty(saved?.property) && entry && saved.location === (entry.location ?? null)
  const edit = entry && entry.from === undefined && keepsSource ? { ...entry, from: saved.from ?? null } : entry
  if (isSameEntry(edit, saved)) variables.delete(variable)
  else variables.set(variable, normaliseEntry(edit))
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
 * Gets a compartment's space kind as the draft leaves it: the GO cellular component the user chose, or null.
 *
 * @param {Object} draft
 * @param {Object|null|undefined} sidecar
 * @returns {string|null}
 */
export function getDraftSpaceKind(draft, sidecar) {
  return draft.spaceKind !== undefined ? draft.spaceKind : (sidecar?.component?.spaceKind ?? null)
}

/**
 * Sets a compartment's space kind, or clears it with null.
 *
 * @param {Object} draft
 * @param {Object|null|undefined} sidecar
 * @param {string|null} spaceKind - A GO cellular component.
 * @returns {Object} The new draft.
 */
export function setDraftSpaceKind(draft, sidecar, spaceKind) {
  const saved = sidecar?.component?.spaceKind ?? null
  return { ...draft, spaceKind: spaceKind === saved ? undefined : spaceKind }
}

/**
 * Applies a draft to a parsed sidecar, so its ports and chips show the edits before they are saved. A newly
 * annotated variable's subject names its id, or until save gives it one, a provisional '#new:<variable>'.
 *
 * @param {Object|null|undefined} sidecar - From parseSidecar.
 * @param {Object} draft
 * @param {string} mathRef - 'file:component'.
 * @param {Object} [options]
 * @param {Map<string, string>} [options.ids] - The math's variable ids by name (see variableIdsOf).
 * @returns {Object|null|undefined} The sidecar unchanged without edits.
 */
export function applyAnnotationDraft(sidecar, draft, mathRef, { ids = new Map() } = {}) {
  if (!hasDraftEdits(draft)) return sidecar
  const base = sidecar ?? { mathRef, file: null, componentName: null, component: null, variables: [], warnings: [] }
  const { componentKind } = getDraftKind(draft, base)
  // An edit's process is only known once saved; its source is the one saving writes, if any.
  const withFrom = (edit) => ({ ...edit, from: edit.from ?? null, process: null })
  const variables = base.variables.flatMap((entry) => {
    if (!draft.variables.has(entry.variable)) return [entry]
    const edit = draft.variables.get(entry.variable)
    return edit ? [{ ...entry, ...withFrom(edit) }] : []
  })
  for (const [variable, edit] of draft.variables) {
    if (!edit || findSidecarEntry(base, variable)) continue
    const id = ids.get(variable) ?? null
    const subject = buildVariableSubject(mathRef, id ?? `new:${variable}`, base.file ?? undefined)
    variables.push({ variable, id, subject, entity: null, ...withFrom(edit) })
  }
  const spaceKind = componentKind === 'compartment' ? getDraftSpaceKind(draft, base) : null
  const component = base.component
    ? { ...base.component, kind: componentKind, spaceKind }
    : componentKind
      ? { kind: componentKind, is: [], spaceKind }
      : null
  return { ...base, component, variables }
}

/**
 * A draft's variables under the names a save gives them. An edit made before its variable was renamed follows the
 * rename, and an edit to a variable the math no longer declares is dropped, since it would annotate nothing.
 *
 * @param {Object} draft
 * @param {Map<string, string>} renames - Old variable name -> new name.
 * @param {Set<string>} names - The saved math's variable names.
 * @returns {Object} The draft unchanged when every edit names a declared variable.
 */
export function renameDraftVariables(draft, renames, names) {
  if ([...draft.variables.keys()].every((variable) => names.has(variable))) return draft
  const variables = new Map([...draft.variables].filter(([variable]) => names.has(variable)))
  for (const [variable, edit] of draft.variables) {
    const renamed = renames.get(variable)
    if (!names.has(variable) && renamed && names.has(renamed) && !variables.has(renamed)) variables.set(renamed, edit)
  }
  return { ...draft, variables }
}

/**
 * A draft as plain data, for comparing editor states.
 *
 * @param {Object} draft
 * @returns {Object}
 */
export function signDraft(draft) {
  const { imported, componentKind, transporter, spaceKind } = draft
  return { imported: imported?.text, componentKind, transporter, spaceKind, variables: [...draft.variables] }
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
