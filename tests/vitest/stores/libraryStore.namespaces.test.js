// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  renameNamespaceInLibrary,
  renameNamespaceInNodeData,
  renameNamespaceInParameters,
} from '../../../src/services/library/renameNamespace.js'
import { useDefaultParametersStore } from '../../../src/stores/defaultParametersStore.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { checkResourcesAreLoaded } from '../../../src/utils/import.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

const membraneMath = (rate) => `<model xmlns="http://www.cellml.org/cellml/2.0#" name="PhLynxComponent">
  <component name="membrane">
    <variable name="t" units="second"/>
    <variable name="v" units="volt" initial_value="0"/>
    <variable name="k" units="per_second" initial_value="${rate}"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/>
        <apply><diff/><bvar><ci>t</ci></bvar><ci>v</ci></apply>
        <apply><times/><ci>k</ci><ci>v</ci></apply>
      </apply>
    </math>
  </component>
</model>`

const config = (overrides = {}) => ({
  module_type: 'membrane',
  module_subtype: 'membrane',
  module_format: 'cellml',
  component_file: 'membrane.cellml',
  component_type: 'membrane',
  entrance_ports: [],
  exit_ports: [],
  general_ports: [],
  variables_and_units: [],
  ...overrides,
})

const ENTEROCYTE = 'enterocyte-modules'
const CARDIAC = 'cardiac_ap'
const param = (value) => ({ value, units: 'per_second', data_reference: '', extra: {} })
const paramSet = (ref, k) => ({
  ref,
  source: { file: `${ref}_parameters.json`, importedAt: '' },
  globals: new Map(),
  values: new Map([['k', param(k)]]),
})

describe('library namespaces', () => {
  let store

  beforeAll(() => ensureLibCellmlReady(), 120000)

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
  })

  /** Loads a repository's membrane into a namespace, as a folder import keys it. */
  const loadRepo = (namespace, { rate = 1, configs = [config()] } = {}) => {
    store.addMathFile(`${namespace}/membrane.cellml`, [{ name: 'membrane', math: membraneMath(rate) }])
    return store.addConfigFile(`${namespace}/membrane_config.json`, configs)
  }

  it('keeps same-named files and modules of two namespaces apart', () => {
    expect(loadRepo(ENTEROCYTE, { rate: 1 })).toBe(1)
    expect(loadRepo(CARDIAC, { rate: 2 })).toBe(1)

    expect(store.availableModules.get(`membrane:membrane:${ENTEROCYTE}`).mathRef).toBe(`${ENTEROCYTE}/membrane.cellml:membrane`)
    expect(store.availableModules.get(`membrane:membrane:${CARDIAC}`).mathRef).toBe(`${CARDIAC}/membrane.cellml:membrane`)
    expect(store.getMathDefaults(`${CARDIAC}/membrane.cellml:membrane`).get('k')).toBe('2')
    expect(store.getMathDefaults(`${ENTEROCYTE}/membrane.cellml:membrane`).get('k')).toBe('1')
    expect([...store.loadedNamespaces()].sort()).toEqual([CARDIAC, ENTEROCYTE])
  })

  it('gives modules made from math the namespace of their file', () => {
    loadRepo(ENTEROCYTE)
    expect(store.availableModules.get(`membrane:default:${ENTEROCYTE}`).mathRef).toBe(`${ENTEROCYTE}/membrane.cellml:membrane`)
  })

  it('keeps loose files and built-in configs out of any namespace', () => {
    store.addMathFile('membrane.cellml', [{ name: 'membrane', math: membraneMath(1) }])
    store.addConfigFile('membrane_config.json', [config()])

    expect(store.availableModules.get('membrane:membrane').mathRef).toBe('membrane.cellml:membrane')
    expect(store.availableModules.has('membrane:default')).toBe(true)
  })

  it('loads a loose config into the namespace it is given, on the math there', () => {
    store.addMathFile(`${CARDIAC}/membrane.cellml`, [{ name: 'membrane', math: membraneMath(1) }])
    expect(store.addConfigFile('membrane_config.json', [config()], { namespace: CARDIAC })).toBe(1)

    const module = store.availableModules.get(`membrane:membrane:${CARDIAC}`)
    expect(module.mathRef).toBe(`${CARDIAC}/membrane.cellml:membrane`)
    expect(module.isStub).toBeUndefined()
  })

  it('finds the namespaces holding the files configs name', () => {
    loadRepo(ENTEROCYTE)
    loadRepo(CARDIAC)
    store.addMathFile('heart.cellml', [{ name: 'heart', math: membraneMath(1).replace('"membrane"', '"heart"') }])

    expect([...store.namespacesWithFiles(['membrane.cellml'])].sort()).toEqual([CARDIAC, ENTEROCYTE])
    expect([...store.namespacesWithFiles(['heart.cellml'])]).toEqual([''])
    expect([...store.namespacesWithFiles(['lung.cellml'])]).toEqual([])
  })

  it('reports math and configs that would change what is loaded, and nothing for the same content', () => {
    loadRepo(ENTEROCYTE, { rate: 1 })

    const same = store.findClashes({
      mathFiles: [{ key: `${ENTEROCYTE}/membrane.cellml`, components: [{ name: 'membrane', math: membraneMath(1) }] }],
      configFiles: [{ key: `${ENTEROCYTE}/membrane_config.json`, configs: [config()] }],
    })
    expect(same).toEqual([])

    const changed = store.findClashes({
      mathFiles: [{ key: `${ENTEROCYTE}/membrane.cellml`, components: [{ name: 'membrane', math: membraneMath(5) }] }],
      configFiles: [
        { key: 'loose_config.json', namespace: ENTEROCYTE, configs: [config({ general_ports: [{ port_type: 'v', variables: ['v'] }] })] },
      ],
    })
    expect(changed.map(({ kind, key }) => ({ kind, key }))).toEqual([
      { kind: 'math', key: `${ENTEROCYTE}/membrane.cellml:membrane` },
      { kind: 'module', key: `membrane:membrane:${ENTEROCYTE}` },
    ])
    expect(changed[0].existing.defaults.get('k')).toBe('1')
    expect(changed[0].incoming.defaults.get('k')).toBe('5')

    // Another namespace's file of the same name is not a clash.
    expect(
      store.findClashes({
        mathFiles: [{ key: `${CARDIAC}/membrane.cellml`, components: [{ name: 'membrane', math: membraneMath(5) }] }],
      })
    ).toEqual([])
  })

  describe('instance array rows', () => {
    const rows = [{ name: 'mem', module_type: 'membrane', module_subtype: 'membrane' }]

    it('find the only namespace that defines a module', () => {
      loadRepo(CARDIAC)
      expect(checkResourcesAreLoaded(rows, store).resourcesAreLoaded).toBe(true)
    })

    it('report a module several namespaces define, unless the array targets one of them', () => {
      loadRepo(ENTEROCYTE)
      loadRepo(CARDIAC)

      const status = checkResourcesAreLoaded(rows, store)
      expect(status.resourcesAreLoaded).toBe(false)
      expect([...status.missingResources.ambiguous]).toEqual([['membrane:membrane', [CARDIAC, ENTEROCYTE]]])

      expect(checkResourcesAreLoaded(rows, store, { preferredNamespace: CARDIAC }).resourcesAreLoaded).toBe(true)
    })

    it('prefer a module in no namespace over namespaced ones', () => {
      loadRepo(ENTEROCYTE)
      store.addMathFile('membrane.cellml', [{ name: 'membrane', math: membraneMath(1) }])
      store.addConfigFile('membrane_config.json', [config()])

      expect(checkResourcesAreLoaded(rows, store).resourcesAreLoaded).toBe(true)
    })
  })

  describe('parameter sets', () => {
    const defaulting = config({ default_parameterisation: 'resting' })

    it('go only to the modules of the namespace they target', () => {
      loadRepo(ENTEROCYTE, { configs: [defaulting] })
      loadRepo(CARDIAC, { configs: [defaulting] })
      const parameters = useDefaultParametersStore()
      expect([...parameters.namespacesDefaulting('resting')].sort()).toEqual([CARDIAC, ENTEROCYTE])

      const placed = parameters.addSet(paramSet('resting', '3'), { namespace: CARDIAC })
      expect(placed.map(({ mathRef }) => mathRef)).toEqual([`${CARDIAC}/membrane.cellml:membrane`])
      expect(parameters.getSet(`${ENTEROCYTE}/membrane.cellml:membrane`, 'resting')).toBeNull()
    })

    it('wait for configs in the namespace they target, when loaded first', () => {
      const parameters = useDefaultParametersStore()
      parameters.addSet(paramSet('resting', '3'), { namespace: CARDIAC })
      loadRepo(ENTEROCYTE, { configs: [defaulting] })
      expect(parameters.getSet(`${ENTEROCYTE}/membrane.cellml:membrane`, 'resting')).toBeNull()

      loadRepo(CARDIAC, { configs: [defaulting] })
      expect(parameters.getSet(`${CARDIAC}/membrane.cellml:membrane`, 'resting').values.get('k').value).toBe('3')
    })
  })

  describe('renaming a namespace', () => {
    it('moves its math, modules, units and parameter sets, leaving other namespaces alone', () => {
      loadRepo(ENTEROCYTE, { configs: [config({ default_parameterisation: 'resting' })] })
      loadRepo('CellML')
      store.addUnitsFile({ componentFile: 'CellML/units.cellml', model: '<model/>' })
      const parameters = useDefaultParametersStore()
      parameters.addSet(paramSet('resting', '3'), { namespace: ENTEROCYTE })
      parameters.addSet(paramSet('later', '4'), { namespace: 'CellML' })

      store.loadState(renameNamespaceInLibrary(store.getState(), 'CellML', CARDIAC))
      parameters.loadState(renameNamespaceInParameters(parameters.getState(), 'CellML', CARDIAC))

      expect([...store.loadedNamespaces()].sort()).toEqual([CARDIAC, ENTEROCYTE])
      expect(store.availableModules.get(`membrane:membrane:${CARDIAC}`).mathRef).toBe(`${CARDIAC}/membrane.cellml:membrane`)
      expect(store.availableMath.has(`${CARDIAC}/membrane.cellml:membrane`)).toBe(true)
      expect(store.availableUnits.map((units) => units.componentFile)).toContain(`${CARDIAC}/units.cellml`)
      expect(store.availableModules.get(`membrane:membrane:${ENTEROCYTE}`).mathRef).toBe(`${ENTEROCYTE}/membrane.cellml:membrane`)
      expect(parameters.getSet(`${ENTEROCYTE}/membrane.cellml:membrane`, 'resting')).not.toBeNull()
      expect(parameters.getState().unlinked).toEqual([['later', expect.objectContaining({ namespace: CARDIAC })]])
    })

    it("moves an instance's math and module, and leaves one using another namespace alone", () => {
      const data = { name: 'mem', mathRef: 'CellML/membrane.cellml:membrane', moduleRef: 'membrane:membrane:CellML' }
      expect(renameNamespaceInNodeData(data, 'CellML', CARDIAC)).toEqual({
        name: 'mem',
        mathRef: `${CARDIAC}/membrane.cellml:membrane`,
        moduleRef: `membrane:membrane:${CARDIAC}`,
      })
      expect(renameNamespaceInNodeData({ mathRef: 'membrane.cellml:membrane', moduleRef: 'membrane:membrane' }, 'CellML', CARDIAC)).toBeNull()
    })
  })
})
