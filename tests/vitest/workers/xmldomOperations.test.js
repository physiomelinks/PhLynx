// @vitest-environment node
/**
 * The libCellML operations that will move into a worker, run as a worker runs them: with no document, window or Node,
 * and @xmldom/xmldom installed as the DOMParser and XMLSerializer.
 */
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { buildModularModel } from '../../../src/services/export/modularCellml.js'
import { createMapSource, inlineUnitsImports } from '../../../src/services/import/cellmlImports.js'
import { analyzeMathXml } from '../../../src/services/math/analyzeMath.js'
import { reconcileRows } from '../../../src/services/math/reconcileRows.js'
import {
  applyVariableIds,
  carryVariableIds,
  ensureVariableIds,
  listElementIds,
  stripIds,
  variableIdsOf,
} from '../../../src/services/math/variableIds.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import {
  extractComponentsFromCellmlString,
  generateFlattenedModel,
  prefixIdAttributes,
  processCellMLData,
  splitWideMath,
  stripCelsiusToArbitraryUnit,
} from '../../../src/utils/cellml.js'
import { CELLML_NS, MATHML_NS } from '../../../src/utils/constants.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

const XLINK_NS = 'http://www.w3.org/1999/xlink'
const MATH_REF = 'decay.cellml:decay'
// dx/dt = g - k * x, with ids for the variable-id and modular paths.
const DECAY = `<model xmlns="${CELLML_NS}" name="decay">
  <component name="decay" id="c1">
    <variable name="t" units="second" interface="public"/>
    <variable id="v1" name="x" units="dimensionless" initial_value="x_init" interface="public"/>
    <variable name="x_init" units="dimensionless" initial_value="2" interface="public"/>
    <variable name="k" units="per_second" initial_value="0.5" interface="public"/>
    <variable name="g" units="per_second" interface="public"/>
    <math xmlns="${MATHML_NS}">
      <apply><eq/>
        <apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply>
        <apply><minus/><ci>g</ci><apply><times/><ci>k</ci><ci>x</ci></apply></apply>
      </apply>
    </math>
  </component>
</model>`
const UNITS = `<model xmlns="${CELLML_NS}" name="units">
  <units name="per_second"><unit units="second" exponent="-1"/></units>
</model>`

beforeAll(async () => {
  globalThis.DOMParser = DOMParser
  globalThis.XMLSerializer = XMLSerializer
  await ensureLibCellmlReady()
}, 120000)

it('runs without the browser DOM', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
  expect(typeof Node).toBe('undefined')
  expect(globalThis.DOMParser).toBe(DOMParser)
})

describe('with a library store', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    store.addUnitsFile({ componentFile: 'units.cellml', model: UNITS })
    store.addMathFile('decay.cellml', [{ name: 'decay', math: DECAY }])
    store.assignGlobalConstant('g', '0.1', 'per_second')
  })

  const buildNode = (id) => {
    const variables = reconcileRows(analyzeMathXml(store.availableMath.get(MATH_REF)), [{ name: 'g', type: 'global_constant' }], {
      defaults: store.getMathDefaults(MATH_REF),
    })
    return { id, type: 'instanceNode', data: { name: id, mathRef: MATH_REF, variables, ports: [] } }
  }

  it('generates the flattened model, with the units file and the global constant', async () => {
    const text = await (await generateFlattenedModel([buildNode('decay_1')], [], store)).text()
    expect(text).toMatch(/<units name="per_second">/)
    expect(text).toMatch(/<variable name="k"[^>]*initial_value="0\.5"/)
    expect(text).toMatch(/<variable name="g"[^>]*initial_value="0\.1"/)
  })

  it('builds the modular model', async () => {
    const modular = await buildModularModel([buildNode('decay_a'), buildNode('decay_b')], [], store)
    expect(modular.files.map(({ location }) => location)).toEqual(['decay.cellml'])
    expect(modular.main).toMatch(/<import [^>]*xlink:href="decay\.cellml"/)
    expect(modular.main).toMatch(/<component component_ref="decay" name="decay_a"\/>/)
    expect(modular.files[0].text).toMatch(/id="v1"/)
    expect(modular.unitsFiles.map(({ location }) => location)).toEqual(['units/units.cellml'])
  })
})

describe('string operations', () => {
  it('splits wide math', () => {
    const terms = Array.from({ length: 150 }, (_, i) => `<ci>x${i}</ci>`).join('')
    const equations = Array.from({ length: 101 }, (_, i) => `<apply><eq/><ci>y${i}</ci><apply><plus/>${i ? '<ci>a</ci><ci>b</ci>' : terms}</apply></apply>`)
    const split = splitWideMath(`<math xmlns="${MATHML_NS}" xmlns:cellml="${CELLML_NS}">${equations.join('')}</math>`)
    expect(split.match(/<math /g)).toHaveLength(2)
    expect(split.match(/<plus\/>/g)).toHaveLength(103)
    expect(split.match(/<ci>x\d+<\/ci>/g)).toHaveLength(150)
    expect(splitWideMath('<math><broken')).toBe('<math><broken')
  })

  it('prefixes ids', () => {
    const { xml, idMap, variableIds } = prefixIdAttributes(DECAY, 'decay_1', ['k'])
    expect(Object.fromEntries(idMap)).toEqual({ c1: 'decay_1', v1: 'decay_1-v1' })
    expect(Object.fromEntries(variableIds)).toEqual({ x: 'decay_1-v1', k: 'decay_1-k' })
    expect(xml).toMatch(/<component name="decay" id="decay_1">/)
    expect(prefixIdAttributes('<a id="x"><b>', 'i').xml).toBe('<a id="x"><b>')
  })

  it('strips celsius', () => {
    const xml = `<model xmlns="${CELLML_NS}" xmlns:cellml="${CELLML_NS}" name="m">
  <units name="celsius"><unit units="kelvin"/></units>
  <component name="c"><variable name="T" units="celsius"/>
    <math xmlns="${MATHML_NS}"><apply><eq/><ci>T</ci><cn cellml:units="celsius">37</cn></apply></math>
  </component>
</model>`
    const stripped = stripCelsiusToArbitraryUnit(xml)
    expect(stripped).not.toMatch(/celsius/)
    expect(stripped).toMatch(/<variable name="T" units="dimensionless"\/>/)
    expect(stripped).toMatch(/cellml:units="dimensionless"/)
  })

  it('extracts components and processes CellML', () => {
    const extracted = extractComponentsFromCellmlString(DECAY)
    expect(extracted.errors ?? []).toEqual([])
    const processed = processCellMLData(DECAY)
    expect(processed.type).toBe('success')
    expect(processed.components.map((component) => component.name)).toContain('decay')
  })

  it('inlines units imports', async () => {
    const model = (name, body) => `<model xmlns="${CELLML_NS}" xmlns:xlink="${XLINK_NS}" name="${name}">${body}</model>`
    const units = model('units', '<units name="fA"><unit prefix="femto" units="ampere"/></units>')
    const cell = model(
      'cell',
      `<import xlink:href="units.cellml"><units name="fA" units_ref="fA"/></import>
       <component name="cell"><variable name="i" units="fA" interface="public"/></component>`
    )
    const result = await inlineUnitsImports(cell, 'cell.cellml', createMapSource([['units.cellml', units]]))
    expect(result.issues).toEqual([])
    expect(result.inlined).toEqual(['fA'])
    expect(result.cellml).not.toMatch(/<import/)
    expect(result.cellml).toMatch(/<units name="fA">/)
  })

  it('reads, adds, carries and strips variable ids', () => {
    expect(listElementIds(DECAY)).toEqual(new Set(['c1', 'v1']))
    const { math, ids } = ensureVariableIds(DECAY, ['x', 'k'])
    expect(ids.get('x')).toBe('v1')
    expect(ids.get('k')).toEqual(expect.any(String))
    expect(variableIdsOf(math).get('k')).toBe(ids.get('k'))
    const bare = stripIds(math)
    expect(listElementIds(bare).size).toBe(0)
    expect(variableIdsOf(carryVariableIds(math, bare)).get('k')).toBe(ids.get('k'))
    expect(applyVariableIds(bare, new Map([['t', 'time']]))).toMatch(/<variable name="t" units="second" interface="public" id="time"\/>/)
  })
})
