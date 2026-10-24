// The CellDL Parameters tab's rows, from the enzyme diagram as the CellDL editor lists it and as bg2cellml converts
// it (fixtures/celldl/enzyme_canonical.*.json, taken from the app).
import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  buildElementTable,
  elementValues,
  findClashes,
  hasOwnNaming,
  isDefaultValue,
  linkJunctions,
  sectionOf,
  structureEdits,
  templateLabel,
  typeOptions,
  unsetReasons,
  variableRenames,
} from '../../../../src/services/celldl/elementTable.js'
import { renamePortVariables, renameRows, renameValues } from '../../../../src/services/math/reconcileRows.js'

const read = (name) => JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../fixtures/celldl', name), 'utf8'))
const ELEMENTS = read('enzyme_canonical.elements.json')
const { manifest: MANIFEST, rows: ROWS, defaults: DEFAULTS } = read('enzyme_canonical.module.json')

const CHEMICAL = 'https://bg-rdf.org/ontologies/bondgraph-framework#Chemical'
const BGF = 'https://bg-rdf.org/ontologies/bondgraph-framework#'
const byId = (id, elements = ELEMENTS) => elements.find((element) => element.id === id)
const rowsByName = (rows = ROWS) => new Map(rows.map((row) => [row.name, { ...row }]))
const freshRows = () => ROWS.map((row) => ({ ...row }))
const STORE_S = 'ID-00000001'
const JUNCTION_S = 'ID-00000002'
const REACTION_R1 = 'ID-00000006'

/** The element with some fields changed. */
const edit = (id, fields, elements = ELEMENTS) =>
  elements.map((element) => (element.id === id ? { ...element, ...fields } : element))

describe('the CellDL Parameters table', () => {
  describe('grouping', () => {
    it('puts stores, reactions and junctions in their sections', () => {
      expect(sectionOf(byId(STORE_S))).toBe('stores')
      expect(sectionOf(byId(REACTION_R1))).toBe('reactions')
      expect(sectionOf(byId(JUNCTION_S))).toBe('junctions')
      expect(sectionOf(byId('ID-00000005'))).toBe('junctions')
      // Before its type is chosen, a store has no initial value, but its kind says what it is.
      const untyped = { ...byId(STORE_S), template: undefined, value: undefined, parameters: [] }
      expect(sectionOf(untyped)).toBe('stores')
      expect(linkJunctions(ELEMENTS.map((element) => (element.id === STORE_S ? untyped : element))).get(STORE_S)).toBe(JUNCTION_S)
    })

    it("links each store to the 0-junction it alone is bonded to, and lists it under the store", () => {
      const links = linkJunctions(ELEMENTS)
      expect(links.get(STORE_S)).toBe(JUNCTION_S)
      expect(links.get('ID-00000003')).toBe('ID-00000004')
      expect(links.get('ID-00000014')).toBe('ID-00000013')
      expect(links.size).toBe(4)

      const table = buildElementTable({ elements: ELEMENTS, manifest: MANIFEST, rows: ROWS })
      const stores = table.sections.find((section) => section.key === 'stores')
      expect(stores.rows.map((row) => [row.id, row.depth])).toEqual([
        [STORE_S, 0],
        [JUNCTION_S, 1],
        ['ID-00000003', 0],
        ['ID-00000004', 1],
        ['ID-00000008', 0],
        ['ID-00000009', 1],
        ['ID-00000014', 0],
        ['ID-00000013', 1],
      ])
      const junctions = table.sections.find((section) => section.key === 'junctions')
      expect(junctions.rows.map((row) => row.id)).toEqual(['ID-00000005', 'ID-00000007', 'ID-00000010', 'ID-00000012'])
    })

    it("doesn't link a 0-junction bonded to two stores", () => {
      const elements = edit(JUNCTION_S, { neighbours: [STORE_S, 'ID-00000003'] })
      expect(linkJunctions(elements).has(STORE_S)).toBe(false)
    })

    it("lists the model's own constants, but not a renamed element's old rows", () => {
      const table = buildElementTable({
        elements: edit(STORE_S, { species: 'Glc' }),
        manifest: null,
        namesManifest: renamedManifest(),
        rows: ROWS,
        savedDefaults: new Map(DEFAULTS),
        savedManifest: MANIFEST,
      })
      const constants = table.sections.find((section) => section.key === 'constants')
      expect(constants.rows.map((row) => row.names[0])).toEqual(['RT', 'F'])
      expect(constants.rows[1].values[0]).toMatchObject({ name: 'F', defaultValue: '96485', units: 'C_per_mol' })
    })
  })

  describe('types', () => {
    it("offers the templates the Properties panel offers, of every domain, without the base kind or IRIs", () => {
      const reaction = byId(REACTION_R1)
      const unbonded = { ...reaction, templates: [...reaction.templates, { type: `${BGF}Resistor`, name: 'Resistor', domain: `${BGF}Electrical` }] }

      const { options, value } = typeOptions(unbonded)
      expect(options.map((option) => option.label)).toEqual(['NKETransporter', 'Chemical reaction', 'Resistor'])
      expect(options.map((option) => option.value)).not.toContain(reaction.kind)
      expect(value).toBe(`${BGF}ChemicalReaction`)
      expect(templateLabel({ type: `${BGF}X`, name: `${BGF}NKETransporter` })).toBe('NKETransporter')
    })

    it("offers a zero storage node every domain's storage node, and still names it while it has no type", () => {
      const storageNode = {
        ...byId(STORE_S),
        kind: `${BGF}ZeroStorageNode`,
        kindName: 'Zero storage node',
        template: undefined,
        templateName: undefined,
        templates: [
          { type: `${BGF}ZeroStorageNode`, name: 'Zero storage node' },
          { type: `${BGF}ChemicalStorageNode`, name: 'Chemical storage with Zero Node', domain: CHEMICAL },
          { type: `${BGF}ElectricalCapacitiveNode`, name: 'Electrical storage with Zero Node', domain: `${BGF}Electrical` },
          { type: `${BGF}MechanicalCapacitiveNode`, name: 'Mechanical storage with Zero Node', domain: `${BGF}Mechanical` },
        ],
      }
      const { options, value, placeholder } = typeOptions(storageNode)
      expect(options.map((option) => option.value)).toEqual([
        `${BGF}ChemicalStorageNode`,
        `${BGF}ElectricalCapacitiveNode`,
        `${BGF}MechanicalCapacitiveNode`,
      ])
      expect(value).toBeNull()
      expect(placeholder).toBe('Zero storage node')
      expect(unsetReasons(storageNode, [])).toContain('No type chosen')
      expect(sectionOf({ ...storageNode, value: undefined })).toBe('stores')
      // As the editor gives it once its type is cleared.
      expect(typeOptions({ ...storageNode, template: null }).value).toBeNull()
    })

    it("keeps an element's template when the editor's list lacks it", () => {
      const store = byId(STORE_S)
      const { options, value } = typeOptions({ ...store, templates: store.templates.slice(0, 1) })
      expect(options).toEqual([{ value: store.template, label: store.templateName }])
      expect(value).toBe(store.template)
    })
  })

  describe('values', () => {
    it("maps an element's initial value and parameters to the instance's rows by their generated names", () => {
      const rows = rowsByName()
      const [initial, K] = elementValues(byId(STORE_S), MANIFEST[STORE_S], rows)
      expect(initial).toMatchObject({ key: 'value', name: 'q_S_c_init', defaultValue: '1', units: 'mole' })
      expect(initial.row).toBe(rows.get('q_S_c_init'))
      expect(K).toMatchObject({ key: 'parameter:K', label: 'K', name: 'K_q_S_c', defaultValue: '1', units: 'per_mol' })

      const [kappa] = elementValues(byId(REACTION_R1), MANIFEST[REACTION_R1], rows)
      expect(kappa).toMatchObject({ key: 'parameter:kappa', name: 'kappa_Rx_r1_c', defaultValue: '10' })
      expect(elementValues(byId(JUNCTION_S), MANIFEST[JUNCTION_S], rows)).toEqual([])
    })

    it("maps a chemostat's value to its potential's row, as a source has no initial value", () => {
      const chemostat = {
        ...byId(STORE_S),
        kind: `${BGF}PotentialSource`,
        template: `${BGF}ChemicalPotential`,
        species: 'ATP',
        parameters: [],
        value: { value: '1', units: 'J/mol', stored: true },
      }
      const entry = {
        kind: 'element',
        symbol: 'u_S_ATP_c',
        primary: 'u_S_ATP_c',
        variables: [
          { name: 'v_S_ATP_c', role: 'flow', units: 'mol_per_s' },
          { name: 'u_S_ATP_c', role: 'potential', units: 'J_per_mol' },
        ],
      }
      const row = { name: 'u_S_ATP_c', value: '1', units: 'J_per_mol', type: 'constant' }
      expect(elementValues(chemostat, entry, new Map([[row.name, row]]))).toEqual([
        { key: 'value', label: 'value', name: 'u_S_ATP_c', row, defaultValue: '1', units: 'J_per_mol' },
      ])
      // Before the diagram is saved with it, the cell is named for the variable, with no row yet.
      expect(elementValues(chemostat, entry, new Map())[0]).toMatchObject({ name: 'u_S_ATP_c', row: null })
    })

    it("names a new store's defaults before the diagram is saved with it", () => {
      const store = { ...byId(STORE_S), species: 'X', value: { value: '0', units: 'mol', stored: true } }
      const entry = {
        kind: 'element',
        symbol: 'q_X_c',
        primary: 'q_X_c',
        variables: [
          { name: 'q_X_c', role: 'quantity', units: 'mol' },
          { name: 'K_q_X_c', role: 'parameter', units: 'mol-1' },
        ],
      }
      expect(elementValues(store, entry, new Map())).toMatchObject([
        { key: 'value', name: 'q_X_c_init', row: null, defaultValue: '0', units: 'mol' },
        { key: 'parameter:K', name: 'K_q_X_c', row: null, defaultValue: '1', units: 'mol-1' },
      ])
    })

    it("names a renamed element's variables from the manifest, with no row until the diagram is saved", () => {
      const [, K] = elementValues({ ...byId(STORE_S), species: 'Glc' }, renamedManifest()[STORE_S], rowsByName())
      expect(K).toMatchObject({ name: 'K_q_Glc_c', row: null, defaultValue: '1', units: 'mol-1' })
    })

    it('counts a value as the default while blank, or on the diagram or saved value', () => {
      const cell = { name: 'kappa_Rx_r1_c', defaultValue: '10', row: { value: '' } }
      const saved = new Map([['kappa_Rx_r1_c', '5']])
      expect(isDefaultValue(cell, saved)).toBe(true)
      expect(isDefaultValue({ ...cell, row: { value: '10.0' } }, saved)).toBe(true)
      // The diagram's value changed in its Properties panel since the save, and the row is on the saved one.
      expect(isDefaultValue({ ...cell, row: { value: '5' } }, saved)).toBe(true)
      expect(isDefaultValue({ ...cell, row: { value: '2' } }, saved)).toBe(false)
    })

    it('flags a value with neither its own nor a default', () => {
      const element = byId(REACTION_R1)
      const values = [{ label: 'kappa', name: 'kappa_Rx_r1_c', row: { value: '' }, defaultValue: '' }]
      expect(unsetReasons(element, values)).toEqual(['No value for kappa'])
      expect(unsetReasons(element, [{ ...values[0], defaultValue: '10' }])).toEqual([])
    })

    it('needs no value for a cell a connection supplies, nor counts its row as unset', () => {
      const element = byId(REACTION_R1)
      const values = [{ label: 'kappa', name: 'kappa_Rx_r1_c', row: { value: '' }, defaultValue: '' }]
      expect(unsetReasons(element, values, new Set(['kappa_Rx_r1_c']))).toEqual([])
      const rows = ROWS.map((row) => (row.name === 'q_S_c_init' ? { ...row, value: '' } : row))
      const defaults = { elements: edit(STORE_S, { value: { value: '' } }), manifest: MANIFEST, rows }
      expect(buildElementTable(defaults).rowsById.get(STORE_S).unset).toEqual(['No value for initial'])
      const table = buildElementTable({ ...defaults, supplied: new Set(['q_S_c_init']) })
      expect(table.rowsById.get(STORE_S).unset).toEqual([])
      expect(table.unsetCount).toBe(0)
    })
  })

  describe('flags', () => {
    it("flags the default species and location", () => {
      const fresh = { ...byId(STORE_S), species: 'i', location: 'j' }
      expect(unsetReasons(fresh, [])).toEqual(['Species is still the default, i', 'Location is still the default, j'])
      const table = buildElementTable({ elements: edit(STORE_S, { species: 'i' }), manifest: MANIFEST, rows: ROWS })
      expect(table.unsetCount).toBe(1)
      expect(table.rowsById.get(STORE_S).unset).toHaveLength(1)
    })

    it("flags elements the manifest gives the same names, junctions too, and clears once fixed", () => {
      const manifest = renamedManifest({ [STORE_S]: 'E', [JUNCTION_S]: 'E' })
      const clashes = findClashes(ELEMENTS, manifest)
      expect([...clashes.keys()].sort()).toEqual([STORE_S, JUNCTION_S, 'ID-00000003', 'ID-00000004'].sort())
      expect(clashes.get(STORE_S)).toEqual({ otherIds: ['ID-00000003'], name: 'q_E_c' })
      expect(clashes.get(JUNCTION_S)).toEqual({ otherIds: ['ID-00000004'], name: 'u_E_c' })
      expect(findClashes(ELEMENTS, MANIFEST).size).toBe(0)
    })

    it('flags two of a kind with the same symbol, species and location before any manifest', () => {
      const elements = edit(STORE_S, { species: 'E' })
      const clashes = findClashes(elements, null)
      expect([...clashes.keys()].sort()).toEqual([STORE_S, 'ID-00000003'])
      expect(clashes.get(STORE_S).name).toBe('q_E_c')
      // A store and its junction share species and location, but not a kind.
      expect(findClashes(ELEMENTS, null).size).toBe(0)
    })
  })

  describe('junctions following their store', () => {
    const store = byId(STORE_S)
    const junction = byId(JUNCTION_S)

    it("renames the junction with its store when it is on the store's old name or the default", () => {
      expect(structureEdits(store, 'species', 'Glc', { junction })).toEqual([
        { id: STORE_S, field: 'species', value: 'Glc' },
        { id: JUNCTION_S, field: 'species', value: 'Glc' },
      ])
      expect(structureEdits(store, 'location', 'm', { junction: { ...junction, location: 'j' } })).toEqual([
        { id: STORE_S, field: 'location', value: 'm' },
        { id: JUNCTION_S, field: 'location', value: 'm' },
      ])
    })

    it('leaves a junction with its own name, or with following off, and sends nothing for no change', () => {
      const own = { ...junction, species: 'Sx' }
      expect(structureEdits(store, 'species', 'Glc', { junction: own })).toEqual([{ id: STORE_S, field: 'species', value: 'Glc' }])
      expect(hasOwnNaming(own, store)).toBe(true)
      expect(hasOwnNaming(junction, store)).toBe(false)
      expect(structureEdits(store, 'species', 'Glc', { junction, follow: false })).toHaveLength(1)
      expect(structureEdits(store, 'species', 'S', { junction })).toEqual([])
    })
  })
})

describe('renamed variables', () => {
  /** The instance's rows with its own K and initial value of q_S_c. */
  const ownRows = () =>
    freshRows().map((row) =>
      row.name === 'K_q_S_c' ? { ...row, value: '5' } : row.name === 'q_S_c_init' ? { ...row, value: '2' } : row
    )

  it("maps a store's and its junction's variables to the names a species change gives them", () => {
    const renames = variableRenames(MANIFEST, renamedManifest())
    expect(Object.fromEntries(renames)).toEqual({
      q_S_c: 'q_Glc_c',
      q_S_c_init: 'q_Glc_c_init',
      v_q_S_c: 'v_q_Glc_c',
      u_q_S_c: 'u_q_Glc_c',
      K_q_S_c: 'K_q_Glc_c',
      u_S_c: 'u_Glc_c',
    })
    expect(variableRenames(MANIFEST, MANIFEST).size).toBe(0)
    expect(variableRenames(null, MANIFEST).size).toBe(0)
  })

  it('leaves out a rename onto a name another element still has, which is a clash', () => {
    const renames = variableRenames(MANIFEST, renamedManifest({ [STORE_S]: 'E', [JUNCTION_S]: 'E' }))
    expect(renames.size).toBe(0)
  })

  it('swaps the names of two elements that swapped species', () => {
    const swapped = structuredClone(MANIFEST)
    const swap = (id, from, to) => {
      const entry = swapped[id]
      const rename = (text) => text.replace(new RegExp(`_${from}_c$`), `_${to}_c`)
      entry.symbol = rename(entry.symbol)
      entry.variables = entry.variables.map((variable) => ({ ...variable, name: rename(variable.name) }))
    }
    swap(STORE_S, 'S', 'P')
    swap('ID-00000014', 'P', 'S')
    const renames = variableRenames(MANIFEST, swapped)
    expect(renames.get('K_q_S_c')).toBe('K_q_P_c')
    expect(renames.get('K_q_P_c')).toBe('K_q_S_c')

    const rows = renameRows(ownRows(), renames)
    expect(rows.find((row) => row.name === 'K_q_P_c').value).toBe('5')
    expect(rows.filter((row) => row.name === 'K_q_S_c')).toHaveLength(1)
    const values = renameValues(new Map(DEFAULTS), renames)
    expect(values.get('K_q_P_c')).toBe('1')
    expect(values.get('K_q_S_c')).toBe('0.01')
  })

  it("shows the instance's own values under the new names before the save", () => {
    const table = buildElementTable({
      elements: edit(STORE_S, { species: 'Glc' }),
      manifest: renamedManifest(),
      rows: ownRows(),
      savedDefaults: new Map(DEFAULTS),
      savedManifest: MANIFEST,
      renames: variableRenames(MANIFEST, renamedManifest()),
    })
    const [initial, K] = table.rowsById.get(STORE_S).values
    expect(K).toMatchObject({ name: 'K_q_Glc_c', row: { value: '5', carriedFrom: 'K_q_S_c' } })
    expect(initial).toMatchObject({ name: 'q_Glc_c_init', row: { value: '2', carriedFrom: 'q_S_c_init' } })
    expect(isDefaultValue(K, new Map(DEFAULTS))).toBe(false)
    // A row on the saved default still counts as the default under its new name.
    const onDefault = { ...K, row: { ...K.row, value: '1' } }
    expect(isDefaultValue({ ...onDefault, defaultValue: '3' }, new Map(DEFAULTS))).toBe(true)
  })

  it('renames rows, initialisers, values and port variables, dropping a stale row under a new name', () => {
    const renames = new Map([
      ['q_S_c', 'q_Glc_c'],
      ['q_S_c_init', 'q_Glc_c_init'],
    ])
    const rows = renameRows(
      [
        { name: 'q_S_c', initialiser: 'q_S_c_init', value: '' },
        { name: 'q_S_c_init', value: '2' },
        { name: 'q_Glc_c_init', value: '9' },
      ],
      renames
    )
    expect(rows).toEqual([
      { name: 'q_Glc_c', initialiser: 'q_Glc_c_init', value: '' },
      { name: 'q_Glc_c_init', value: '2' },
    ])
    expect(renamePortVariables([{ label: 'p', variables: ['q_S_c', 't'] }], renames)).toEqual([
      { label: 'p', variables: ['q_Glc_c', 't'] },
    ])
  })
})

/**
 * The manifest as bg2cellml would give it with elements' species changed.
 *
 * @param {Object<string, string>} [species] - New species by element id; S becomes Glc by default.
 */
function renamedManifest(species = { [STORE_S]: 'Glc', [JUNCTION_S]: 'Glc' }) {
  const manifest = structuredClone(MANIFEST)
  for (const [id, name] of Object.entries(species)) {
    const entry = manifest[id]
    const rename = (text) => text.replace(/_S_c$/, `_${name}_c`)
    entry.symbol = rename(entry.symbol)
    entry.primary = rename(entry.primary)
    entry.variables = entry.variables.map((variable) => ({
      ...variable,
      name: rename(variable.name),
      units: variable.role === 'parameter' ? 'mol-1' : variable.units,
    }))
  }
  return manifest
}
