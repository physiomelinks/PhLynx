import fs from 'node:fs'
import path from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'
import { analyzeMathXml } from '../../../src/services/math/analyzeMath'
import { detectVersion, migrateWorkspace, separateNodeParameters } from '../../../src/services/workspaceMigrator'
import { PHLYNX_PROJECT_VERSION } from '../../../src/utils/constants'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

const MATH_REF = 'file:decay'
const XML = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="decay">
  <component name="decay">
    <variable name="t" units="second"/>
    <variable name="x" units="metre" initial_value="1.5"/>
    <variable name="k" units="per_second" initial_value="0.5"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/>
        <apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply>
        <apply><times/><apply><minus/><ci>k</ci></apply><ci>x</ci></apply>
      </apply>
    </math>
  </component>
</model>`

const node = (variables) => ({ id: 'n1', data: { name: 'decay_1', mathRef: MATH_REF, variables, ports: [] } })
const byName = (rows) => Object.fromEntries(rows.map((row) => [row.name, row]))

describe('separateNodeParameters', () => {
  it('moves the math values into blank rows and links the state to a new initialiser', () => {
    const { nodes, mathEntries } = separateNodeParameters(
      [node([{ name: 'k', value: '', type: 'constant', units: 'per_second' }])],
      [[MATH_REF, XML]]
    )
    const rows = byName(nodes[0].data.variables)
    expect(rows.k.value).toBe('0.5')
    expect(rows.x).toMatchObject({ stateRole: 'state', initialiser: 'x_init' })
    expect(rows.x_init.value).toBe('1.5')
    expect(mathEntries[0][1]).not.toMatch(/initial_value="[\d.]+"/)
  })

  it('keeps a value the row already has', () => {
    const { nodes } = separateNodeParameters([node([{ name: 'k', value: '3', type: 'constant' }])], [[MATH_REF, XML]])
    expect(byName(nodes[0].data.variables).k.value).toBe('3')
  })

  it("gives the new initialiser the state row's value and data reference", () => {
    const { nodes } = separateNodeParameters(
      [node([{ name: 'x', value: '2', type: 'variable', data_reference: 'Jones1999' }])],
      [[MATH_REF, XML]]
    )
    expect(byName(nodes[0].data.variables).x_init).toMatchObject({ value: '2', data_reference: 'Jones1999' })
  })

  it.each([
    ['not numeric', 'k*2'],
    ['blank', '  '],
  ])('falls back to the math value when the state row is %s', (_, value) => {
    const { nodes } = separateNodeParameters([node([{ name: 'x', value, type: 'variable' }])], [[MATH_REF, XML]])
    expect(byName(nodes[0].data.variables).x_init.value).toBe('1.5')
  })

  it('gives a state with no math initial value its row value', () => {
    const xml = XML.replace('initial_value="1.5"', '')
    const { nodes } = separateNodeParameters([node([{ name: 'x', value: '2', type: 'variable' }])], [[MATH_REF, xml]])
    expect(byName(nodes[0].data.variables).x_init.value).toBe('2')
  })

  it('leaves an initialiser the math already linked alone', () => {
    const xml = XML.replace('initial_value="1.5"', 'initial_value="x0"').replace(
      '<variable name="k"',
      '<variable name="x0" units="metre" initial_value="3"/>\n    <variable name="k"'
    )
    const { nodes } = separateNodeParameters([node([{ name: 'x', value: '2', type: 'variable' }])], [[MATH_REF, xml]])
    expect(byName(nodes[0].data.variables).x0.value).toBe('3')
  })

  it('leaves separated math and its nodes alone', () => {
    const first = separateNodeParameters([node([])], [[MATH_REF, XML]])
    const second = separateNodeParameters(first.nodes, first.mathEntries)
    expect(second.nodes[0]).toBe(first.nodes[0])
    expect(second.mathEntries).toEqual(first.mathEntries)
  })
})

describe('migrateWorkspace', () => {
  it('separates the values of a current-format workspace', () => {
    const migrated = migrateWorkspace({
      version: '1.0.0',
      flow: { nodes: [node([])], edges: [] },
      store: { availableMath: [[MATH_REF, XML]] },
    })
    expect(byName(migrated.flow.nodes[0].data.variables).k.value).toBe('0.5')
    expect(migrated.store.availableMath[0][1]).not.toMatch(/initial_value="[\d.]+"/)
    expect(migrated.version).toBe(PHLYNX_PROJECT_VERSION)
  })

  it('records the values taken out of the math as its defaults', () => {
    const migrated = migrateWorkspace({
      version: '1.0.0',
      flow: { nodes: [node([])], edges: [] },
      store: { availableMath: [[MATH_REF, XML]] },
    })
    expect(new Map(new Map(migrated.store.mathDefaults).get(MATH_REF))).toEqual(
      new Map([
        ['k', '0.5'],
        ['x_init', '1.5'],
      ])
    )
  })

  it('keeps data references, moving a state\'s onto its new initialiser', () => {
    const migrated = migrateWorkspace({
      version: '1.0.0',
      flow: {
        nodes: [
          node([
            { name: 'k', value: '', type: 'constant', data_reference: 'Smith2001' },
            { name: 'x', value: '', type: 'variable', data_reference: 'Jones1999' },
          ]),
        ],
        edges: [],
      },
      store: { availableMath: [[MATH_REF, XML]] },
    })
    const rows = byName(migrated.flow.nodes[0].data.variables)
    expect(rows.k.data_reference).toBe('Smith2001')
    expect(rows.x.data_reference).toBe('Jones1999')
    expect(rows.x_init.data_reference).toBe('Jones1999')
  })

  describe('global constants', () => {
    const globalNode = (id) => ({
      ...node([{ name: 'k', value: '', type: 'global_constant', units: 'per_second' }]),
      id,
    })
    const migrateGlobals = (globalConstants, nodes = [globalNode('n1')]) =>
      new Map(
        migrateWorkspace({
          version: '1.0.0',
          flow: { nodes, edges: [] },
          store: { availableMath: [[MATH_REF, XML]], ...(globalConstants && { globalConstants }) },
        }).store.globalConstants
      )

    it('gives a global with no stored value its math value', () => {
      expect(migrateGlobals().get('k')).toEqual({ value: '0.5', units: 'per_second', data_reference: null })
    })

    it('keeps a stored value', () => {
      const stored = { value: '9', units: 'per_second', data_reference: 'Smith2001' }
      expect(migrateGlobals([['k', stored]]).get('k')).toEqual(stored)
    })

    it('fills a stored blank value', () => {
      const stored = { value: '', units: 'per_second', data_reference: 'Smith2001' }
      expect(migrateGlobals([['k', stored]]).get('k')).toEqual({ ...stored, value: '0.5' })
    })

    it('makes one entry for a global several nodes share', () => {
      const constants = migrateGlobals(undefined, [globalNode('n1'), globalNode('n2')])
      expect([...constants.keys()]).toEqual(['k'])
    })
  })

  it('gives 1.0.0 math no text layouts, and keeps any already there', () => {
    const doc = { version: '1.0.0', flow: { nodes: [node([])], edges: [] }, store: { availableMath: [[MATH_REF, XML]] } }
    const migrated = migrateWorkspace(doc)
    expect(migrated.store.mathLayouts).toEqual([])

    const layouts = [[MATH_REF, { format: 'cellml-text-layout', version: 1, components: [] }]]
    expect(migrateWorkspace({ ...doc, store: { ...doc.store, mathLayouts: layouts } }).store.mathLayouts).toBe(layouts)
  })

  it('leaves a workspace at the current version as it is', () => {
    const doc = {
      id: 'phlynx-project',
      version: PHLYNX_PROJECT_VERSION,
      flow: { nodes: [node([{ name: 'k', value: '', type: 'constant' }])], edges: [] },
      store: { availableMath: [[MATH_REF, XML]] },
      simulation: { simulationSettings: {}, plotConfig: {}, parameterScanConfig: {} },
      inspectionModules: [],
    }
    expect(migrateWorkspace(doc)).toEqual(doc)
  })

  it('gives an early 1.0.0 file the simulation block 1.0.0 requires', () => {
    const migrated = migrateWorkspace({
      info: { format_version: '1.0.0', project: 'Phlynx-Project' },
      flow: { nodes: [], edges: [] },
      store: { availableMath: [] },
    })
    expect(migrated.simulation).toMatchObject({ plotConfig: {}, parameterScanConfig: {} })
    expect(migrated.simulation.simulationSettings).toBeDefined()
  })

  it('refuses a version it does not know', () => {
    expect(() => migrateWorkspace({ version: '99.0.0', flow: { nodes: [] }, store: {} })).toThrow(/99\.0\.0/)
  })
})

describe('detectVersion', () => {
  it('reads the version from each envelope', () => {
    expect(detectVersion({ version: '1.1.0' })).toBe('1.1.0')
    expect(detectVersion({ info: { format_version: '1.0.0', project: 'Phlynx-Project' } })).toBe('1.0.0')
    expect(detectVersion({ flow: {}, store: {} })).toBe('legacy')
  })
})

const FIXTURES_DIR = path.resolve(process.cwd(), 'tests/resources/migration-versioning')
const ERAS = fs
  .readdirSync(FIXTURES_DIR)
  .filter((name) => name === 'legacy' || /^v\d+-\d+-\d+$/.test(name))
const FIXTURES = ERAS.flatMap((era) =>
  fs
    .readdirSync(path.join(FIXTURES_DIR, era))
    .filter((file) => file.endsWith('.json'))
    .map((file) => [`${era}/${file}`, era])
)

const readFixture = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8'))

/**
 * Lists the data references a fixture gives its node rows, keyed `<node>|<variable>`.
 * A legacy file keeps them in availableParameters under `<variable>_<node>`.
 */
function expectedRowReferences(doc, era) {
  const references = new Map()
  if (era === 'legacy') {
    const byParameterName = new Map((doc.store.availableParameters ?? []).map(([, entry]) => [entry.variable_name, entry]))
    for (const { data } of doc.flow.nodes) {
      const globalNames = new Set((data.variables ?? []).filter((v) => v.type === 'global_constant').map((v) => v.name))
      for (const { name } of data.portOptions ?? []) {
        const reference = byParameterName.get(`${name}_${data.name}`)?.data_reference
        if (reference != null && !globalNames.has(name)) references.set(`${data.name}|${name}`, reference)
      }
    }
  } else {
    for (const { data } of doc.flow.nodes) {
      for (const row of data.variables ?? []) {
        if (row.data_reference != null) references.set(`${data.name}|${row.name}`, row.data_reference)
      }
    }
  }
  return references
}

const isBlankValue = (value) => value == null || String(value).trim() === ''

/**
 * Lists the value each node row gives the model, keyed `<node>|<variable>`, following a name to the
 * row it refers to. Rows the math computes are left out.
 *
 * @param {Object} doc - A 1.0.0 or 1.1.0 workspace.
 * @param {boolean} mathFallback - Whether a blank row falls back to the math's initial value, as 1.0.0 did.
 * @returns {Map<string, string>}
 */
function effectiveValues(doc, mathFallback) {
  const math = new Map(doc.store.availableMath)
  const globals = new Map(doc.store.globalConstants ?? [])
  const values = new Map()
  for (const { data } of doc.flow.nodes) {
    const analysis = analyzeMathXml(math.get(data.mathRef) ?? '')
    const initialValues = new Map((analysis?.declared ?? []).map((variable) => [variable.name, variable.initialValue]))
    const states = new Set(analysis?.stateVariables ?? [])
    const raw = new Map()
    for (const row of data.variables ?? []) {
      const isState = states.has(row.name)
      if (row.type === 'variable' && !isState) continue
      let value = row.type === 'global_constant' ? globals.get(row.name)?.value : undefined
      if (isBlankValue(value) && (mathFallback || !isState)) value = row.value
      if (isBlankValue(value) && (mathFallback || isState)) value = initialValues.get(row.name)
      raw.set(row.name, isBlankValue(value) ? '' : String(value).trim())
    }
    const resolve = (value, depth = 0) => (raw.has(value) && depth < 10 ? resolve(raw.get(value), depth + 1) : value)
    for (const [name, value] of raw) values.set(`${data.name}|${name}`, resolve(value))
  }
  return values
}

const globalReferences = (globalConstants = []) => Object.fromEntries(globalConstants.map(([name, entry]) => [name, entry.data_reference]))

describe('migrateWorkspace over saved workspaces', () => {
  beforeAll(async () => {
    await ensureLibCellmlReady()
  })

  it.each(FIXTURES)('brings %s up to the current version', (name, era) => {
    const doc = readFixture(name)
    const migrated = migrateWorkspace(doc)

    expect(migrated.version).toBe(PHLYNX_PROJECT_VERSION)
    expect(migrated.info).toBeUndefined()

    const actual = new Map(
      migrated.flow.nodes.flatMap(({ data }) => (data.variables ?? []).map((row) => [`${data.name}|${row.name}`, row.data_reference]))
    )
    for (const [key, reference] of expectedRowReferences(doc, era)) {
      expect({ key, reference: actual.get(key) }).toEqual({ key, reference })
    }

    if (era !== 'legacy') {
      expect(globalReferences(migrated.store.globalConstants)).toEqual(globalReferences(doc.store.globalConstants))
    } else {
      const parameterReferences = new Map(
        (doc.store.availableParameters ?? []).map(([, entry]) => [entry.variable_name, entry.data_reference])
      )
      for (const [constantName, reference] of Object.entries(globalReferences(migrated.store.globalConstants))) {
        if (parameterReferences.has(constantName)) expect(reference).toBe(parameterReferences.get(constantName))
      }

      // Global constants set in the app live only in store.globalConstants.
      const migratedConstants = new Map(migrated.store.globalConstants)
      for (const [constantName, { value, units }] of doc.store.globalConstants ?? []) {
        expect({ constantName, ...migratedConstants.get(constantName) }).toMatchObject({ constantName, value, units })
      }
    }

    const separatedRefs = migrated.store.availableMath
      .filter(([mathRef]) => /initial_value="[\d.eE+-]+"/.test(new Map(doc.store.availableMath ?? []).get(mathRef) ?? ''))
      .map(([mathRef]) => mathRef)
    const defaultRefs = new Set(migrated.store.mathDefaults.map(([mathRef]) => mathRef))
    for (const mathRef of separatedRefs) expect(defaultRefs).toContain(mathRef)
  })

  it.each(FIXTURES.filter(([, era]) => era === 'v1-0-0'))(
    'gives the model the same values for %s after migrating',
    (name) => {
      const doc = readFixture(name)
      const before = effectiveValues(doc, true)
      const after = effectiveValues(migrateWorkspace(doc), false)
      for (const [key, value] of before) expect({ key, value: after.get(key) }).toEqual({ key, value })
    }
  )

  it.each(FIXTURES)('migrates %s once, so loading the result again changes nothing', (name) => {
    const migrated = migrateWorkspace(readFixture(name))
    const saved = JSON.parse(JSON.stringify(migrated))
    expect(migrateWorkspace(saved)).toEqual(saved)
  })
})
