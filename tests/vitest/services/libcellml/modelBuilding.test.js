// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { reactive } from 'vue'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildModularModel } from '../../../../src/services/export/modularCellml.js'
import { libraryFromSnapshot, snapshotLibrary, toPlain } from '../../../../src/services/libcellml/librarySnapshot.js'
import { buildModularModelInBackground, generateFlattenedModelInBackground } from '../../../../src/services/libcellml/modelBuilding.js'
import { handleRequest } from '../../../../src/services/libcellml/protocol.js'
import { analyzeMathXml } from '../../../../src/services/math/analyzeMath.js'
import { reconcileRows } from '../../../../src/services/math/reconcileRows.js'
import { useLibraryStore } from '../../../../src/stores/libraryStore.js'
import { generateFlattenedModel, getLibCellML } from '../../../../src/utils/cellml.js'
import { CELLML_NS, MATHML_NS } from '../../../../src/utils/constants.js'
import { ensureLibCellmlReady } from '../../helpers/libcellml-bootstrap.js'
import { toyWorkspace } from '../export/toyWorkspace.js'

// The toy maths leave their parameters unset, so the analyser's check would fail.
const UNCHECKED = { check: false }
const DECAY_REF = 'decay.cellml:decay'
// dx/dt = g - k * x, with g a global constant.
const DECAY = `<model xmlns="${CELLML_NS}" name="decay">
  <component name="decay">
    <variable name="t" units="second" interface="public"/>
    <variable name="x" units="dimensionless" initial_value="x_init" interface="public"/>
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

/** Answers like workers/libcellmlWorker.js with the real operations, cloning messages as postMessage does. */
class CloningWorker {
  static messages = []
  postMessage(message) {
    CloningWorker.messages.push(message)
    const request = structuredClone(message)
    queueMicrotask(async () => this.onmessage({ data: structuredClone(await handleRequest(request, async () => getLibCellML())) }))
  }
  terminate() {}
}

beforeAll(() => ensureLibCellmlReady(), 120000)

let store
let nodes

beforeEach(async () => {
  setActivePinia(createPinia())
  store = useLibraryStore()
  ;({ nodes } = toyWorkspace(store))
  store.addUnitsFile({ componentFile: 'decay_units.cellml', model: `<model xmlns="${CELLML_NS}" name="decay_units"><units name="per_second"><unit units="second" exponent="-1"/></units></model>` })
  store.addMathFile('decay.cellml', [{ name: 'decay', math: DECAY }])
  store.assignGlobalConstant('g', '0.1', 'per_second')
  const variables = reconcileRows(analyzeMathXml(store.availableMath.get(DECAY_REF)), [{ name: 'g', type: 'global_constant' }], {
    defaults: store.getMathDefaults(DECAY_REF),
  })
  nodes.push({ id: 'd', type: 'instanceNode', position: { x: 0, y: 0 }, data: { name: 'decay_1', mathRef: DECAY_REF, variables, ports: [] } })
  // Sidecars parse in the background; the build prefixes the ids of the variables they annotate.
  await Promise.all([...new Set(nodes.map((node) => node.data.mathRef))].map((mathRef) => store.ensureModuleAnnotations(mathRef)))
  nodes = reactive(nodes)
})

describe('snapshotLibrary', () => {
  it('copies just what the nodes use, as data postMessage can clone', () => {
    const snapshot = snapshotLibrary(store, nodes)
    expect(() => structuredClone(snapshot)).not.toThrow()
    expect([...snapshot.math.keys()].sort()).toEqual([DECAY_REF, 'pool.cellml:pool', 'porter.cellml:porter', 'wall.cellml:wall'])
    expect([...snapshot.globalConstants]).toEqual([['g', { value: '0.1', units: 'per_second', data_reference: undefined }]])
    expect(snapshot.units).toHaveLength(2)
    expect(snapshot.annotatedVariables.get('pool.cellml:pool')?.length).toBeGreaterThan(0)
    expect(() => structuredClone(toPlain(nodes))).not.toThrow()
  })

  it('leaves out what the library lacks', () => {
    const { getMathSource, getParsedModuleAnnotations, ...rest } = libraryFromSnapshot(snapshotLibrary(store, nodes))
    expect(getMathSource).toBeTypeOf('function')
    expect(getParsedModuleAnnotations).toBeTypeOf('function')
    const bare = libraryFromSnapshot(snapshotLibrary({ ...rest, getMathSource: undefined }, nodes))
    expect(bare.getMathSource).toBeUndefined()
    expect(bare.getParsedModuleAnnotations).toBeUndefined()
  })
})

describe('a library rebuilt from its snapshot', () => {
  it('flattens the model as the store does', async () => {
    const fromStore = { check: false, exportedIds: new Map(), instanceSources: new Map() }
    const fromSnapshot = { check: false, exportedIds: new Map(), instanceSources: new Map() }
    const library = libraryFromSnapshot(structuredClone(snapshotLibrary(store, nodes)))
    const expected = await generateFlattenedModel(nodes, [], store, [], fromStore).text()
    expect(await generateFlattenedModel(toPlain(nodes), [], library, [], fromSnapshot).text()).toBe(expected)
    expect(fromSnapshot).toEqual(fromStore)
    expect([...fromStore.exportedIds.get('n0').variableIds.keys()].length).toBeGreaterThan(0)
  })

  it('builds the modular model as the store does', async () => {
    const library = libraryFromSnapshot(structuredClone(snapshotLibrary(store, nodes)))
    expect(await buildModularModel(toPlain(nodes), [], library, [], UNCHECKED)).toEqual(await buildModularModel(nodes, [], store, [], UNCHECKED))
  })
})

describe('in the background', () => {
  beforeEach(() => {
    CloningWorker.messages = []
    vi.stubGlobal('Worker', CloningWorker)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('flattens the model and fills the caller’s maps', async () => {
    const options = { check: false, exportedIds: new Map(), instanceSources: new Map() }
    const expected = { check: false, exportedIds: new Map(), instanceSources: new Map() }
    const text = await generateFlattenedModelInBackground(nodes, [], store, [], options)
    expect(CloningWorker.messages.at(-1).op).toBe('flattenModel')
    expect(text).toBe(await generateFlattenedModel(nodes, [], store, [], expected).text())
    expect(options).toEqual(expected)
  })

  it('builds the modular model', async () => {
    const exportedIds = new Map()
    const modular = await buildModularModelInBackground(nodes, [], store, [], { ...UNCHECKED, exportedIds, mainFileName: 'm/model.cellml' })
    expect(CloningWorker.messages.at(-1).op).toBe('buildModularModel')
    expect(modular).toEqual(await buildModularModel(nodes, [], store, [], { ...UNCHECKED, mainFileName: 'm/model.cellml' }))
    expect(exportedIds.size).toBe(nodes.length)
  })

  it('rejects as the build throws', async () => {
    store.assignGlobalConstant('g', '', 'per_second', undefined, true)
    await expect(generateFlattenedModelInBackground(nodes, [], store)).rejects.toThrow(/Missing parameter values: decay_1\.g/)
  })
})
