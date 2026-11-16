/**
 * The Parameters tab of a CellDL module: one row per diagram element, from the CellDL editor's element list
 * (useCelldlEditorHost's `elements`), paired with bg2cellml's element manifest, which names each element's variables
 * in the CellML, and with the instance's variable rows, which hold this instance's values.
 *
 * The diagram's structure (an element's type, species and location) is edited in the diagram;
 * its values are this instance's, and the diagram's own values are only their defaults.
 */
import { isEmpty } from '../../utils/variables.js'

/** The species and location the CellDL editor gives a new element. */
export const DEFAULT_SPECIES = 'i'
export const DEFAULT_LOCATION = 'j'

/** A name the CellDL editor can typeset as a species or location. */
export const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/** The sections rows are grouped in, in order. */
export const SECTIONS = Object.freeze([
  { key: 'stores', label: 'Stores' },
  { key: 'reactions', label: 'Reactions' },
  { key: 'junctions', label: 'Junctions' },
  { key: 'other', label: 'Other elements' },
  { key: 'constants', label: 'Constants' },
])

/**
 * Gets an IRI's fragment, e.g. `ZeroNode` for `…#ZeroNode`.
 *
 * @param {string} [iri]
 * @returns {string}
 */
export const fragment = (iri) => String(iri ?? '').replace(/^.*[#/]/, '')

export const isJunction = (element) => !element.isBondElement
export const isZeroJunction = (element) => isJunction(element) && /ZeroNode$/.test(fragment(element.kind))
/** A store has an initial value, or, before its type is chosen, is of a storage kind. */
export const isStore = (element) =>
  element.isBondElement && (element.value !== undefined || /(Store|Storage(Node)?)$/i.test(fragment(element.kind)))
export const isReaction = (element) => element.isBondElement && /Reaction/i.test(fragment(element.kind))

/**
 * Gets the section an element's row is in.
 *
 * @param {Object} element - A DiagramElement.
 * @returns {'stores'|'reactions'|'junctions'|'other'}
 */
export function sectionOf(element) {
  if (isStore(element)) return 'stores'
  if (isReaction(element)) return 'reactions'
  if (isJunction(element)) return 'junctions'
  return 'other'
}

/**
 * Finds the store each 0-junction serves: a 0-junction is linked when exactly one of its neighbours is a store.
 *
 * @param {Object[]} elements - DiagramElements.
 * @returns {Map<string, string>} Each linked store's id to its junction's id, the first such junction if several.
 */
export function linkJunctions(elements) {
  const byId = new Map(elements.map((element) => [element.id, element]))
  const links = new Map()
  for (const element of elements) {
    if (!isZeroJunction(element)) continue
    const stores = element.neighbours.filter((id) => byId.has(id) && isStore(byId.get(id)))
    if (stores.length === 1 && !links.has(stores[0])) links.set(stores[0], element.id)
  }
  return links
}

/**
 * Gets a template's name, or for one with no label but its IRI, the IRI's fragment.
 *
 * @param {{type: string, name?: string}} template
 * @returns {string}
 */
export const templateLabel = (template) =>
  !template.name || /^[a-z][a-z0-9+.-]*:\/\//i.test(template.name) ? fragment(template.name || template.type) : template.name

/**
 * Gets the types an element can be given, as Select options: the templates the editor's Properties panel offers it,
 * which its bonds limit to their domain, without the base kind, which bg2cellml can't convert. An element still of
 * its base kind has no value, so the Select shows the kind as its placeholder; a template the list lacks is kept, so
 * it still shows.
 *
 * @param {Object} element - A DiagramElement.
 * @returns {{options: {value: string, label: string}[], value: string|null, placeholder: string}}
 */
export function typeOptions(element) {
  const options = (element.templates ?? [])
    .filter((template) => template.type !== element.kind)
    .map((template) => ({ value: template.type, label: templateLabel(template) }))
  if (element.template && !options.some((option) => option.value === element.template)) {
    options.unshift({ value: element.template, label: templateLabel({ type: element.template, name: element.templateName }) })
  }
  return {
    options,
    value: element.template || null,
    placeholder: element.kindName ?? fragment(element.kind),
  }
}

/**
 * The element's variables a manifest entry names, by role.
 *
 * @param {Object|undefined} entry - The element's ManifestElement.
 * @param {string} role
 */
const variablesOf = (entry, role) => (entry?.variables ?? []).filter((variable) => variable.role === role)

/**
 * Finds the CellML variable a template parameter became: named for it and the element (`K_q_S_c` for K of q_S_c),
 * else the one named for it alone, else the one in the same place. A variable a naming rule renamed is matched by
 * its bond graph name, e.g. `Keq_S` by `K_q_S_c`.
 *
 * @param {Object[]} candidates - The entry's variables of the parameter's role.
 * @param {string} name - The parameter's name in the template.
 * @param {number} index - Its place among the element's parameters.
 * @param {string} [symbol] - The element's symbol in the CellML.
 * @returns {Object|undefined}
 */
function matchVariable(candidates, name, index, symbol) {
  const bondgraphName = (variable) => variable.bondgraph ?? variable.name
  return (
    candidates.find((variable) => symbol && bondgraphName(variable) === `${name}_${symbol}`) ??
    candidates.find((variable) => bondgraphName(variable) === name || bondgraphName(variable).startsWith(`${name}_`)) ??
    candidates[index]
  )
}

/**
 * Checks whether two values are the same number, or the same text.
 *
 * @param {*} value
 * @param {*} other
 * @returns {boolean}
 */
export function isSameValue(value, other) {
  if (isEmpty(value) || isEmpty(other)) return isEmpty(value) && isEmpty(other)
  const [a, b] = [Number(value), Number(other)]
  return Number.isFinite(a) && Number.isFinite(b) ? a === b : String(value).trim() === String(other).trim()
}

/**
 * Gets the row an initial value is held in: the state's initialiser's, else the state's own.
 *
 * @param {string} name - The state's name.
 * @param {Map<string, Object>} rowsByName
 * @returns {Object|undefined}
 */
function initialValueRow(name, rowsByName) {
  const state = rowsByName.get(name)
  if (state?.initialiser && rowsByName.has(state.initialiser)) return rowsByName.get(state.initialiser)
  return rowsByName.get(`${name}_init`) ?? state
}

/**
 * Checks whether the math computes a row, e.g. a mechanical inductor's acceleration `a`, so it takes no value. A
 * state is set through its initial value, so isn't counted.
 *
 * @param {Object|null|undefined} row
 * @returns {boolean}
 */
export const isComputedRow = (row) => row?.type === 'variable' && row.stateRole !== 'state'

/**
 * Gets an element's value cells: its initial value, or a source's fixed value, then its parameters and variables, each
 * with the CellML name it is generated as, the instance's row (none until the diagram is saved with it), the
 * diagram's value, the instance's default, and whether the math computes it, so it takes no value.
 *
 * @param {Object} element - A DiagramElement.
 * @param {Object|undefined} entry - Its ManifestElement.
 * @param {Map<string, Object>} rowsByName - The instance's rows.
 * @returns {{key: string, label: string, name: string|null, row: Object|null, defaultValue: string, units: string,
 *   isComputed: boolean}[]}
 */
export function elementValues(element, entry, rowsByName) {
  const cells = []
  const cellFor = (key, label, name, row, item) => ({
    key,
    label,
    name: row?.name ?? name ?? null,
    row: row ?? null,
    defaultValue: item?.stored === false ? '' : String(item?.value ?? ''),
    units: row?.units || item?.units || '',
    isComputed: isComputedRow(row),
  })
  if (element.value) {
    const quantity = variablesOf(entry, 'quantity')[0]
    if (quantity || !entry?.primary) {
      const row = quantity ? initialValueRow(quantity.name, rowsByName) : null
      cells.push(cellFor('value', 'initial', row?.name ?? (quantity ? `${quantity.name}_init` : null), row, element.value))
    } else {
      // A source has no quantity: its value is its fixed potential or flow, its primary variable.
      const row = rowsByName.get(entry.primary) ?? null
      cells.push(cellFor('value', 'value', entry.primary, row, element.value))
    }
  }
  const symbol = entry?.symbol
  const groups = [
    ['parameter', element.parameters ?? [], variablesOf(entry, 'parameter')],
    ['variable', element.variables ?? [], variablesOf(entry, 'other')],
  ]
  for (const [prefix, items, candidates] of groups) {
    items.forEach((item, index) => {
      const variable = matchVariable(candidates, item.name, index, symbol)
      const row = variable ? rowsByName.get(variable.name) : null
      cells.push(cellFor(`${prefix}:${item.name}`, item.name, variable?.name, row, item))
    })
  }
  return cells
}

/**
 * Gets the names an element is generated as: its primary variable, then its parameters', as they read in the CellML.
 *
 * @param {Object|undefined} entry - Its ManifestElement.
 * @returns {string[]}
 */
export function generatedNames(entry) {
  if (!entry) return []
  const names = [entry.primary, ...variablesOf(entry, 'parameter').map((variable) => variable.name)]
  return [...new Set(names.filter(Boolean))]
}

/**
 * Finds elements whose generated names clash. With a manifest for the diagram as it is, two elements clash when
 * they share a primary or parameter variable; without one, when two of a kind have the same symbol, species and
 * location.
 *
 * @param {Object[]} elements - DiagramElements.
 * @param {Object|null} manifest - The ElementManifest for this diagram, or null when it has none yet.
 * @returns {Map<string, {otherIds: string[], name: string}>} Each clashing element's id to the others and a name.
 */
export function findClashes(elements, manifest) {
  const owners = new Map()
  const add = (key, id, name) => {
    if (!owners.has(key)) owners.set(key, { ids: new Set(), name })
    owners.get(key).ids.add(id)
  }
  for (const element of elements) {
    const entry = manifest?.[element.id]
    if (manifest && entry) {
      generatedNames(entry).forEach((name) => add(name, element.id, name))
    } else if (!manifest) {
      const name = [element.symbol, element.species, element.location].filter((part) => !isEmpty(part)).join('_')
      add(`${element.kind}|${name}`, element.id, name)
    }
  }
  const clashes = new Map()
  for (const { ids, name } of owners.values()) {
    if (ids.size < 2) continue
    for (const id of ids) {
      if (!clashes.has(id)) clashes.set(id, { otherIds: [...ids].filter((other) => other !== id), name })
    }
  }
  return clashes
}

/**
 * Says what an element still needs: a type, its own species and location, and a value for each value cell that
 * neither a connection supplies nor the math computes.
 *
 * @param {Object} element - A DiagramElement.
 * @param {Object[]} values - Its value cells (elementValues).
 * @param {Set<string>} [supplied] - Names a connection supplies.
 * @returns {string[]}
 */
export function unsetReasons(element, values, supplied = new Set()) {
  const reasons = []
  if (element.isBondElement && !element.template) reasons.push('No type chosen')
  if (element.species === DEFAULT_SPECIES) reasons.push(`Species is still the default, ${DEFAULT_SPECIES}`)
  if (element.location === DEFAULT_LOCATION) reasons.push(`Location is still the default, ${DEFAULT_LOCATION}`)
  values
    .filter(
      (cell) => !cell.isComputed && !supplied.has(cell.name) && isEmpty(cell.row?.value) && isEmpty(cell.defaultValue),
    )
    .forEach((cell) => reasons.push(`No value for ${cell.label}`))
  return reasons
}

/**
 * Checks whether the instance's row follows the diagram's value: it is blank, or holds the diagram's value or the
 * value the module was saved with, which a save of the diagram moves on to its new value.
 *
 * @param {Object} cell - A value cell (elementValues).
 * @param {Map<string, string>} [savedDefaults] - The module's values as saved (libraryStore.getMathDefaults).
 * @returns {boolean}
 */
export function isDefaultValue(cell, savedDefaults = new Map()) {
  const value = cell.row?.value
  if (isEmpty(value)) return true
  if (isSameValue(value, cell.defaultValue)) return true
  const savedName = cell.row?.carriedFrom ?? cell.name
  return !!savedName && savedDefaults.has(savedName) && isSameValue(value, savedDefaults.get(savedName))
}

/**
 * Builds the tab's rows.
 *
 * @param {Object} options
 * @param {Object[]} options.elements - DiagramElements.
 * @param {Object|null} options.manifest - The ElementManifest for the diagram as it is, or null.
 * @param {Object|null} [options.namesManifest] - A manifest to name variables from when `manifest` is null, e.g. the
 *   last one, or the saved diagram's.
 * @param {Object[]} options.rows - The instance's variable rows.
 * @param {Map<string, string>} [options.savedDefaults] - The module's values as saved, the constants' defaults.
 * @param {Object|null} [options.savedManifest] - The saved diagram's ElementManifest, whose elements' rows a renamed
 *   element leaves until the diagram is saved; they aren't the model's constants.
 * @param {Map<string, string>} [options.renames] - The variables unsaved diagram edits renamed (variableRenames),
 *   whose values the instance's rows hold under their old names until the save.
 * @param {Set<string>} [options.supplied] - Names a connection supplies, which need no value; their cells are marked
 *   `supplied`.
 * @returns {{sections: Object[], rowsById: Map<string, Object>, clashCount: number, unsetCount: number}}
 */
export function buildElementTable({
  elements,
  manifest,
  namesManifest = null,
  rows,
  savedDefaults = new Map(),
  savedManifest = null,
  renames = new Map(),
  supplied = new Set(),
}) {
  const naming = manifest ?? namesManifest ?? {}
  const rowsByName = carryRenamedRows(new Map((rows ?? []).map((row) => [row.name, row])), renames)
  const clashes = findClashes(elements, manifest)
  const links = linkJunctions(elements)
  const linkedJunctions = new Map([...links].map(([storeId, junctionId]) => [junctionId, storeId]))
  const byId = new Map(elements.map((element) => [element.id, element]))
  const usedNames = new Set()

  const rowsById = new Map()
  for (const element of elements) {
    const entry = naming[element.id]
    const values = elementValues(element, entry, rowsByName)
    values.forEach((cell) => cell.name && usedNames.add(cell.name))
    values.forEach((cell) => supplied.has(cell.name) && (cell.supplied = true))
    ;(entry?.variables ?? []).forEach((variable) => usedNames.add(variable.name))
    const quantity = variablesOf(entry, 'quantity')[0]
    if (quantity) usedNames.add(rowsByName.get(quantity.name)?.initialiser ?? `${quantity.name}_init`)
    const clash = clashes.get(element.id)
    rowsById.set(element.id, {
      id: element.id,
      element,
      names: generatedNames(entry),
      values,
      unset: unsetReasons(element, values, supplied),
      clash: clash ? { ...clash, others: clash.otherIds.map((id) => byId.get(id)).filter(Boolean) } : null,
      storeId: linkedJunctions.get(element.id) ?? null,
      junctionId: links.get(element.id) ?? null,
    })
  }

  const sections = SECTIONS.map(({ key, label }) => ({ key, label, rows: [] }))
  const section = (key) => sections.find((candidate) => candidate.key === key)
  for (const element of elements) {
    const row = rowsById.get(element.id)
    if (row.storeId) continue
    section(sectionOf(element)).rows.push({ ...row, depth: 0 })
    if (row.junctionId) section('stores').rows.push({ ...rowsById.get(row.junctionId), depth: 1 })
  }
  // The model's own constants, e.g. RT, which no element owns, nor any element did as saved.
  Object.values(savedManifest ?? {}).forEach((entry) => entry.variables.forEach((variable) => usedNames.add(variable.name)))
  ;(rows ?? []).forEach((row) => row.initialiser && usedNames.add(row.initialiser))
  const constants = (rows ?? []).filter(
    (row) => !row.pending && !usedNames.has(row.name) && (row.type === 'constant' || row.type === 'global_constant')
  )
  section('constants').rows = constants.map((row) => {
    const defaultValue = savedDefaults.get(row.name) ?? ''
    return {
      id: `constant:${row.name}`,
      element: null,
      names: [row.name],
      values: [
        {
          key: 'constant',
          label: row.name,
          name: row.name,
          row,
          defaultValue,
          units: row.units ?? '',
          isComputed: false,
          ...(supplied.has(row.name) && { supplied: true }),
        },
      ],
      unset: !supplied.has(row.name) && isEmpty(row.value) && isEmpty(defaultValue) ? [`No value for ${row.name}`] : [],
      clash: null,
      depth: 0,
    }
  })

  const all = [...rowsById.values()]
  return {
    sections: sections.filter((candidate) => candidate.rows.length),
    rowsById,
    clashCount: all.filter((row) => row.clash).length,
    unsetCount: all.filter((row) => row.unset.length).length + section('constants').rows.filter((row) => row.unset.length).length,
  }
}

/**
 * Gets the edits a species or location change makes: the element's, and its linked junction's too, when the junction
 * is on the store's old value or the default. A 0-junction shares one potential, so it follows its store.
 *
 * @param {Object} element - The edited DiagramElement.
 * @param {'species'|'location'} field
 * @param {string} value
 * @param {Object} [options]
 * @param {Object|null} [options.junction] - The store's linked junction.
 * @returns {{id: string, field: string, value: string}[]}
 */
export function structureEdits(element, field, value, { junction = null } = {}) {
  if (element[field] === value) return []
  const edits = [{ id: element.id, field, value }]
  const defaultValue = field === 'species' ? DEFAULT_SPECIES : DEFAULT_LOCATION
  if (junction && junction[field] !== undefined && [element[field], defaultValue].includes(junction[field])) {
    if (junction[field] !== value) edits.push({ id: junction.id, field, value })
  }
  return edits
}

/**
 * Checks whether a linked junction has its own species or location, so doesn't follow its store.
 *
 * @param {Object} junction - A DiagramElement.
 * @param {Object} store - Its store.
 * @returns {boolean}
 */
export function hasOwnNaming(junction, store) {
  return ['species', 'location'].some((field) => {
    const own = junction[field]
    const defaultValue = field === 'species' ? DEFAULT_SPECIES : DEFAULT_LOCATION
    return own !== undefined && own !== store[field] && own !== defaultValue
  })
}

/**
 * Gets a variable's name for an element whose symbol changed, e.g. `K_q_Sub_c` for `K_q_S_c` when `q_S_c` became
 * `q_Sub_c`; null for a name not built on the symbol.
 *
 * @param {string} name
 * @param {string} symbol - The element's symbol before.
 * @param {string} next - Its symbol after.
 * @returns {string|null}
 */
function renamedVariable(name, symbol, next) {
  if (name === symbol) return next
  if (name.endsWith(`_${symbol}`)) return `${name.slice(0, -symbol.length)}${next}`
  return null
}

/**
 * Finds the variables a diagram edit renamed: those of an element whose species or location changed, matched by
 * role to the names the element now generates. A state's initialiser (`q_S_c_init`) is renamed with it. A rename to
 * a name another element still generated before is left out, since that is a clash, not a rename.
 *
 * @param {Object|null} previous - The ElementManifest before, e.g. the saved diagram's.
 * @param {Object|null} next - The ElementManifest after.
 * @returns {Map<string, string>} Each old name to its new one.
 */
export function variableRenames(previous, next) {
  const renames = new Map()
  if (!previous || !next) return renames
  for (const [id, entry] of Object.entries(next)) {
    const before = previous[id]
    if (!before?.symbol || !entry?.symbol || before.symbol === entry.symbol) continue
    const roles = new Map((entry.variables ?? []).map((variable) => [variable.name, variable.role]))
    for (const variable of before.variables ?? []) {
      const name = renamedVariable(variable.name, before.symbol, entry.symbol)
      if (!name || name === variable.name || roles.get(name) !== variable.role) continue
      renames.set(variable.name, name)
      if (variable.role === 'quantity') renames.set(`${variable.name}_init`, `${name}_init`)
    }
  }
  const previousNames = new Set(
    Object.values(previous).flatMap((entry) =>
      (entry.variables ?? []).flatMap((variable) =>
        variable.role === 'quantity' ? [variable.name, `${variable.name}_init`] : [variable.name]
      )
    )
  )
  const targetCounts = new Map()
  renames.forEach((name) => targetCounts.set(name, (targetCounts.get(name) ?? 0) + 1))
  for (const [old, name] of renames) {
    if (targetCounts.get(name) > 1 || (previousNames.has(name) && !renames.has(name))) renames.delete(old)
  }
  return renames
}

/**
 * Gives renamed variables the instance's rows under their old names, until a save renames the rows, so the tab shows
 * the values that follow them. A row already under the new name, e.g. a pending value, wins.
 *
 * @param {Map<string, Object>} rowsByName - Never mutated.
 * @param {Map<string, string>} renames - Each old name to its new one (variableRenames).
 * @returns {Map<string, Object>}
 */
function carryRenamedRows(rowsByName, renames) {
  if (!renames?.size) return rowsByName
  const carried = new Map(rowsByName)
  renames.forEach((name, old) => {
    const row = rowsByName.get(old)
    if (!row) return
    const current = rowsByName.get(name)
    if (current && (current.pending || !renames.has(name))) return
    const initialiser = row.initialiser && (renames.get(row.initialiser) ?? row.initialiser)
    carried.set(name, { ...row, name, ...(initialiser && { initialiser }), carriedFrom: old })
  })
  return carried
}
