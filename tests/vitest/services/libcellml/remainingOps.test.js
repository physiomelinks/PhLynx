// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  extractComponentsFromCellmlStringInBackground,
  flattenImportedUnitsInBackground,
  hoistEncapsulatedComponentsInBackground,
  isCellMLInBackground,
  liveComponentMathInBackground,
  processCellMLDataInBackground,
} from '../../../../src/services/libcellml/cellmlImport.js'
import {
  areModelsEquivalentInBackground,
  combineComponentModelsInBackground,
  extractVoiAndParametersFromModelInBackground,
  getModelComponentNamesInBackground,
  loadParametersFromCellMLInBackground,
  prepareSavedMathInBackground,
} from '../../../../src/services/libcellml/modelQueries.js'
import {
  addProtocolClockInBackground,
  addProtocolDriversInBackground,
  buildVariableMappingInBackground,
} from '../../../../src/services/libcellml/simulationModel.js'
import { handleRequest } from '../../../../src/services/libcellml/protocol.js'
import { inlineUnitsImports, createMapSource } from '../../../../src/services/import/cellmlImports.js'
import { migrateWorkspaceInBackground } from '../../../../src/services/workspaceMigrator.js'
import { addProtocolClock, addProtocolDrivers } from '../../../../src/services/simulation/protocolDriverModel.js'
import { buildVariableMapping } from '../../../../src/services/simulation/variableMapping.js'
import { liveComponentMath } from '../../../../src/services/celldl/liveMath.js'
import { prepareSavedMath } from '../../../../src/services/math/variableIds.js'
import {
  areModelsEquivalent,
  combineComponentModels,
  extractComponentsFromCellmlString,
  extractVoiAndParametersFromModel,
  getLibCellML,
  getModelComponentNames,
  hoistEncapsulatedComponents,
  isCellML,
  loadParametersFromCellML,
  processCellMLData,
} from '../../../../src/utils/cellml.js'
import { CELLML_NS, MATHML_NS } from '../../../../src/utils/constants.js'
import { ensureLibCellmlReady } from '../../helpers/libcellml-bootstrap.js'

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

const lastOp = () => CloningWorker.messages.at(-1).op

// dx/dt = -k * x, with k from instance_parameters, as a flattened model has it.
const FLAT = `<model xmlns="${CELLML_NS}" name="flat">
  <units name="per_second"><unit units="second" exponent="-1"/></units>
  <component name="environment"><variable name="time" units="second" interface="public"/></component>
  <component name="instance_parameters"><variable name="k" units="per_second" initial_value="0.5" interface="public"/></component>
  <component name="decay">
    <variable name="t" units="second" interface="public"/>
    <variable name="x" units="dimensionless" initial_value="2" interface="public"/>
    <variable name="k" units="per_second" interface="public"/>
    <math xmlns="${MATHML_NS}"><apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply><apply><minus/><apply><times/><ci>k</ci><ci>x</ci></apply></apply></apply></math>
  </component>
  <connection component_1="environment" component_2="decay"><map_variables variable_1="time" variable_2="t"/></connection>
  <connection component_1="instance_parameters" component_2="decay"><map_variables variable_1="k" variable_2="k"/></connection>
</model>`

const ONE = (name, value = '1') =>
  `<model xmlns="${CELLML_NS}" name="m"><component name="${name}"><variable name="a" units="dimensionless" initial_value="${value}"/></component></model>`

const ENCAPSULATED = `<model xmlns="${CELLML_NS}" name="enc">
  <component name="parent"><variable name="a" units="dimensionless" initial_value="1"/></component>
  <component name="child"><variable name="b" units="dimensionless" initial_value="2"/></component>
  <encapsulation><component_ref component="parent"><component_ref component="child"/></component_ref></encapsulation>
</model>`

beforeAll(() => ensureLibCellmlReady(), 120000)

beforeEach(() => {
  CloningWorker.messages = []
  vi.stubGlobal('Worker', CloningWorker)
})

afterEach(() => vi.unstubAllGlobals())

describe('imports in the background', () => {
  it('reads CellML as on the main thread, hoisting when asked', async () => {
    expect(await processCellMLDataInBackground(FLAT)).toEqual(processCellMLData(FLAT))
    expect(lastOp()).toBe('processCellMLData')
    expect(await processCellMLDataInBackground(ENCAPSULATED, { hoist: true })).toEqual(
      processCellMLData(hoistEncapsulatedComponents(ENCAPSULATED).cellml)
    )
    expect(await hoistEncapsulatedComponentsInBackground(ENCAPSULATED)).toEqual(hoistEncapsulatedComponents(ENCAPSULATED))
  })

  it('checks and splits CellML', async () => {
    expect(await isCellMLInBackground(FLAT)).toBe(isCellML(FLAT))
    expect(await isCellMLInBackground('<svg/>')).toBe(false)
    expect(await extractComponentsFromCellmlStringInBackground(FLAT)).toEqual(extractComponentsFromCellmlString(FLAT))
    expect(await liveComponentMathInBackground(FLAT, 'decay')).toBe(liveComponentMath(FLAT, 'decay'))
  })

  it('inlines imported units through the worker', async () => {
    const units = `<model xmlns="${CELLML_NS}" name="u"><units name="per_second"><unit units="second" exponent="-1"/></units></model>`
    const importing = `<model xmlns="${CELLML_NS}" xmlns:xlink="http://www.w3.org/1999/xlink" name="i"><import xlink:href="u.cellml"><units name="per_second" units_ref="per_second"/></import></model>`
    const result = await inlineUnitsImports(importing, 'i.cellml', createMapSource([['u.cellml', units]]))
    expect(CloningWorker.messages.map(({ op }) => op)).toContain('flattenImportedUnits')
    expect(result.inlined).toEqual(['per_second'])
    expect(result.issues).toEqual([])
    expect(await flattenImportedUnitsInBackground('<not-cellml', new Map())).toHaveProperty('error')
  })

  it('splits a legacy workspace’s CellML in the worker before migrating it', async () => {
    const legacy = { flow: { nodes: [], edges: [] }, store: { availableModules: [{ filename: 'm.cellml', model: ONE('c'), modules: [] }], availableUnits: [] } }
    const migrated = await migrateWorkspaceInBackground(legacy)
    expect(lastOp()).toBe('extractComponentsFromCellmlString')
    expect(JSON.stringify(migrated.store.availableMath)).toContain('m.cellml:c')
  })
})

describe('model queries in the background', () => {
  it('answer as on the main thread', async () => {
    expect(await areModelsEquivalentInBackground(ONE('c'), ONE('c'))).toBe(true)
    expect(await areModelsEquivalentInBackground(ONE('c'), ONE('c', '2'))).toBe(areModelsEquivalent(ONE('c'), ONE('c', '2')))
    expect(await combineComponentModelsInBackground('modules', [ONE('a'), ONE('b')], [undefined, 'renamed'])).toBe(
      combineComponentModels('modules', [ONE('a'), ONE('b')], [undefined, 'renamed'])
    )
    expect(await getModelComponentNamesInBackground(FLAT)).toEqual(getModelComponentNames(FLAT))
    expect(await loadParametersFromCellMLInBackground(FLAT)).toEqual(loadParametersFromCellML(FLAT))
    const scan = { selections: [{ nodeName: 'decay', parameterName: 'k', type: 'constant' }] }
    expect(await extractVoiAndParametersFromModelInBackground(FLAT, scan)).toEqual(extractVoiAndParametersFromModel(FLAT, scan))
  })

  it('give saved math its variable ids', async () => {
    const options = { storedMath: ONE('c'), editedMath: ONE('c'), isMathChanged: false, renames: new Map(), idsFor: ['a'] }
    const saved = await prepareSavedMathInBackground(options)
    expect(lastOp()).toBe('prepareSavedMath')
    expect(saved).toEqual(prepareSavedMath(options))
    expect(saved.ids.get('a')).toBeTruthy()
  })
})

describe('simulation models in the background', () => {
  it('add a protocol’s drivers and clock', async () => {
    const drivers = [{ parameter: 'instance_parameters/k', name: 'driver_1', traces: [{ t: new Float64Array([0, 1]), values: [1, 2] }], selectors: [[1]] }]
    expect(await addProtocolDriversInBackground({ cellml: FLAT, drivers })).toEqual(addProtocolDrivers({ libcellml: getLibCellML(), cellml: FLAT, drivers }))
    expect(await addProtocolClockInBackground({ cellml: FLAT })).toEqual(addProtocolClock({ libcellml: getLibCellML(), cellml: FLAT }))
  })

  it('map results by their names alone', async () => {
    const nodes = [{ id: 'd', data: { name: 'decay', variables: [{ name: 'x', value: '2' }, { name: 'k' }], extra: () => {} } }]
    const results = { voi: { name: 'environment/time', values: new Float64Array(3) }, variables: new Map([['decay/x', {}], ['instance_parameters/k', {}]]) }
    const mapping = await buildVariableMappingInBackground({ cellml: FLAT, nodes, results })
    expect(mapping).toEqual(buildVariableMapping({ libcellml: getLibCellML(), cellml: FLAT, nodes, results }))
    expect([...mapping]).toEqual([
      ['d::x', 'decay/x'],
      ['d::k', 'instance_parameters/k'],
    ])
    // Only names cross: the values stay on the main thread.
    expect(CloningWorker.messages.at(-1).args[2]).toEqual(['environment/time', 'decay/x', 'instance_parameters/k'])
  })
})
