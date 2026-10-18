// @vitest-environment happy-dom
import { useVueFlow } from '@vue-flow/core'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const notify = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn() }))
vi.mock('../../../src/utils/notify', () => ({ notify }))

const { useCanvasDelete } = await import('../../../src/composables/useCanvasDelete.js')
const { useCanvasLevel } = await import('../../../src/composables/useCanvasLevel.js')
const { useConnect } = await import('../../../src/composables/useConnect.js')
const { describeExposedPort, duplicateIndex, exposedPortOwners, ownedLabel, portTypeLetter, portTypeName, useExposure } = await import('../../../src/composables/useExposure.js')
const { indexExposures } = await import('../../../src/services/hierarchy/exposure.js')
const { useFlowHistory } = await import('../../../src/composables/useFlowHistory.js')
const { useFlowHistoryStore } = await import('../../../src/stores/historyStore.js')
const { useInspectionModuleStore } = await import('../../../src/stores/inspectionModuleStore.js')
const { useSimulationSettingsStore } = await import('../../../src/stores/simulationSettingsStore.js')
const { FLOW_IDS } = await import('../../../src/utils/constants.js')
const { connect, exposed, exposures, module, port, superInstance, supermodule } = await import('../fixtures/hierarchy/graph.js')

const IN = port('entrance_ports', 'vessel', ['v_in'])
const OUT = port('exit_ports', 'vessel', ['v'])
const vessel = (localId, name, options = {}) => module(localId, name, { ports: [{ ...IN }, { ...OUT }], ...options })

/**
 * Root src → p1 → sink and an unconnected p2, both super instances of pair (sm_1: a → b, and c, connected to nothing),
 * exposing a's entrance (xp_in) and b's exit (xp_out).
 */
function pairGraph() {
  const a = vessel('a', 'a', { scope: 'sm_1' })
  const b = vessel('b', 'b', { scope: 'sm_1' })
  const c = vessel('c', 'c', { scope: 'sm_1' })
  const sm = supermodule('sm_1', 'pair', { submoduleOrder: ['a', 'b', 'c'] })
  const exposure = exposures('sm_1', [exposed('xp_in', 'a', 'entrance_ports', 'vessel'), exposed('xp_out', 'b', 'exit_ports', 'vessel')])
  const inner = { nodes: [sm, a, b, c], edges: exposure }
  const p1 = superInstance(inner, 'dndnode_1', 'p1', 'sm_1')
  const p2 = superInstance(inner, 'dndnode_3', 'p2', 'sm_1')
  const src = vessel('dndnode_0', 'src')
  const sink = vessel('dndnode_2', 'sink')
  const used = new Set()
  const edges = [connect(src, p1, { used, id: 'e0' }), connect(p1, sink, { used, id: 'e1' }), connect(a, b, { id: 'e_int' }), ...exposure]
  return { nodes: [src, p1, sink, p2, sm, a, b, c], edges }
}

describe('exposing ports through exposure edges', () => {
  const flow = useVueFlow(FLOW_IDS.MAIN)
  const level = useCanvasLevel()
  let history, listeners, confirm, exposure, onExposureEdge

  const edgeIds = () => flow.edges.value.map((edge) => edge.id)
  const portsOf = (id) => flow.findNode(id).data.ports.map((p) => [p.exposedPortId, p.label])
  const couplingOf = (edgeId) => flow.findEdge(edgeId).data.couplings[0]
  const entriesOf = (edgeId) => flow.findEdge(edgeId).data.exposed
  const connectOnCanvas = async (connection) => {
    flow.emits.connect(connection)
    await nextTick()
    await nextTick()
  }

  beforeEach(async () => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    history = useFlowHistoryStore()
    flow.applyDefault.value = false
    const { onNodeChange, onEdgeChange } = useFlowHistory({
      suppressedEdgeIds: new Set(),
      indexAddEdge: vi.fn(),
      indexRemoveEdge: vi.fn(),
      updateHelperLines: vi.fn(),
      revertHandlesForEdge: vi.fn(),
      reactivateEdgeHandles: vi.fn(),
    })
    listeners = [flow.onNodesChange(onNodeChange), flow.onEdgesChange(onEdgeChange)]
    level.reset()
    await flow.fromObject({ nodes: [], edges: [] })
    await flow.fromObject(level.withVisibility(pairGraph()))
    confirm = vi.fn()
    onExposureEdge = vi.fn()
    exposure = useExposure({ history })
    useConnect({
      suppressedEdgeIds: new Set(),
      confirm,
      edgeLineOptions: { type: 'smoothstep' },
      confirmActivation: vi.fn(),
      activateHandle: vi.fn(),
      revertHandleIfUnused: vi.fn(),
      revertHandlesForEdge: vi.fn(),
      reactivateEdgeHandles: vi.fn(),
      onExposureEdge,
    })
  })

  afterEach(() => {
    listeners.forEach((listener) => listener.off())
    flow.applyDefault.value = true
  })

  describe('connecting a child to the interface', () => {
    // Edited from the library, so no edit asks first (see useSupermoduleEditGuard).
    beforeEach(() => level.editSupermodule('sm_1'))

    it('draws an exposure edge exposing nothing, to have its ports picked, as one undo step', async () => {
      await connectOnCanvas({ source: 'sm_1~c', target: 'sm_1' })
      const edge = flow.findEdge('sm_1~c--sm_1')
      expect(edge).toMatchObject({ type: 'exposure', data: { exposed: [] } })
      expect(edge.data).not.toHaveProperty('couplings')
      expect(onExposureEdge).toHaveBeenCalledWith('sm_1~c--sm_1', { isNew: true })
      expect(flow.findEdge('sm_1~c--sm_1').hidden).toBeFalsy()
      history.startBatch()
      history.endBatch()
      await history.undo()
      expect(flow.findEdge('sm_1~c--sm_1')).toBeUndefined()
    })

    it('opens a child’s exposure edge rather than drawing a second, whichever way it is drawn', async () => {
      await connectOnCanvas({ source: 'sm_1', target: 'sm_1~a' })
      expect(onExposureEdge).toHaveBeenCalledWith('sm_1~a--sm_1', { isNew: false })
      expect(edgeIds().filter((id) => id.includes('--sm_1'))).toEqual(['sm_1~a--sm_1', 'sm_1~b--sm_1'])
    })

    it('refuses an edge inside that would take a single-connection port exposed', async () => {
      // a's entrance is exposed, so a connection from outside has it.
      await connectOnCanvas({ source: 'sm_1~c', target: 'sm_1~a', sourceHandle: 'handle_c_out', targetHandle: 'handle_a_in' })
      expect(flow.findEdge('sm_1~c--sm_1~a')).toBeUndefined()
      expect(notify.error).toHaveBeenCalledWith(expect.objectContaining({ items: [expect.stringContaining('"a" has no free "vessel" slot')] }))
    })
  })

  describe('the Expose Ports dialog', () => {
    it('lists a child’s ports, those exposed selected in order', () => {
      const dialog = exposure.exposureDialogOf('sm_1~a--sm_1')
      expect(dialog.child.id).toBe('sm_1~a')
      expect(dialog.smId).toBe('sm_1')
      expect(dialog.selected.map((row) => row.exposedPortId)).toEqual(['xp_in'])
      expect(dialog.rows.find((row) => row.key === 'exit_ports:vessel#0').disabled).toBe(true)
      expect(exposure.exposureDialogOf('e0')).toBeNull()
    })

    it('exposes the ports ticked, and every super instance gets them, as one undo step', async () => {
      flow.addEdges({ id: 'sm_1~c--sm_1', type: 'exposure', source: 'sm_1~c', target: 'sm_1', data: { exposed: [] } })
      history.startBatch()
      history.endBatch()
      const pointer = history.pointerIndex
      const saved = await exposure.saveExposure('sm_1~c--sm_1', [{ key: 'exit_ports:vessel#0', label: 'c_out' }])
      expect(saved).toEqual({ saved: true, problems: [] })
      expect(entriesOf('sm_1~c--sm_1')).toEqual([{ id: 'xp_0', alias: { portType: 'exit_ports', label: 'vessel', slot: 0 }, label: 'c_out', order: 2 }])
      expect(portsOf('dndnode_1')).toEqual([
        ['xp_in', 'vessel'],
        ['xp_out', 'vessel'],
        ['xp_0', 'c_out'],
      ])
      expect(portsOf('dndnode_3')).toEqual(portsOf('dndnode_1'))
      expect(history.pointerIndex).toBe(pointer + 1)

      await history.undo()
      expect(entriesOf('sm_1~c--sm_1')).toEqual([])
      expect(portsOf('dndnode_1')).toEqual([
        ['xp_in', 'vessel'],
        ['xp_out', 'vessel'],
      ])
      await history.redo()
      expect(portsOf('dndnode_1').at(-1)).toEqual(['xp_0', 'c_out'])
    })

    it('saves nothing it would refuse', async () => {
      const result = await exposure.saveExposure('sm_1~a--sm_1', [{ key: 'exit_ports:vessel#0' }])
      expect(result.saved).toBe(false)
      expect(result.problems[0]).toMatch(/already has it/)
      expect(history.canUndo).toBe(false)
    })
  })

  describe('un-exposing a port connections use', () => {
    it('asks across the workspace, and changes nothing when told no', async () => {
      confirm.mockResolvedValue(false)
      const result = await exposure.saveExposure('sm_1~b--sm_1', [], { confirm })
      expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('This affects 1 connection in 1 super instance.') }))
      expect(result.saved).toBe(false)
      expect(entriesOf('sm_1~b--sm_1')).toHaveLength(1)
      expect(edgeIds()).toContain('e1')
      expect(history.canUndo).toBe(false)
    })

    it('trims the couplings and removes an edge left with none, as one undo step', async () => {
      confirm.mockResolvedValue(true)
      await exposure.unexposePorts('sm_1', ['xp_out'], { confirm })
      expect(edgeIds()).not.toContain('e1')
      expect(entriesOf('sm_1~b--sm_1')).toEqual([])
      expect(portsOf('dndnode_1')).toEqual([['xp_in', 'vessel']])
      expect(flow.findNode('dndnode_1').data.broken).toBeUndefined()
      expect(history.pointerIndex).toBe(0)

      await history.undo()
      expect(edgeIds()).toContain('e1')
      expect(couplingOf('e1').sourcePort.exposedPortId).toBe('xp_out')
      expect(portsOf('dndnode_1')).toEqual([
        ['xp_in', 'vessel'],
        ['xp_out', 'vessel'],
      ])
      await history.redo()
      expect(edgeIds()).not.toContain('e1')
    })
  })

  describe('order and labels', () => {
    it('lists the super-module’s exposed ports for its sidebar, in order', async () => {
      await exposure.relabelExposedPort('sm_1', 'xp_out', 'outflow')
      expect(exposure.exposedPortListOf('sm_1')).toEqual([
        { id: 'xp_in', label: null, ownLabel: 'vessel', childId: 'sm_1~a', childName: 'a', edgeId: 'sm_1~a--sm_1', via: null, port: { ...IN } },
        { id: 'xp_out', label: 'outflow', ownLabel: 'vessel', childId: 'sm_1~b', childName: 'b', edgeId: 'sm_1~b--sm_1', via: null, port: { ...OUT, label: 'outflow' } },
      ])
    })

    it('reorders the exposed ports, the super instances’ ports with them, keeping every coupling', async () => {
      const before = couplingOf('e0')
      expect(await exposure.reorderExposedPorts('sm_1', ['xp_out', 'xp_in'])).toBe(true)
      expect(portsOf('dndnode_1')).toEqual([
        ['xp_out', 'vessel'],
        ['xp_in', 'vessel'],
      ])
      expect(couplingOf('e0')).toMatchObject({ sourcePort: before.sourcePort, sourceSlot: 0, targetSlot: 0, targetPort: { exposedPortId: 'xp_in' } })
      await history.undo()
      expect(portsOf('dndnode_1')[0][0]).toBe('xp_in')
    })

    it('labels an exposed port, rebinding the couplings to it', async () => {
      await exposure.relabelExposedPort('sm_1', 'xp_in', 'venous')
      expect(portsOf('dndnode_3')[0]).toEqual(['xp_in', 'venous'])
      expect(couplingOf('e0').targetPort.label).toBe('venous')
      await history.undo()
      expect(couplingOf('e0').targetPort.label).toBe('vessel')
    })
  })

  describe('keeping super instances in step', () => {
    it('flags couplings whose port a child’s edit took away as broken, keeping them, and clears the flag on undo', async () => {
      flow.updateNodeData('sm_1~a', { ports: [{ ...OUT }] })
      await nextTick()
      expect(flow.findNode('dndnode_1').data.broken).toEqual(['xp_in'])
      expect(couplingOf('e0').targetPort.exposedPortId).toBe('xp_in')
      flow.updateNodeData('sm_1~a', { ports: [{ ...IN }, { ...OUT }] })
      await nextTick()
      expect(flow.findNode('dndnode_1').data).not.toHaveProperty('broken')
    })
  })

  describe('deleting inside a super-module', () => {
    let canvasDelete
    const settings = () => useSimulationSettingsStore()

    beforeEach(() => {
      // Edited from the library, so no edit asks first (see useSupermoduleEditGuard).
      level.editSupermodule('sm_1')
      canvasDelete = useCanvasDelete({ confirm, history })
      flow.updateNodeData('dndnode_1', { overrides: { b: { k: { value: '2' } }, a: { k: { value: '3' } } } })
      const sel = (nodeId) => ({ key: `${nodeId}::v`, nodeId, nodeName: nodeId, variableName: 'v', units: '', type: 'variable', plot: true, groupId: 'plot-1' })
      settings().setPlotConfig({ groups: [{ id: 'plot-1', name: 'Plot 1' }], selections: [sel('dndnode_1/b'), sel('dndnode_3/b'), sel('dndnode_1/a')] })
      settings().setParameterScanConfig({ selections: [{ key: 'dndnode_3/b::k', nodeId: 'dndnode_3/b', parameterName: 'k' }] })
      useInspectionModuleStore().addModule({ id: 'i1', name: 'sum', units: '', variables: [{ key: 'dndnode_1/b::v', nodeId: 'dndnode_1/b', variableName: 'v' }] })
    })

    it('asks, then un-exposes the child’s ports, trims their connections, and drops its overrides and keys in every copy, as one undo step', async () => {
      confirm.mockResolvedValue(true)
      await canvasDelete.deleteNodes(['sm_1~b'])
      expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('This affects 1 connection in 1 super instance.') }))
      expect(flow.findNode('sm_1~b')).toBeUndefined()
      expect(edgeIds()).not.toContain('e1')
      expect(edgeIds()).not.toContain('sm_1~b--sm_1')
      expect(flow.findNode('dndnode_1').data.overrides).toEqual({ a: { k: { value: '3' } } })
      expect(settings().plotConfig.selections.map((s) => s.nodeId)).toEqual(['dndnode_1/a'])
      expect(settings().parameterScanConfig.selections).toEqual([])
      expect(useInspectionModuleStore().modules[0].variables).toEqual([])
      expect(history.pointerIndex).toBe(0)

      await history.undo()
      expect(flow.findNode('sm_1~b')).toBeDefined()
      expect(edgeIds()).toEqual(expect.arrayContaining(['e1', 'sm_1~b--sm_1', 'e_int']))
      expect(flow.findNode('dndnode_1').data.overrides).toEqual({ b: { k: { value: '2' } }, a: { k: { value: '3' } } })
      expect(settings().plotConfig.selections.map((s) => s.nodeId)).toEqual(['dndnode_1/b', 'dndnode_3/b', 'dndnode_1/a'])
      expect(settings().parameterScanConfig.selections).toHaveLength(1)
      expect(useInspectionModuleStore().modules[0].variables).toHaveLength(1)
      expect(portsOf('dndnode_1').map(([id]) => id)).toEqual(['xp_in', 'xp_out'])

      await history.redo()
      expect(flow.findNode('sm_1~b')).toBeUndefined()
      expect(settings().plotConfig.selections.map((s) => s.nodeId)).toEqual(['dndnode_1/a'])
    })

    it('changes nothing when told no', async () => {
      confirm.mockResolvedValue(false)
      await canvasDelete.deleteNodes(['sm_1~b'])
      expect(flow.findNode('sm_1~b')).toBeDefined()
      expect(settings().plotConfig.selections).toHaveLength(3)
      expect(history.canUndo).toBe(false)
    })

    it('un-exposes an exposure edge’s ports as it is deleted', async () => {
      confirm.mockResolvedValue(true)
      expect(useExposure({ history }).planRemoval([], ['sm_1~a--sm_1']).removeEdgeIds).toEqual(['e0'])
      await canvasDelete.deleteNodes([], ['sm_1~a--sm_1'])
      expect(edgeIds()).not.toContain('e0')
      expect(edgeIds()).not.toContain('sm_1~a--sm_1')
      expect(portsOf('dndnode_1').map(([id]) => id)).toEqual(['xp_out'])
      await history.undo()
      expect(edgeIds()).toEqual(expect.arrayContaining(['e0', 'sm_1~a--sm_1']))
    })
  })
})

describe('exposed port wording', () => {
  it('badges port types with the port type select’s letters, and names them in a word', () => {
    expect(['entrance_ports', 'exit_ports', 'general_ports', 'odd'].map(portTypeLetter)).toEqual(['I', 'O', 'G', '?'])
    expect(portTypeName('entrance_ports')).toBe('entrance')
  })

  it('numbers only labels that repeat, in order', () => {
    expect(duplicateIndex([{ label: 'u' }, { label: 'v' }, { label: 'u' }, { label: 'u' }])).toEqual([1, null, 2, 3])
    expect(duplicateIndex([])).toEqual([])
  })

  it('words a port as owner, type and variables, leaving out what it lacks', () => {
    expect(describeExposedPort('lv', { portType: 'exit_ports', variables: ['V', 'I'] })).toBe('lv · exit · V, I')
    expect(describeExposedPort(null, { portType: 'general_ports', variables: [] })).toBe('general')
  })
})

describe('exposedPortOwners', () => {
  it('names the child each exposed port is on, so two of one name read apart', () => {
    const a = vessel('a', 'left', { scope: 'sm_1' })
    const b = vessel('b', 'right', { scope: 'sm_1' })
    const sm = supermodule('sm_1', 'twins')
    const edges = exposures('sm_1', [exposed('xp_0', 'a', 'entrance_ports', 'vessel'), exposed('xp_1', 'b', 'entrance_ports', 'vessel')])
    const nodes = [sm, a, b]
    const owners = exposedPortOwners(nodes, indexExposures(nodes, edges).get('sm_1'))
    expect([...owners]).toEqual([['xp_0', 'left'], ['xp_1', 'right']])
    expect(ownedLabel(owners.get('xp_1'), 'vessel')).toBe('right · vessel')
    expect(ownedLabel(undefined, 'vessel')).toBe('vessel')
  })

  it('names the nested super instance a port is exposed via, not the child deeper in', () => {
    const cap = vessel('cap', 'cap', { scope: 'sm_2' })
    const bedsm = supermodule('sm_2', 'bedsm')
    const bedExposure = exposures('sm_2', [exposed('xp_in', 'cap', 'entrance_ports', 'vessel')])
    const heart = superInstance({ nodes: [bedsm, cap], edges: bedExposure }, 'bed', 'heart', 'sm_2', { scope: 'sm_1' })
    const limb = supermodule('sm_1', 'limb')
    const edges = [...exposures('sm_1', [exposed('xp_u', 'bed', 'entrance_ports', 'vessel', { via: 'xp_in' })]), ...bedExposure]
    const nodes = [limb, heart, bedsm, cap]
    expect(exposedPortOwners(nodes, indexExposures(nodes, edges).get('sm_1')).get('xp_u')).toBe('heart')
  })
})
