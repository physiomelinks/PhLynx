import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useConnect } from '../../../src/composables/useConnect.js'
import { useFlowHistoryStore } from '../../../src/stores/historyStore.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'

const nodes = ref([])
const edges = ref([])
let connectHandler = null
// Stands in for useFlowHistory recording added edges.
let onEdgesAdded = null

const toIds = (ids) => (Array.isArray(ids) ? ids : [ids])

vi.mock('@vue-flow/core', async (importOriginal) => ({
  ...(await importOriginal()),
  useVueFlow: () => ({
    nodes,
    edges,
    findNode: (id) => nodes.value.find((node) => node.id === id),
    addEdges: (added) => {
      edges.value.push(...toIds(added))
      onEdgesAdded?.(toIds(added))
    },
    removeEdges: (ids) => (edges.value = edges.value.filter((edge) => !toIds(ids).includes(edge.id))),
    onConnect: (handler) => {
      connectHandler = handler
    },
  }),
}))

const port = (portType, label, variables = ['v']) => ({
  portType,
  label,
  variables,
})

const createNode = (id, ports = []) => ({
  id,
  position: { x: 0, y: 0 },
  data: { name: id, ports },
})

describe('useConnect', () => {
  let history, deps, suppressedEdgeIds

  /** Commits pending commands as one step without waiting for the batch timer. */
  const commit = () => {
    history.startBatch()
    history.endBatch()
  }

  const connect = (connection) => connectHandler(connection)

  beforeEach(() => {
    setActivePinia(createPinia())
    useLibraryStore()
    history = useFlowHistoryStore()
    connectHandler = null
    suppressedEdgeIds = new Set()
    nodes.value = [
      createNode('a', [port('exit_ports', 'flow')]),
      createNode('b', [port('entrance_ports', 'flow')]),
      createNode('c', [port('entrance_ports', 'flow')]),
    ]
    edges.value = []
    deps = {
      suppressedEdgeIds,
      confirm: vi.fn(async () => true),
      edgeLineOptions: { type: 'conduit', animated: false },
      confirmActivation: vi.fn(),
      activateHandle: vi.fn(),
      revertHandleIfUnused: vi.fn(),
      revertHandlesForEdge: vi.fn(),
      reactivateEdgeHandles: vi.fn(),
    }
    useConnect(deps)
  })

  it('registers a connect handler on the flow', () => {
    expect(connectHandler).toBeTypeOf('function')
  })

  describe('connecting two different instances', () => {
    const connection = {
      source: 'a',
      target: 'b',
      sourceHandle: 'handle_s1',
      targetHandle: 'handle_t1',
    }

    it('adds an edge with the resolved couplings and default edge options', async () => {
      await connect(connection)

      expect(edges.value).toHaveLength(1)
      const [edge] = edges.value
      expect(edge).toMatchObject({
        ...connection,
        id: 'a--b',
        type: 'conduit',
        animated: false,
      })
      expect(edge.data.couplings).toEqual([
        {
          sourcePort: nodes.value[0].data.ports[0],
          targetPort: nodes.value[1].data.ports[0],
        },
      ])
      // Drawn by hand, so no physiology view move takes it away.
      expect(edge.data.placement).toBe(false)
    })

    it('activates the ghost handles at both ends without tracking history', async () => {
      await connect(connection)

      expect(deps.confirmActivation).toHaveBeenCalledTimes(1)
      expect(deps.activateHandle).toHaveBeenCalledWith('a', 's1', {
        trackHistory: false,
      })
      expect(deps.activateHandle).toHaveBeenCalledWith('b', 't1', {
        trackHistory: false,
      })
      expect(deps.activateHandle).toHaveBeenCalledTimes(2)
    })

    it('does not ask for confirmation or record a replace command', async () => {
      await connect(connection)
      commit()

      expect(deps.confirm).not.toHaveBeenCalled()
      expect(history.canUndo).toBe(false)
    })

    it('skips handle activation when the connection carries no handle ids', async () => {
      await connect({ source: 'a', target: 'b' })

      expect(edges.value).toHaveLength(1)
      expect(deps.activateHandle).not.toHaveBeenCalled()
    })

    it('picks the next port slot for later edges from the same source', async () => {
      nodes.value[0].data.ports = [port('exit_ports', 'flow', ['x']), port('exit_ports', 'flow', ['y'])]
      await connect({ source: 'a', target: 'b', sourceHandle: 'handle_s1', targetHandle: 'handle_t1' })
      await connect({ source: 'a', target: 'c', sourceHandle: 'handle_s2', targetHandle: 'handle_t2' })

      expect(edges.value[0].data.couplings[0].sourcePort.variables).toEqual(['x'])
      expect(edges.value[1].data.couplings[0].sourcePort.variables).toEqual(['y'])
    })
  })

  describe('target port slots', () => {
    it('picks the next port slot for later edges into the same target', async () => {
      nodes.value[1].data.ports = [port('entrance_ports', 'flow', ['x']), port('entrance_ports', 'flow', ['y'])]
      nodes.value[2].data.ports = [port('exit_ports', 'flow')]
      await connect({ source: 'a', target: 'b', sourceHandle: 'handle_s1', targetHandle: 'handle_t1' })
      await connect({ source: 'c', target: 'b', sourceHandle: 'handle_s2', targetHandle: 'handle_t2' })

      expect(edges.value[0].data.couplings[0].targetPort.variables).toEqual(['x'])
      expect(edges.value[1].data.couplings[0].targetPort.variables).toEqual(['y'])
    })
  })

  describe('rejected connections', () => {
    const expectNothingHappened = () => {
      expect(edges.value).toHaveLength(0)
      expect(deps.confirmActivation).not.toHaveBeenCalled()
      expect(deps.activateHandle).not.toHaveBeenCalled()
      expect(deps.confirm).not.toHaveBeenCalled()
      commit()
      expect(history.canUndo).toBe(false)
    }

    it('rejects two handles on the same instance', async () => {
      await connect({
        source: 'a',
        target: 'a',
        sourceHandle: 'handle_s1',
        targetHandle: 'handle_t1',
      })

      expectNothingHappened()
    })

    it('rejects a connection whose source instance does not exist', async () => {
      await connect({
        source: 'missing',
        target: 'b',
        sourceHandle: 'handle_s1',
        targetHandle: 'handle_t1',
      })

      expectNothingHappened()
    })

    it('rejects a connection whose target instance does not exist', async () => {
      await connect({
        source: 'a',
        target: 'missing',
        sourceHandle: 'handle_s1',
        targetHandle: 'handle_t1',
      })

      expectNothingHappened()
    })

    it('silently ignores a connection between handles that are already connected', async () => {
      const connection = {
        source: 'a',
        target: 'b',
        sourceHandle: 'handle_s1',
        targetHandle: 'handle_t1',
      }
      await connect(connection)
      deps.confirmActivation.mockClear()
      deps.activateHandle.mockClear()

      await connect(connection)

      expect(edges.value).toHaveLength(1)
      expect(deps.confirmActivation).not.toHaveBeenCalled()
      expect(deps.activateHandle).not.toHaveBeenCalled()
      expect(deps.confirm).not.toHaveBeenCalled()
    })
  })

  describe('connecting instances that are already connected through other handles', () => {
    const first = {
      source: 'a',
      target: 'b',
      sourceHandle: 'handle_s1',
      targetHandle: 'handle_t1',
    }
    const second = {
      source: 'a',
      target: 'b',
      sourceHandle: 'handle_s2',
      targetHandle: 'handle_t2',
    }

    beforeEach(async () => {
      await connect(first)
      deps.activateHandle.mockClear()
      deps.confirmActivation.mockClear()
    })

    it('asks before replacing and shows the new edge as pending meanwhile', async () => {
      let pendingDuringConfirm
      deps.confirm.mockImplementation(async () => {
        pendingDuringConfirm = edges.value.find((e) => e.id === 'pending--a--b')
        return true
      })

      await connect(second)

      expect(deps.confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          header: 'Connection already exists',
          acceptLabel: 'Replace',
          rejectLabel: 'Cancel',
        }),
      )
      expect(pendingDuringConfirm).toMatchObject({
        ...second,
        style: { strokeDasharray: '8 8', opacity: 0.4 },
      })
      expect(deps.activateHandle).toHaveBeenCalledWith('a', 's2', {
        trackHistory: false,
      })
      expect(deps.activateHandle).toHaveBeenCalledWith('b', 't2', {
        trackHistory: false,
      })
    })

    it('keeps the existing edge and reverts the new handles when cancelled', async () => {
      deps.confirm.mockResolvedValue(false)

      await connect(second)

      expect(edges.value.map((e) => e.id)).toEqual(['a--b'])
      expect(edges.value[0]).toMatchObject(first)
      expect(deps.revertHandleIfUnused).toHaveBeenCalledWith('a', 's2', {
        trackHistory: false,
      })
      expect(deps.revertHandleIfUnused).toHaveBeenCalledWith('b', 't2', {
        trackHistory: false,
      })
      expect(deps.revertHandlesForEdge).not.toHaveBeenCalled()
      expect(suppressedEdgeIds.size).toBe(0)
      commit()
      expect(history.canUndo).toBe(false)
    })

    it('replaces the old edge with the new one and releases the suppressed ids', async () => {
      await connect(second)

      expect(edges.value).toHaveLength(1)
      expect(edges.value[0]).toMatchObject({ ...second, id: 'a--b' })
      expect(deps.revertHandlesForEdge).toHaveBeenCalledWith(
        expect.objectContaining({ ...first, id: 'a--b' }),
        ['a--b'],
        { trackHistory: false },
      )
      expect(suppressedEdgeIds.size).toBe(0)
    })

    it('suppresses history for the pending and old edges while they are being swapped', async () => {
      const during = {}
      deps.confirm.mockImplementation(async () => {
        during.confirm = [...suppressedEdgeIds]
        return true
      })
      deps.revertHandlesForEdge.mockImplementation(async () => {
        during.revert = [...suppressedEdgeIds].sort()
      })

      await connect(second)

      expect(during.confirm).toEqual(['pending--a--b'])
      expect(during.revert).toEqual(['a--b', 'pending--a--b'])
    })

    it('records a replace-edge command that undo and redo swap', async () => {
      await connect(second)
      commit()
      expect(history.canUndo).toBe(true)

      const replaced = edges.value[0]
      deps.revertHandlesForEdge.mockClear()

      await history.undo()
      expect(deps.revertHandlesForEdge).toHaveBeenCalledWith(expect.objectContaining(second), ['a--b'], {
        trackHistory: false,
      })
      expect(edges.value).toHaveLength(1)
      expect(edges.value[0]).toMatchObject(first)
      deps.revertHandlesForEdge.mockClear()
      expect(deps.reactivateEdgeHandles).toHaveBeenLastCalledWith(expect.objectContaining(first), {
        trackHistory: false,
      })

      await history.redo()
      expect(deps.revertHandlesForEdge).toHaveBeenCalledWith(expect.objectContaining(first), ['a--b'], {
        trackHistory: false,
      })
      expect(edges.value).toHaveLength(1)
      expect(edges.value[0]).toMatchObject(second)
      expect(deps.reactivateEdgeHandles).toHaveBeenLastCalledWith(expect.objectContaining(second), {
        trackHistory: false,
      })
    })
  })

  describe('connectNodes', () => {
    const ghosts = (prefix) =>
      ['top', 'bottom', 'left', 'right'].map((side) => ({
        uid: `${prefix}-${side}`,
        side,
        slotIndex: 0,
        variant: 'ghost',
      }))
    /** A measured node with one port and a ghost handle on each side. */
    const placed = (id, ports, x, y) => ({
      id,
      position: { x, y },
      dimensions: { width: 100, height: 60 },
      data: { name: id, ports, handles: ghosts(id) },
    })
    let connectNodes

    beforeEach(() => {
      nodes.value = [
        placed('a', [port('exit_ports', 'flow')], 0, 0),
        placed('b', [port('entrance_ports', 'flow')], 0, 300),
        placed('z', [port('entrance_ports', 'other')], 300, 0),
      ]
      ;({ connectNodes } = useConnect(deps))
    })

    it('joins two nodes the way round that couples their ports, on facing ghost handles', async () => {
      const edge = await connectNodes({ source: 'b', target: 'a' })
      expect(edge).toMatchObject({ id: 'a--b', source: 'a', target: 'b', type: 'conduit' })
      expect(edge.sourceHandle).toBe('handle_a-bottom')
      expect(edge.targetHandle).toBe('handle_b-top')
      expect(deps.activateHandle).toHaveBeenCalledWith('a', 'a-bottom', { trackHistory: false })
      expect(deps.activateHandle).toHaveBeenCalledWith('b', 'b-top', { trackHistory: false })
      expect(edge.data.couplings).toEqual([
        { sourcePort: nodes.value[0].data.ports[0], targetPort: nodes.value[1].data.ports[0] },
      ])
    })

    it('keeps the given way round, and leaves the edge empty, when no label matches', async () => {
      const edge = await connectNodes({ source: 'a', target: 'z' })
      expect(edge).toMatchObject({ id: 'a--z', sourceHandle: 'handle_a-right', targetHandle: 'handle_z-left' })
      expect(edge.data.couplings).toEqual([])
      expect((await connectNodes({ source: 'z', target: 'b' }, { couplings: 'none' })).data.couplings).toEqual([])
    })

    it('runs a link the given way, coupling only its exit to the other end’s entrance', async () => {
      // b → a couples nothing as a link, though a → b would by label.
      const backwards = await connectNodes({ source: 'b', target: 'a' }, { link: 'across' })
      expect(backwards).toMatchObject({ source: 'b', target: 'a' })
      expect(backwards.data.couplings).toEqual([])
      edges.value = []
      const forwards = await connectNodes({ source: 'a', target: 'b' }, { link: 'across' })
      expect(forwards.data.couplings).toEqual([
        { sourcePort: nodes.value[0].data.ports[0], targetPort: nodes.value[1].data.ports[0] },
      ])
    })

    it('marks a link’s edge as placement-made, and no other', async () => {
      expect((await connectNodes({ source: 'a', target: 'b' }, { link: 'across' })).data.placement).toBe('across')
      expect((await connectNodes({ source: 'a', target: 'z' })).data).not.toHaveProperty('placement')
    })

    it('never couples a single-connection outlet on a second link', async () => {
      nodes.value.push(placed('c', [port('entrance_ports', 'flow')], 300, 300))
      await connectNodes({ source: 'a', target: 'b' }, { link: 'across' })
      const second = await connectNodes({ source: 'a', target: 'c' }, { link: 'across' })
      expect(second.data.couplings).toEqual([])
    })

    it('leaves nodes already joined either way, and missing ones, alone', async () => {
      edges.value = [{ id: 'b--a', source: 'b', target: 'a' }]
      expect(await connectNodes({ source: 'a', target: 'b' })).toBeNull()
      expect(await connectNodes({ source: 'a', target: 'gone' })).toBeNull()
      expect(await connectNodes({ source: 'a', target: 'a' })).toBeNull()
      expect(edges.value).toHaveLength(1)
    })

    it('makes several joins one undo step inside a batch', async () => {
      const removeEdge = vi.fn()
      onEdgesAdded = () => history.addCommand({ type: 'add-edge', undo: removeEdge, redo: vi.fn() })
      try {
        history.startBatch()
        await connectNodes({ source: 'a', target: 'b' })
        await connectNodes({ source: 'a', target: 'z' })
        history.endBatch('bio-add')
      } finally {
        onEdgesAdded = null
      }
      await history.undo()
      expect(history.canUndo).toBe(false)
      expect(removeEdge).toHaveBeenCalledTimes(2)
    })
  })
})
