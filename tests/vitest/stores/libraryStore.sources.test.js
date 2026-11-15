// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

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
const CARDIAC = 'bond_graph_cardiac_AP'

describe('library sources', () => {
  let store

  beforeAll(() => ensureLibCellmlReady(), 120000)

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
  })

  /** Loads a repository's membrane: math under math/, config under configurations/. */
  const loadRepo = (repo, { rate = 1, mathDir = 'math' } = {}) => {
    store.addMathFile(`${repo}/${mathDir}/membrane.cellml`, [{ name: 'membrane', math: membraneMath(rate) }])
    return store.addConfigFile(`${repo}/configurations/membrane_config.json`, [config()])
  }

  it('keeps same-named files and modules from two sources apart', () => {
    expect(loadRepo(ENTEROCYTE, { rate: 1 })).toBe(1)
    expect(loadRepo(CARDIAC, { rate: 2 })).toBe(1)

    expect(store.availableModules.get(`membrane:membrane:${ENTEROCYTE}`).mathRef).toBe(
      `${ENTEROCYTE}/math/membrane.cellml:membrane`
    )
    expect(store.availableModules.get(`membrane:membrane:${CARDIAC}`).mathRef).toBe(
      `${CARDIAC}/math/membrane.cellml:membrane`
    )
    expect(store.getMathDefaults(`${CARDIAC}/math/membrane.cellml:membrane`).get('k')).toBe('2')
    expect(store.getMathDefaults(`${ENTEROCYTE}/math/membrane.cellml:membrane`).get('k')).toBe('1')
    expect([...store.loadedSources()].sort()).toEqual([CARDIAC, ENTEROCYTE])
  })

  it('gives modules made from math the source of their file', () => {
    loadRepo(ENTEROCYTE)
    loadRepo(CARDIAC)

    expect(store.availableModules.get(`membrane:default:${ENTEROCYTE}`).mathRef).toBe(
      `${ENTEROCYTE}/math/membrane.cellml:membrane`
    )
    expect(store.availableModules.has(`membrane:default:${CARDIAC}`)).toBe(true)
  })

  it('keeps loose files and built-in configs unqualified', () => {
    store.addMathFile('membrane.cellml', [{ name: 'membrane', math: membraneMath(1) }])
    store.addConfigFile('membrane_config.json', [config()])

    expect(store.availableModules.get('membrane:membrane').mathRef).toBe('membrane.cellml:membrane')
    expect(store.availableModules.has('membrane:default')).toBe(true)
  })

  it('links a config loaded before its math to the file when it arrives somewhere unexpected', () => {
    store.addConfigFile(`${CARDIAC}/configurations/membrane_config.json`, [config()])
    const ref = `membrane:membrane:${CARDIAC}`
    expect(store.availableModules.get(ref)).toMatchObject({ mathRef: `${CARDIAC}/math/membrane.cellml:membrane`, isStub: true })

    loadRepo(CARDIAC, { mathDir: 'CellML/math' })

    expect(store.availableModules.get(ref).mathRef).toBe(`${CARDIAC}/CellML/math/membrane.cellml:membrane`)
    expect(store.availableModules.get(ref).isStub).toBeUndefined()
  })

  it('reports math and configs that would change what is loaded, and nothing for the same content', () => {
    loadRepo(ENTEROCYTE, { rate: 1 })

    const same = store.findClashes({
      mathFiles: [{ key: `${ENTEROCYTE}/math/membrane.cellml`, components: [{ name: 'membrane', math: membraneMath(1) }] }],
      configFiles: [{ key: `${ENTEROCYTE}/configurations/membrane_config.json`, configs: [config()] }],
    })
    expect(same).toEqual([])

    const changed = store.findClashes({
      mathFiles: [{ key: `${ENTEROCYTE}/math/membrane.cellml`, components: [{ name: 'membrane', math: membraneMath(5) }] }],
      configFiles: [
        {
          key: `${ENTEROCYTE}/configurations/membrane_config.json`,
          configs: [config({ general_ports: [{ port_type: 'v', variables: ['v'] }] })],
        },
      ],
    })
    expect(changed.map(({ kind, key }) => ({ kind, key }))).toEqual([
      { kind: 'math', key: `${ENTEROCYTE}/math/membrane.cellml:membrane` },
      { kind: 'module', key: `membrane:membrane:${ENTEROCYTE}` },
    ])
    expect(changed[0].existing.defaults.get('k')).toBe('1')
    expect(changed[0].incoming.defaults.get('k')).toBe('5')

    // Another source's file of the same name is not a clash.
    expect(
      store.findClashes({
        mathFiles: [{ key: `${CARDIAC}/math/membrane.cellml`, components: [{ name: 'membrane', math: membraneMath(5) }] }],
      })
    ).toEqual([])
  })

  describe('instance array rows', () => {
    const rows = [{ name: 'mem', module_type: 'membrane', module_subtype: 'membrane' }]

    it('find the only source that defines a module', () => {
      loadRepo(CARDIAC)
      const status = checkResourcesAreLoaded(rows, store)
      expect(status.resourcesAreLoaded).toBe(true)
    })

    it('report a module several sources define, unless the array’s own source is one of them', () => {
      loadRepo(ENTEROCYTE)
      loadRepo(CARDIAC)

      const status = checkResourcesAreLoaded(rows, store)
      expect(status.resourcesAreLoaded).toBe(false)
      expect([...status.missingResources.ambiguous]).toEqual([['membrane:membrane', [CARDIAC, ENTEROCYTE]]])

      expect(checkResourcesAreLoaded(rows, store, { preferredSource: CARDIAC }).resourcesAreLoaded).toBe(true)
    })

    it('prefer a module without a source over sourced ones', () => {
      loadRepo(ENTEROCYTE)
      store.addMathFile('membrane.cellml', [{ name: 'membrane', math: membraneMath(1) }])
      store.addConfigFile('membrane_config.json', [config()])

      expect(checkResourcesAreLoaded(rows, store).resourcesAreLoaded).toBe(true)
    })
  })
})
