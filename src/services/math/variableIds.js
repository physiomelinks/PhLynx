/**
 * Opaque CellML `id` attributes on stored math's variables, which annotation side-cars point at as
 * `./<file>.cellml#<id>`. The math editor rebuilds the model without ids, so a save puts them back
 * (see carryVariableIds).
 */
import { CELLML_NS } from '../../utils/constants'
import { getLibCellML } from '../../utils/cellml'

const MAX_ATTEMPTS = 1000

/**
 * Parses math, or null when it is empty or not XML.
 *
 * @param {string} math
 * @returns {Document|null}
 */
function parseMath(math) {
  if (!math?.trim()) return null
  const doc = new DOMParser().parseFromString(math, 'application/xml')
  return doc.getElementsByTagName('parsererror').length ? null : doc
}

const elementsOf = (doc, tagName) => Array.from(doc.getElementsByTagNameNS(CELLML_NS, tagName))

/**
 * Every `id` in the math, on any element.
 *
 * @param {string} math
 * @returns {Set<string>}
 */
export function listElementIds(math) {
  const doc = parseMath(math)
  if (!doc) return new Set()
  return new Set(
    Array.from(doc.getElementsByTagName('*'))
      .map((element) => element.getAttribute('id'))
      .filter(Boolean)
  )
}

/**
 * Every id and component name in the math, which a new id must avoid: a side-car's component
 * subject is the component name, in the same fragment namespace.
 *
 * @param {string} math
 * @returns {Set<string>}
 */
export function reservedIdsOf(math) {
  const doc = parseMath(math)
  if (!doc) return new Set()
  const componentNames = elementsOf(doc, 'component').map((component) => component.getAttribute('name'))
  return new Set([...listElementIds(math), ...componentNames])
}

/**
 * The math's variable ids by variable name; the first component's wins a shared name.
 *
 * @param {string} math
 * @returns {Map<string, string>} Variable name -> id.
 */
export function variableIdsOf(math) {
  const doc = parseMath(math)
  const ids = new Map()
  if (!doc) return ids
  elementsOf(doc, 'variable').forEach((variable) => {
    const name = variable.getAttribute('name')
    const id = variable.getAttribute('id')
    if (name && id && !ids.has(name)) ids.set(name, id)
  })
  return ids
}

/**
 * Sets ids on the named variables. A variable already holding an id, or an id another element
 * already holds, is left alone.
 *
 * @param {string} math
 * @param {Map<string, string>} nameToId
 * @param {Object} [options]
 * @param {string|null} [options.componentId] - An id for the first component, if it has none.
 * @returns {string} The math, unchanged (the same string) when no id was set.
 */
export function applyVariableIds(math, nameToId, { componentId = null } = {}) {
  const doc = parseMath(math)
  if (!doc || (!nameToId.size && !componentId)) return math
  const used = listElementIds(math)
  let isChanged = false
  const setId = (element, id) => {
    if (!id || element.getAttribute('id') || used.has(id)) return
    element.setAttribute('id', id)
    used.add(id)
    isChanged = true
  }
  const [component] = elementsOf(doc, 'component')
  if (component) setId(component, componentId)
  elementsOf(doc, 'variable').forEach((variable) => setId(variable, nameToId.get(variable.getAttribute('name'))))
  return isChanged ? new XMLSerializer().serializeToString(doc) : math
}

/**
 * New ids for the named variables, from libCellML's Annotator (`b4da55`, `b4da56`, …). Each avoids `reserved`, which
 * also holds ids the Annotator does not see, such as MathML ones.
 *
 * @param {string} math
 * @param {Set<string>} names - Variables without an id.
 * @param {Set<string>} reserved - See reservedIdsOf.
 * @returns {Map<string, string>} Variable name -> id; the first component's variable takes a shared name.
 * @throws {Error} When libCellML cannot parse the math, or finds no unused id.
 */
function annotatorIds(math, names, reserved) {
  const libcellml = getLibCellML()
  const parser = new libcellml.Parser(false)
  const annotator = new libcellml.Annotator()
  const owned = []
  const ids = new Map()
  try {
    const model = parser.parseModel(math)
    owned.push(model)
    if (!model || parser.errorCount() > 0) throw new Error('libCellML could not parse the math.')
    annotator.setModel(model)
    const assign = (variable) => {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const id = annotator.assignIdByVariable(variable)
        if (id && !reserved.has(id)) return id
      }
      throw new Error('Could not find an unused variable id.')
    }
    const visit = (component) => {
      owned.push(component)
      for (let i = 0; i < component.variableCount(); i++) {
        const variable = component.variableByIndex(i)
        owned.push(variable)
        const name = variable.name()
        if (!names.has(name) || ids.has(name) || variable.id()) continue
        const id = assign(variable)
        reserved.add(id)
        ids.set(name, id)
      }
      for (let i = 0; i < component.componentCount(); i++) visit(component.componentByIndex(i))
    }
    for (let i = 0; i < model.componentCount(); i++) visit(model.componentByIndex(i))
    return ids
  } finally {
    owned.reverse().forEach((item) => item?.delete())
    annotator.delete()
    parser.delete()
  }
}

/**
 * Gives the named variables ids, keeping any they have. New ids come from libCellML's Annotator and are written
 * into the math as it is, so its formatting is kept.
 *
 * @param {string} math
 * @param {Iterable<string>} names
 * @returns {{math: string, ids: Map<string, string>}} The math, and the named variables' ids by name.
 */
export function ensureVariableIds(math, names) {
  names = new Set(names)
  if (!names.size) return { math, ids: new Map() }
  const existing = variableIdsOf(math)
  const declared = new Set(variableNamesOf(math))
  const missing = new Set([...names].filter((name) => !existing.has(name) && declared.has(name)))
  const added = missing.size ? annotatorIds(math, missing, reservedIdsOf(math)) : new Map()
  const ids = new Map()
  for (const name of names) {
    const id = existing.get(name) ?? added.get(name)
    if (id) ids.set(name, id)
  }
  return { math: applyVariableIds(math, added), ids }
}

/**
 * The names of the math's variables.
 *
 * @param {string} math
 * @returns {Array<string>}
 */
function variableNamesOf(math) {
  const doc = parseMath(math)
  return doc ? elementsOf(doc, 'variable').map((variable) => variable.getAttribute('name')) : []
}

/**
 * Puts the ids of `fromMath`'s variables and first component back onto `toMath`, following renames.
 * A renamed variable takes its old name's id, and the old name keeps none.
 *
 * @param {string} fromMath - The stored math, with ids.
 * @param {string} toMath - The edited math, as the editor gives it (no ids).
 * @param {Map<string, string>} [renames] - Old variable name -> new name.
 * @returns {string}
 */
export function carryVariableIds(fromMath, toMath, renames = new Map()) {
  const fromIds = variableIdsOf(fromMath)
  const nameToId = new Map()
  renames.forEach((to, from) => {
    if (fromIds.has(from)) nameToId.set(to, fromIds.get(from))
  })
  fromIds.forEach((id, name) => {
    if (!renames.has(name) && !nameToId.has(name)) nameToId.set(name, id)
  })
  const doc = parseMath(fromMath)
  const componentId = (doc && elementsOf(doc, 'component')[0]?.getAttribute('id')) || null
  return applyVariableIds(toMath, nameToId, { componentId })
}

/**
 * The math without any `id` attribute, for comparing what it says rather than what it is called.
 *
 * @param {string} math
 * @returns {string}
 */
export function stripIds(math) {
  const doc = parseMath(math)
  if (!doc) return math
  const withIds = Array.from(doc.getElementsByTagName('*')).filter((element) => element.hasAttribute('id'))
  if (!withIds.length) return math
  withIds.forEach((element) => element.removeAttribute('id'))
  return new XMLSerializer().serializeToString(doc)
}

/**
 * The math a save writes. Edited math gets the stored math's ids back (see carryVariableIds), and
 * `idsFor` names variables that need one. Ids alone are no math change: the save keeps its math ref
 * and asks nothing, but still writes them.
 *
 * @param {Object} options
 * @param {string} options.storedMath
 * @param {string} options.editedMath - The session's math, as the editor gives it.
 * @param {boolean} options.isMathChanged - Whether the math changed, ids aside.
 * @param {Map<string, string>} [options.renames] - From findVariableRenames, stored -> edited.
 * @param {Iterable<string>} [options.idsFor] - Variables (by saved name) that need an id.
 * @returns {{math: string|null, idsChanged: boolean, ids: Map<string, string>}} `math` is null when
 *   nothing changed; `ids` are those of `idsFor`.
 */
export function prepareSavedMath({ storedMath, editedMath, isMathChanged, renames, idsFor = [] }) {
  const base = isMathChanged ? carryVariableIds(storedMath, editedMath, renames) : storedMath
  const { math, ids } = ensureVariableIds(base, idsFor)
  const idsChanged = !isMathChanged && math !== storedMath
  return { math: isMathChanged || idsChanged ? math : null, idsChanged, ids }
}
