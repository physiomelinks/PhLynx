// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const confirm = vi.hoisted(() => vi.fn())
// The handles are drawn in the workspace's own flow, as inside its VueFlow.
vi.mock('@vue-flow/core', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useVueFlow: (id) => actual.useVueFlow(id ?? 'main-flow-editor') }
})
vi.mock('../../../src/composables/useConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm }) }))

const { useVueFlow } = await import('@vue-flow/core')
const { useCanvasLevel } = await import('../../../src/composables/useCanvasLevel.js')
const { useFlowHistory } = await import('../../../src/composables/useFlowHistory.js')
const { useNodeHandles } = await import('../../../src/composables/useNodeHandles.js')
const { useFlowHistoryStore } = await import('../../../src/stores/historyStore.js')
const { FLOW_IDS, HANDLE_VARIANT } = await import('../../../src/utils/constants.js')
const { connect, exposed, exposures, module, port, superInstance, supermodule } = await import('../fixtures/hierarchy/graph.js')

const IN = port('entrance_ports', 'vessel', ['v_in'])
const OUT = port('exit_ports', 'vessel', ['v'])
const handles = () => [{ uid: 'used', side: 'right', name: '', slotIndex: 0, variant: HANDLE_VARIANT.DEFAULT }]
const vessel = (localId, name, options = {}) => module(localId, name, { ports: [{ ...IN }, { ...OUT }], data: { handles: handles() }, ...options })

/** Root src → p1, a super instance of pair (sm_1: a, and c with no edges), exposing a's entrance on the interface's handle. */
function graph() {
  const a = vessel('a', 'a', { scope: 'sm_1' })
  const c = vessel('c', 'c', { scope: 'sm_1' })
  const sm = supermodule('sm_1', 'pair')
  sm.data.handles = handles()
  const exposure = exposures('sm_1', [exposed('xp_in', 'a', 'entrance_ports', 'vessel')])
  exposure[0] = { ...exposure[0], sourceHandle: 'handle_used', targetHandle: 'handle_used' }
  const inner = { nodes: [sm, a, c], edges: exposure }
  const p1 = superInstance(inner, 'dndnode_1', 'p1', 'sm_1')
  const p2 = superInstance(inner, 'dndnode_3', 'p2', 'sm_1')
  const src = vessel('dndnode_0', 'src')
  return { nodes: [src, p1, p2, sm, a, c], edges: [connect(src, p1, { id: 'e0' }), ...exposure] }
}

describe('useNodeHandles removing a handle', () => {
  const flow = useVueFlow(FLOW_IDS.MAIN)
  const level = useCanvasLevel()
  let history, listeners, wrappers

  const edgeIds = () => flow.edges.value.map((edge) => edge.id)
  const variantOf = (id) => flow.findNode(id).data.handles[0].variant
  /** @returns {Function} removeHandle for a node, as its NodeHandles has it. */
  const handlesOf = (id) => {
    let api
    const props = { id, get handles() { return flow.findNode(id).data.handles } }
    wrappers.push(mount(defineComponent({ setup: () => ((api = useNodeHandles(props)), () => null) })))
    return api.removeHandle
  }

  beforeEach(async () => {
    setActivePinia(createPinia())
    confirm.mockReset()
    wrappers = []
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
    await flow.fromObject(level.withVisibility(graph()))
  })
  afterEach(() => {
    wrappers.forEach((wrapper) => wrapper.unmount())
    listeners.forEach((listener) => listener.off())
    flow.applyDefault.value = true
    history.setGate(null)
  })

  it('asks before un-exposing ports, then breaks their connections with the handle, as one undo step', async () => {
    confirm.mockResolvedValue(true)
    await handlesOf('sm_1')('used')
    await flushPromises()
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ header: 'Delete Exposed Nodes?' }))
    expect(edgeIds()).not.toContain('sm_1~a--sm_1')
    expect(edgeIds()).not.toContain('e0')
    expect(variantOf('sm_1')).toBe(HANDLE_VARIANT.GHOST)
    expect(history.pointerIndex).toBe(0)

    await history.undo()
    await flushPromises()
    expect(edgeIds()).toEqual(expect.arrayContaining(['e0', 'sm_1~a--sm_1']))
    expect(variantOf('sm_1')).toBe(HANDLE_VARIANT.DEFAULT)
    expect(history.canUndo).toBe(false)

    await history.redo()
    await flushPromises()
    expect(edgeIds()).not.toContain('sm_1~a--sm_1')
    expect(edgeIds()).not.toContain('e0')
    expect(variantOf('sm_1')).toBe(HANDLE_VARIANT.GHOST)
    expect(history.canRedo).toBe(false)
  })

  it('changes nothing when told no', async () => {
    confirm.mockResolvedValue(false)
    await handlesOf('sm_1')('used')
    await flushPromises()
    expect(edgeIds()).toEqual(expect.arrayContaining(['e0', 'sm_1~a--sm_1']))
    expect(variantOf('sm_1')).toBe(HANDLE_VARIANT.DEFAULT)
    expect(history.canUndo).toBe(false)
  })

  it('names the scope it changes, so the shared super-module edit guard can ask', async () => {
    const scopes = []
    history.setGate({ holds: (command) => (scopes.push(command.scopes), false), decide: async () => 'keep' })
    await handlesOf('sm_1~c')('used')
    expect(scopes).toEqual([['sm_1']])
    expect(variantOf('sm_1~c')).toBe(HANDLE_VARIANT.GHOST)
  })

  it('names an interface node’s super-module as the scope its handle changes', async () => {
    const scopes = []
    confirm.mockResolvedValue(true)
    history.setGate({ holds: (command) => (scopes.push(command.scopes), false), decide: async () => 'keep' })
    await handlesOf('sm_1')('used')
    await flushPromises()
    expect(scopes.at(-1)).toEqual(['sm_1'])
  })
})
