import { Position } from '@vue-flow/core'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'

import { routeEdgesAroundModules } from '../../../../src/composables/useEdgeRouteEditing.js'
import { getRouter, nodeObstacles, registerRouter, routeRequests } from '../../../../src/services/routing/index.js'
import { useFlowHistoryStore } from '../../../../src/stores/historyStore.js'

/** A 100 x 60 node with a handle in the middle of its left and right sides. */
const node = (id, x, y, extra = {}) => ({
  id,
  computedPosition: { x, y },
  dimensions: { width: 100, height: 60 },
  handleBounds: {
    source: [{ id: 'r', position: Position.Right, x: 96, y: 26, width: 8, height: 8 }],
    target: [{ id: 'l', position: Position.Left, x: -4, y: 26, width: 8, height: 8 }],
  },
  ...extra,
})

describe('routing service', () => {
  const nodes = [node('a', 0, 0), node('b', 400, 0), node('blocker', 200, -40, { dimensions: { width: 100, height: 140 } })]
  const findNode = (id) => nodes.find((n) => n.id === id)

  it('places each edge end on its handle, as vue-flow does', () => {
    const [request] = routeRequests([{ id: 'e', source: 'a', target: 'b', sourceHandle: 'r', targetHandle: 'l' }], findNode)
    expect(request).toEqual({ id: 'e', sourceX: 104, sourceY: 30, sourcePosition: 'right', targetX: 396, targetY: 30, targetPosition: 'left' })
  })

  it('leaves out hidden edges, edges to hidden or missing nodes, and hidden nodes as obstacles', () => {
    const hidden = node('h', 0, 200, { hidden: true })
    const find = (id) => [...nodes, hidden].find((n) => n.id === id)
    const edges = [
      { id: 'x', source: 'a', target: 'h' },
      { id: 'y', source: 'a', target: 'gone' },
      { id: 'z', source: 'a', target: 'b', hidden: true },
    ]
    expect(routeRequests(edges, find)).toEqual([])
    expect(nodeObstacles([...nodes, hidden])).toHaveLength(3)
  })

  it('routes edges around modules as one undo step', async () => {
    setActivePinia(createPinia())
    const history = useFlowHistoryStore()
    const edges = [{ id: 'e', source: 'a', target: 'b', sourceHandle: 'r', targetHandle: 'l', data: { couplings: [] } }]
    const findEdge = (id) => edges.find((e) => e.id === id)

    const result = routeEdgesAroundModules({ findEdge, findNode, nodes, history }, edges)
    expect(result).toEqual({ changed: 1, unrouted: 0 })
    expect(edges[0].data.waypoints.length).toBeGreaterThan(0)
    expect(history.pointerIndex).toBe(0)

    await history.undo()
    expect(edges[0].data.waypoints).toBeUndefined()
  })

  it('uses a registered router by name', () => {
    setActivePinia(createPinia())
    registerRouter({ name: 'straight-up', routeAll: (requests) => new Map(requests.map((r) => [r.id, [{ x: 150, y: -100 }]])) })
    const edges = [{ id: 'e', source: 'a', target: 'b', sourceHandle: 'r', targetHandle: 'l', data: {} }]
    const history = useFlowHistoryStore()
    routeEdgesAroundModules({ findEdge: (id) => edges.find((e) => e.id === id), findNode, nodes, history }, edges, 'straight-up')
    expect(edges[0].data.waypoints).toEqual([{ x: 150, y: -100 }])
    expect(getRouter('orthogonal')).toBeDefined()
  })
})
