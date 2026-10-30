// @vitest-environment happy-dom
import { reactive, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { useInstanceSave } from '../../../src/composables/useInstanceSave.js'
import { useNodeDataHistory } from '../../../src/composables/useNodeDataHistory.js'
import { useFlowHistoryStore } from '../../../src/stores/historyStore.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { useSimulationSettingsStore } from '../../../src/stores/simulationSettingsStore.js'
import { NEW_MODULE_FILENAME, NEW_MODULE_REF } from '../../../src/utils/constants.js'
import { previewCouplings } from '../../../src/utils/edges.js'
import { detachReactivity } from '../../../src/utils/reactivity.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

const nodes = ref([])
const edges = ref([])

vi.mock('@vue-flow/core', async (importOriginal) => ({
  ...(await importOriginal()),
  // Writes data the way vue-flow does: a new data object on the same node.
  useVueFlow: () => ({
    nodes,
    edges,
    findNode: (id) => nodes.value.find((node) => node.id === id),
    findEdge: (id) => edges.value.find((edge) => edge.id === id),
    updateNodeData: (id, patch) => {
      const node = nodes.value.find((candidate) => candidate.id === id)
      if (node) node.data = { ...node.data, ...patch }
    },
  }),
}))

const DECAY_REF = 'file:decay'
const GROWTH_REF = 'file:growth'
const DECAY_XML = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="decay">
  <component name="decay">
    <variable name="t" units="second" interface="public_and_private"/>
    <variable name="x" units="metre" initial_value="x0"/>
    <variable name="x0" units="metre" initial_value="1"/>
    <variable name="k" units="per_second" initial_value="0.5"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/>
        <apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply>
        <apply><times/><apply><minus/><ci>k</ci></apply><ci>x</ci></apply>
      </apply>
    </math>
  </component>
</model>`
const DECAY_WITHOUT_K = DECAY_XML.replace('<apply><minus/><ci>k</ci></apply>', '<apply><minus/><cn>1</cn></apply>')
const GROWTH_XML = DECAY_XML.replaceAll('decay', 'growth').replace('<apply><minus/><ci>k</ci></apply>', '<ci>k</ci>')

/**
 * Creates a node on the decay math, from the template module, with port `p` carrying `x` and `k`.
 *
 * @param {string} id
 * @returns {Object}
 */
function createNode(id) {
  return reactive({
    id,
    data: {
      name: id,
      mathRef: DECAY_REF,
      moduleRef: NEW_MODULE_REF,
      variables: [
        { name: 'x', units: 'metre', type: 'variable' },
        { name: 'k', value: '0.5', units: 'per_second', type: 'constant' },
      ],
      ports: [{ label: 'p', portType: 'general_ports', variables: ['x', 'k'] }],
    },
  })
}

const findNode = (id) => nodes.value.find((node) => node.id === id)
const snapshot = () => detachReactivity({ nodes: nodes.value.map(({ id, data }) => ({ id, data })), edges: edges.value })

/**
 * Builds an instance editor save for node `a`.
 *
 * @param {Object} [overrides]
 * @returns {Object}
 */
function buildSave(overrides = {}) {
  return {
    id: 'a',
    name: 'a2',
    mathRef: DECAY_REF,
    previousMathRef: DECAY_REF,
    math: null,
    layout: null,
    isLayoutChanged: false,
    globalConstants: [],
    variables: findNode('a').data.variables,
    ports: findNode('a').data.ports,
    updateAll: false,
    siblings: [],
    ...overrides,
  }
}

const fork = () =>
  buildSave({
    mathRef: GROWTH_REF,
    math: GROWTH_XML,
    globalConstants: [{ name: 'g', value: '2', units: 'second', data_reference: null }],
    variables: [...findNode('a').data.variables, { name: 'g', units: 'second', type: 'global_constant' }],
    updateAll: true,
    siblings: ['b'],
  })

describe('useInstanceSave', () => {
  let history, library, saveInstanceEdit, findDroppedCouplings

  beforeAll(async () => {
    await ensureLibCellmlReady()
  })

  beforeEach(() => {
    setActivePinia(createPinia())
    history = useFlowHistoryStore()
    library = useLibraryStore()
    library.addMath(DECAY_REF, DECAY_XML)
    nodes.value = [createNode('a'), createNode('b')]
    edges.value = [{ id: 'e', source: 'a', target: 'b', data: { couplings: [] } }]
    ;({ saveInstanceEdit, findDroppedCouplings } = useInstanceSave())
  })

  it('undoes a fork applied to every instance as one step, and redoes it exactly', async () => {
    const before = snapshot()
    expect(await saveInstanceEdit(fork())).toBe(2)
    const after = snapshot()
    expect(findNode('b').data.mathRef).toBe(GROWTH_REF)
    expect(library.availableMath.has(GROWTH_REF)).toBe(true)
    expect(library.getGlobalConstant('g')).toBeDefined()
    expect(edges.value[0].data.couplings).not.toEqual([])

    await history.undo()
    expect(snapshot()).toEqual(before)
    expect(library.availableMath.has(GROWTH_REF)).toBe(false)
    expect(library.getGlobalConstant('g')).toBeUndefined()
    expect(history.canUndo).toBe(false)

    await history.redo()
    expect(snapshot()).toEqual(after)
    expect(library.availableMath.has(GROWTH_REF)).toBe(true)
    expect(library.getGlobalConstant('g')).toMatchObject({ value: '2' })
  })

  it('undoes an overwrite in place, including the unticked instances it rebuilt', async () => {
    const before = snapshot()
    const mathBefore = library.getMathEntry(DECAY_REF)
    await saveInstanceEdit(buildSave({ math: DECAY_WITHOUT_K }))
    expect(findNode('b').data.variables).not.toEqual(before.nodes[1].data.variables)

    await history.undo()
    expect(snapshot()).toEqual(before)
    expect(library.getMathEntry(DECAY_REF)).toEqual(mathBefore)
  })

  it('undoes a layout-only save back to no layout', async () => {
    const layout = { format: 'cellml-text', components: [] }
    await saveInstanceEdit(buildSave({ layout, isLayoutChanged: true }))
    expect(library.getMathLayout(DECAY_REF)).toEqual(layout)

    await history.undo()
    expect(library.getMathLayout(DECAY_REF)).toBeNull()
  })

  it('undoes a save after a later rename, one step at a time', async () => {
    await saveInstanceEdit(fork())
    const { recordEdit } = useNodeDataHistory()
    await recordEdit({ type: 'rename-node', nodeIds: ['a'], keys: ['name'], apply: () => (findNode('a').data = { ...findNode('a').data, name: 'later' }) })

    await history.undo()
    expect(findNode('a').data.name).toBe('a2')
    await history.undo()
    expect(findNode('a').data).toMatchObject({ name: 'a', mathRef: DECAY_REF })
  })

  it('keeps forked math and constants that another instance now uses', async () => {
    await saveInstanceEdit(fork())
    const other = createNode('c')
    other.data = { ...other.data, mathRef: GROWTH_REF, variables: [{ name: 'g', units: 'second', type: 'global_constant' }] }
    nodes.value = [...nodes.value, other]

    await history.undo()
    expect(findNode('a').data.mathRef).toBe(DECAY_REF)
    expect(library.availableMath.has(GROWTH_REF)).toBe(true)
    expect(library.getGlobalConstant('g')).toBeDefined()
  })

  it('couples the edited ports as the instance editor previews them', async () => {
    const ports = [{ label: 'p', portType: 'general_ports', variables: ['x'] }]
    edges.value = [
      { id: 'e', source: 'a', target: 'b', data: { couplings: [] } },
      { id: 'f', source: 'b', target: 'a', data: { couplings: [] } },
    ]
    const preview = new Map(detachReactivity([...previewCouplings('a', ports, nodes.value, edges.value)]))

    await saveInstanceEdit(buildSave({ ports }))
    expect(detachReactivity(edges.value.map((edge) => edge.data.couplings))).toEqual([preview.get('e'), preview.get('f')])
    expect(preview.get('e')).toHaveLength(1)
  })

  it('keeps annotated couplings through a save, while both their ports remain', async () => {
    const annotated = (subject, variable, multiportType) => ({
      label: '',
      portType: 'general_ports',
      variables: [variable],
      multiportType,
      annotation: { subject, variable, role: 'reader', source: { kind: 'sidecar', mathRef: DECAY_REF } },
    })
    const reader = annotated('decay.cellml#decay.x', 'x', 'None')
    const owner = annotated('decay.cellml#decay.k', 'k', 'True')
    findNode('a').data = { ...findNode('a').data, ports: [...findNode('a').data.ports, reader] }
    findNode('b').data = { ...findNode('b').data, ports: [...findNode('b').data.ports, owner] }
    const couplings = [{ sourcePort: reader, targetPort: owner }]
    edges.value = [{ id: 'e', source: 'a', target: 'b', data: { couplings } }]

    await saveInstanceEdit(buildSave({ name: 'a' }))
    const saved = detachReactivity(edges.value[0].data.couplings)
    expect(saved).toHaveLength(2)
    expect(saved[0].sourcePort.label).toBe('p')
    expect(saved[1]).toEqual(detachReactivity({ sourcePort: reader, targetPort: owner }))

    // Removing the annotated port drops its coupling.
    await saveInstanceEdit(buildSave({ name: 'a', ports: findNode('a').data.ports.filter((port) => !port.annotation) }))
    expect(edges.value[0].data.couplings.map(({ sourcePort }) => sourcePort.label)).toEqual(['p'])
  })

  it('undoes a save on an instance that was deleted and restored', async () => {
    const before = snapshot()
    await saveInstanceEdit(fork())
    const restored = reactive(detachReactivity({ id: 'a', data: findNode('a').data }))
    nodes.value = [findNode('b')]
    nodes.value = [restored, findNode('b')]

    await history.undo()
    expect(findNode('a').data).toEqual(before.nodes[0].data)
  })

  it('leaves a workspace loaded since the save untouched', async () => {
    await saveInstanceEdit(fork())
    nodes.value = [createNode('a'), createNode('b')]
    findNode('a').data = { ...findNode('a').data, name: 'loaded', mathRef: GROWTH_REF }
    edges.value = [{ id: 'e', source: 'a', target: 'b', data: { couplings: [{ loaded: true }] } }]
    library.addMath(GROWTH_REF, GROWTH_XML.replace('initial_value="0.5"', 'initial_value="9"'))
    library.assignGlobalConstant('g', '7', 'second', null, true)
    const loaded = snapshot()
    const loadedMath = library.getMathEntry(GROWTH_REF)

    await history.undo()
    expect(snapshot()).toEqual(loaded)
    expect(library.getMathEntry(GROWTH_REF)).toEqual(loadedMath)
    expect(library.getGlobalConstant('g').value).toBe('7')
  })

  it('leaves math in place when the library has changed it since an overwrite', async () => {
    await saveInstanceEdit(buildSave({ math: DECAY_WITHOUT_K }))
    library.addMath(DECAY_REF, DECAY_XML.replace('initial_value="0.5"', 'initial_value="9"'))
    const loaded = snapshot()
    const loadedMath = library.getMathEntry(DECAY_REF)

    await history.undo()
    expect(library.getMathEntry(DECAY_REF)).toEqual(loadedMath)
    expect(snapshot()).toEqual(loaded)
  })

  it('applies nothing when one rebuilt instance has changed since', async () => {
    await saveInstanceEdit(buildSave({ math: DECAY_WITHOUT_K }))
    findNode('a').data = { ...findNode('a').data, variables: [{ name: 'x', value: 'csv', type: 'variable' }] }
    const changed = snapshot()
    const savedMath = library.getMathEntry(DECAY_REF)

    await history.undo()
    expect(snapshot()).toEqual(changed)
    expect(library.getMathEntry(DECAY_REF)).toEqual(savedMath)
  })

  it('redoes nothing when only the math has changed since the undo', async () => {
    await saveInstanceEdit(buildSave({ math: DECAY_WITHOUT_K }))
    await history.undo()
    library.addMath(DECAY_REF, DECAY_XML.replace('initial_value="0.5"', 'initial_value="9"'))
    const changed = snapshot()
    const changedMath = library.getMathEntry(DECAY_REF)

    await history.redo()
    expect(snapshot()).toEqual(changed)
    expect(library.getMathEntry(DECAY_REF)).toEqual(changedMath)
  })

  it('redoes nothing when the instances have changed since the undo', async () => {
    await saveInstanceEdit(fork())
    await history.undo()
    findNode('b').data = { ...findNode('b').data, name: 'elsewhere' }
    const changed = snapshot()

    await history.redo()
    expect(snapshot()).toEqual(changed)
    expect(library.availableMath.has(GROWTH_REF)).toBe(false)
  })

  it('redoes a fork whose math an undo kept for another instance', async () => {
    await saveInstanceEdit(fork())
    const other = createNode('c')
    other.data = { ...other.data, mathRef: GROWTH_REF }
    nodes.value = [...nodes.value, other]
    await history.undo()
    expect(library.availableMath.has(GROWTH_REF)).toBe(true)

    await history.redo()
    expect(findNode('a').data.mathRef).toBe(GROWTH_REF)
  })

  describe('new components', () => {
    const GROWTH_MODULE_REF = 'growth:default'

    it('adds a module for the new math, used by every instance saved, and undo and redo remove and put it back', async () => {
      await saveInstanceEdit(fork())
      expect([...library.availableCollections.get(GROWTH_REF)]).toEqual([GROWTH_MODULE_REF])
      expect(library.availableModules.get(GROWTH_MODULE_REF)).toMatchObject({ mathRef: GROWTH_REF, ports: findNode('a').data.ports })
      expect(findNode('a').data.moduleRef).toBe(GROWTH_MODULE_REF)
      expect(findNode('b').data.moduleRef).toBe(GROWTH_MODULE_REF)

      await history.undo()
      expect(library.availableModules.has(GROWTH_MODULE_REF)).toBe(false)
      expect(library.availableCollections.has(GROWTH_REF)).toBe(false)
      expect(findNode('a').data.moduleRef).toBe(NEW_MODULE_REF)

      await history.redo()
      expect([...library.availableCollections.get(GROWTH_REF)]).toEqual([GROWTH_MODULE_REF])
      expect(library.availableModules.get(GROWTH_MODULE_REF).isStub).toBeUndefined()
      expect(findNode('b').data.moduleRef).toBe(GROWTH_MODULE_REF)
    })

    it('moves only the siblings on the edited node\'s module to the new one', async () => {
      findNode('b').data.moduleRef = 'decay:fast'
      await saveInstanceEdit(fork())
      expect(findNode('a').data.moduleRef).toBe(GROWTH_MODULE_REF)
      expect(findNode('b').data).toMatchObject({ mathRef: GROWTH_REF, moduleRef: 'decay:fast' })

      await history.undo()
      expect(findNode('b').data).toMatchObject({ mathRef: DECAY_REF, moduleRef: 'decay:fast' })
      expect(library.availableModules.has(GROWTH_MODULE_REF)).toBe(false)
    })

    it('keeps the module an undo would remove while another node uses it', async () => {
      await saveInstanceEdit(fork())
      const other = createNode('c')
      other.data = { ...other.data, mathRef: GROWTH_REF, moduleRef: GROWTH_MODULE_REF }
      nodes.value = [...nodes.value, other]

      await history.undo()
      expect(findNode('a').data.moduleRef).toBe(NEW_MODULE_REF)
      expect(library.availableModules.has(GROWTH_MODULE_REF)).toBe(true)
    })

    it('gives components saved from the template distinct modules, even when a library module has the name', async () => {
      library.addModule({ moduleRef: GROWTH_MODULE_REF, mathRef: 'library.cellml:growth', ports: [], variables: [] })
      const templateGrowth = `${NEW_MODULE_FILENAME}:growth`
      const templateOther = `${NEW_MODULE_FILENAME}:other`

      await saveInstanceEdit(buildSave({ mathRef: templateGrowth, math: GROWTH_XML }))
      await saveInstanceEdit(buildSave({ id: 'b', mathRef: templateOther, math: GROWTH_XML.replaceAll('growth', 'other') }))
      expect(findNode('a').data.moduleRef).toBe('growth:default_2')
      expect(findNode('b').data.moduleRef).toBe('other:default')
      expect([...library.availableCollections.get(templateGrowth)]).toEqual(['growth:default_2'])
      expect([...library.availableCollections.get('library.cellml:growth')]).toEqual([GROWTH_MODULE_REF])
    })

    it('leaves the module alone when the math already has one', async () => {
      library.addModule({ moduleRef: 'decay:default', mathRef: DECAY_REF, ports: [], variables: [] })
      await saveInstanceEdit(buildSave({ math: DECAY_WITHOUT_K }))
      expect(findNode('a').data.moduleRef).toBe(NEW_MODULE_REF)
      expect([...library.availableCollections.get(DECAY_REF)]).toEqual(['decay:default'])
    })
  })

  it('updates a shared constant the node already used, and undo puts it back', async () => {
    library.assignGlobalConstant('g', '1', 'second', 'Smith2020')
    const globalConstants = [{ name: 'g', value: '2', units: 'metre', data_reference: null, overwrite: true }]

    await saveInstanceEdit(buildSave({ globalConstants }))
    expect(library.getGlobalConstant('g')).toEqual({ value: '2', units: 'second', data_reference: 'Smith2020' })

    await history.undo()
    expect(library.getGlobalConstant('g')).toEqual({ value: '1', units: 'second', data_reference: 'Smith2020' })
  })

  it('keeps the shared value when a row is switched to a constant that already exists', async () => {
    library.assignGlobalConstant('g', '1', 'second', null)
    const globalConstants = [{ name: 'g', value: '9', units: 'second', data_reference: null, overwrite: false }]

    await saveInstanceEdit(buildSave({ globalConstants }))
    expect(library.getGlobalConstant('g').value).toBe('1')
  })

  describe('plotted variables', () => {
    const plotOf = (nodeId, variableName, nodeName = nodeId) => ({
      key: `${nodeId}::${variableName}`,
      nodeId,
      nodeName,
      variableName,
      units: 'metre',
      type: 'variable',
      plot: true,
      groupId: 'plot-1',
    })

    it('plots the chosen variables under the saved name, and undo puts the plot config back with the edit', async () => {
      const simulation = useSimulationSettingsStore()
      simulation.setPlotConfig({ groups: [{ id: 'plot-1', name: 'Plot 1' }], selections: [plotOf('b', 'x')] })
      const before = simulation.getState().plotConfig

      await saveInstanceEdit(buildSave({ plotVariables: [{ name: 'x' }] }))
      const after = simulation.getState().plotConfig
      expect(after.selections).toEqual([plotOf('b', 'x'), plotOf('a', 'x', 'a2')])

      await history.undo()
      expect(simulation.getState().plotConfig.selections).toEqual(before.selections)
      expect(findNode('a').data.name).toBe('a')

      await history.redo()
      expect(simulation.getState().plotConfig.selections).toEqual(after.selections)
    })

    it('records a save that only changes the plotted variables', async () => {
      await saveInstanceEdit(buildSave({ name: 'a', plotVariables: [{ name: 'x' }] }))
      expect(history.canUndo).toBe(true)

      await history.undo()
      expect(useSimulationSettingsStore().plotConfig.selections).toEqual([])
    })

    it('still undoes the edit after Simulation Settings rewrites the other nodes’ plots', async () => {
      const simulation = useSimulationSettingsStore()
      simulation.setPlotConfig({ groups: [{ id: 'plot-1', name: 'Plot 1' }], selections: [plotOf('b', 'x')] })
      await saveInstanceEdit(buildSave({ plotVariables: [{ name: 'x' }] }))

      // Simulation Settings saves every selection again, sorted by node name, with others changed.
      const { selections } = simulation.getState().plotConfig
      simulation.setPlotConfig({ groups: [{ id: 'plot-2', name: 'Other' }], selections: [...selections].reverse().map((s) => (s.nodeId === 'b' ? { ...s, groupId: 'plot-2' } : s)) })

      await history.undo()
      expect(findNode('a').data.name).toBe('a')
      expect(simulation.plotConfig.selections.map((selection) => selection.key)).toEqual(['b::x'])
    })

    it('leaves the edit in place when its own plotted variables have changed since', async () => {
      const simulation = useSimulationSettingsStore()
      await saveInstanceEdit(buildSave({ plotVariables: [{ name: 'x' }] }))
      simulation.setPlotConfig({ groups: [{ id: 'plot-1', name: 'Plot 1' }], selections: [] })

      await history.undo()
      expect(findNode('a').data.name).toBe('a2')
    })

    it('records nothing when the save changes nothing, plotted variables included', async () => {
      // The first save fills in the edge's couplings, which the fixture leaves empty.
      await saveInstanceEdit(buildSave({ name: 'a' }))
      history.clear()

      await saveInstanceEdit(buildSave({ name: 'a', plotVariables: [] }))
      expect(history.canUndo).toBe(false)
      expect(useSimulationSettingsStore().plotConfig).toEqual({})
    })
  })

  describe('module annotations', () => {
    const DECAY_SIDECAR = `@prefix bqbiol: <http://biomodels.net/biology-qualifiers/> .
@prefix opb: <http://identifiers.org/opb/OPB_> .
@prefix m: <./file#> .

m:decay.x bqbiol:isVersionOf opb:00340 ;
    bqbiol:isPropertyOf m:decay .
m:decay.k bqbiol:isVersionOf opb:00592 ;
    bqbiol:isPropertyOf m:decay .
`
    const RENAMED_GROWTH_XML = GROWTH_XML.replaceAll('"k"', '"kd"').replaceAll('<ci>k</ci>', '<ci>kd</ci>')

    beforeEach(() => {
      library.setModuleAnnotations(DECAY_REF, DECAY_SIDECAR)
    })

    it('copies the sidecar to forked math, which the old math keeps, and one undo removes the copy', async () => {
      await saveInstanceEdit(fork())
      const copied = library.getModuleAnnotations(GROWTH_REF)
      expect(copied).toContain('m:growth.x')
      expect(copied).toContain('m:growth.k ')
      expect(copied).not.toContain('decay')
      expect(library.getModuleAnnotations(DECAY_REF)).toBe(DECAY_SIDECAR)

      await history.undo()
      expect(library.getModuleAnnotations(GROWTH_REF)).toBeNull()
      expect(findNode('a').data.mathRef).toBe(DECAY_REF)

      await history.redo()
      expect(library.getModuleAnnotations(GROWTH_REF)).toBe(copied)
    })

    it('renames the subjects of variables the new math renamed', async () => {
      await saveInstanceEdit(buildSave({ mathRef: GROWTH_REF, math: RENAMED_GROWTH_XML }))
      const copied = library.getModuleAnnotations(GROWTH_REF)
      expect(copied).toContain('m:growth.kd')
      expect(copied).toContain('m:growth.x')
      expect(copied).not.toContain('m:growth.k ')
    })

    it('renames subjects in place when math is overwritten under its own reference', async () => {
      await saveInstanceEdit(buildSave({ math: DECAY_XML.replaceAll('"k"', '"kd"').replaceAll('<ci>k</ci>', '<ci>kd</ci>') }))
      expect(library.getModuleAnnotations(DECAY_REF)).toContain('m:decay.kd')

      await history.undo()
      expect(library.getModuleAnnotations(DECAY_REF)).toBe(DECAY_SIDECAR)
    })

    it('writes the annotations a save carries, and one undo puts back the sidecar and the nodes', async () => {
      const text = DECAY_SIDECAR.replace('opb:00592', 'opb:00318')
      await saveInstanceEdit(buildSave({ annotations: { text } }))
      expect(library.getModuleAnnotations(DECAY_REF)).toBe(text)
      expect(findNode('a').data.name).toBe('a2')

      await history.undo()
      expect(library.getModuleAnnotations(DECAY_REF)).toBe(DECAY_SIDECAR)
      expect(findNode('a').data.name).toBe('a')
    })

    it('clears the sidecar when a save carries empty annotations', async () => {
      await saveInstanceEdit(buildSave({ annotations: { text: '' } }))
      expect(library.getModuleAnnotations(DECAY_REF)).toBeNull()

      await history.undo()
      expect(library.getModuleAnnotations(DECAY_REF)).toBe(DECAY_SIDECAR)
    })

    it('records a save that only changes the annotations', async () => {
      await saveInstanceEdit(buildSave({ name: 'a' }))
      history.clear()
      await saveInstanceEdit(buildSave({ name: 'a', annotations: { text: DECAY_SIDECAR.replace('opb:00592', 'opb:00318') } }))
      expect(history.canUndo).toBe(true)
    })

    it('replaces the sidecar of math a save overwrites, and undo puts it back', async () => {
      library.addMath(GROWTH_REF, GROWTH_XML)
      const growthSidecar = DECAY_SIDECAR.replaceAll('decay', 'growth').replace('opb:00592', 'opb:00318')
      library.setModuleAnnotations(GROWTH_REF, growthSidecar)
      await saveInstanceEdit(buildSave({ mathRef: GROWTH_REF, math: GROWTH_XML.replace('<ci>k</ci>', '<cn>2</cn>') }))
      expect(library.getModuleAnnotations(GROWTH_REF)).toContain('opb:00592')

      await history.undo()
      expect(library.getModuleAnnotations(GROWTH_REF)).toBe(growthSidecar)
      expect(library.getModuleAnnotations(DECAY_REF)).toBe(DECAY_SIDECAR)
    })

    it('still saves, leaving the sidecars as they are, when the old sidecar does not parse', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      library.setModuleAnnotations(DECAY_REF, 'not turtle ;;')
      await saveInstanceEdit(fork())
      expect(findNode('a').data.mathRef).toBe(GROWTH_REF)
      expect(library.getModuleAnnotations(GROWTH_REF)).toBeNull()
      expect(library.getModuleAnnotations(DECAY_REF)).toBe('not turtle ;;')
      expect(warn).toHaveBeenCalled()
      warn.mockRestore()
    })

    const COMPLETE_SIDECAR = `@prefix sbo: <http://purl.obolibrary.org/obo/SBO_> .\n${DECAY_SIDECAR}m:decay bqbiol:is sbo:0000290 .\n`
    const sidecarVariables = (id) =>
      findNode(id)
        .data.ports.filter((port) => port.annotation?.source?.kind === 'sidecar')
        .map((port) => port.annotation.subject)

    it('gives every node on the math one sidecar port per annotation, and one undo takes them away', async () => {
      library.setModuleAnnotations(DECAY_REF, COMPLETE_SIDECAR)
      await saveInstanceEdit(buildSave({ name: 'a' }))
      const subjects = ['https://phlynx.invalid/modules/file#decay.x', 'https://phlynx.invalid/modules/file#decay.k']
      expect(sidecarVariables('a')).toEqual(subjects)
      expect(sidecarVariables('b')).toEqual(subjects)
      expect(findNode('a').data.ports[0].label).toBe('p')

      await history.undo()
      expect(sidecarVariables('a')).toEqual([])
      expect(sidecarVariables('b')).toEqual([])
    })

    it('moves sidecar ports and their couplings to forked math', async () => {
      library.setModuleAnnotations(DECAY_REF, COMPLETE_SIDECAR)
      await saveInstanceEdit(buildSave({ name: 'a', updateAll: true, siblings: ['b'] }))
      const [xa] = findNode('a').data.ports.filter((port) => port.annotation?.variable === 'x')
      const [kb] = findNode('b').data.ports.filter((port) => port.annotation?.variable === 'k')
      edges.value = [{ id: 'e', source: 'a', target: 'b', data: { couplings: [{ sourcePort: xa, targetPort: kb }] } }]

      await saveInstanceEdit(buildSave({ ...fork(), ports: findNode('a').data.ports }))
      expect(sidecarVariables('a')).toEqual(['https://phlynx.invalid/modules/file#growth.x', 'https://phlynx.invalid/modules/file#growth.k'])
      const annotated = edges.value[0].data.couplings.filter(({ sourcePort }) => sourcePort.annotation)
      expect(annotated.map(({ sourcePort, targetPort }) => [sourcePort.annotation.subject, targetPort.annotation.subject])).toEqual([
        ['https://phlynx.invalid/modules/file#growth.x', 'https://phlynx.invalid/modules/file#growth.k'],
      ])
    })

    it('keeps the coupling of a sidecar port whose variable the math renamed', async () => {
      library.setModuleAnnotations(DECAY_REF, COMPLETE_SIDECAR)
      await saveInstanceEdit(buildSave({ name: 'a' }))
      const [ka] = findNode('a').data.ports.filter((port) => port.annotation?.variable === 'k')
      const [xb] = findNode('b').data.ports.filter((port) => port.annotation?.variable === 'x')
      edges.value = [{ id: 'e', source: 'a', target: 'b', data: { couplings: [{ sourcePort: ka, targetPort: xb }] } }]

      // As the editor leaves the port: its variable renamed, its subject not yet.
      const ports = findNode('a').data.ports.map((port) =>
        port === ka ? { ...port, variables: ['kd'], annotation: { ...port.annotation, variable: 'kd' } } : port
      )
      const variables = findNode('a').data.variables.map((row) => (row.name === 'k' ? { ...row, name: 'kd' } : row))
      const save = buildSave({ math: DECAY_XML.replaceAll('"k"', '"kd"').replaceAll('<ci>k</ci>', '<ci>kd</ci>'), ports, variables })
      expect(await findDroppedCouplings(save)).toEqual({ couplings: 0, connections: 0 })

      await saveInstanceEdit(save)
      const annotated = edges.value[0].data.couplings.filter(({ sourcePort }) => sourcePort.annotation)
      expect(annotated.map(({ sourcePort }) => sourcePort.annotation.subject)).toEqual(['https://phlynx.invalid/modules/file#decay.kd'])
    })

    it('counts the couplings a save would drop, and drops them when saved', async () => {
      library.setModuleAnnotations(DECAY_REF, COMPLETE_SIDECAR)
      await saveInstanceEdit(buildSave({ name: 'a' }))
      const [xa] = findNode('a').data.ports.filter((port) => port.annotation?.variable === 'x')
      const [kb] = findNode('b').data.ports.filter((port) => port.annotation?.variable === 'k')
      edges.value = [{ id: 'e', source: 'a', target: 'b', data: { couplings: [{ sourcePort: xa, targetPort: kb }] } }]

      const save = buildSave({ name: 'a', annotations: { text: '' } })
      expect(await findDroppedCouplings(save)).toEqual({ couplings: 1, connections: 1 })
      expect(findNode('a').data.ports).toContain(xa)

      await saveInstanceEdit(save)
      expect(sidecarVariables('a')).toEqual([])
      expect(edges.value[0].data.couplings.filter(({ sourcePort }) => sourcePort.annotation)).toEqual([])
    })

    it('leaves the sidecar alone when the save keeps the math', async () => {
      await saveInstanceEdit(buildSave({ name: 'a' }))
      history.clear()
      await saveInstanceEdit(buildSave({ name: 'a' }))
      expect(history.canUndo).toBe(false)
      expect(library.getModuleAnnotations(DECAY_REF)).toBe(DECAY_SIDECAR)
    })
  })
})
