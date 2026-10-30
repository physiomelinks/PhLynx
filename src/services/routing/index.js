/**
 * Edge routers: each takes the edges to route and the module rectangles to avoid, and gives back
 * the waypoints for each edge. The orthogonal router is ours; others can be registered beside it.
 *
 * @typedef {{ id: string, sourceX: number, sourceY: number, sourcePosition: string,
 *   targetX: number, targetY: number, targetPosition: string }} RouteRequest
 * @typedef {{ name: string, routeAll: (requests: Array<RouteRequest>, options: { obstacles: Array<Object> })
 *   => Map<string, Array<{x: number, y: number}>|undefined> }} EdgeRouter
 */

import { Position } from '@vue-flow/core'
import orthogonal from './orthogonal'

const routers = new Map([[orthogonal.name, orthogonal]])

export const DEFAULT_ROUTER = orthogonal.name

/**
 * Adds a router, replacing one of the same name.
 *
 * @param {EdgeRouter} router
 */
export function registerRouter(router) {
  routers.set(router.name, router)
}

/**
 * Gives a router by name.
 *
 * @param {string} [name=DEFAULT_ROUTER]
 * @returns {EdgeRouter|undefined}
 */
export function getRouter(name = DEFAULT_ROUTER) {
  return routers.get(name)
}

/**
 * Gives the absolute position and side of one of a node's handles, as vue-flow places edge ends.
 *
 * @param {Object} node - A vue-flow GraphNode.
 * @param {string|null|undefined} handleId
 * @param {string} fallbackSide
 * @returns {{x: number, y: number, side: string}|null}
 */
function handleEnd(node, handleId, fallbackSide) {
  const bounds = [...(node.handleBounds?.source ?? []), ...(node.handleBounds?.target ?? [])]
  const handle = (handleId ? bounds.find((h) => h.id === handleId) : bounds[0]) ?? null
  const side = handle?.position ?? fallbackSide
  const x = (handle?.x ?? 0) + node.computedPosition.x
  const y = (handle?.y ?? 0) + node.computedPosition.y
  const width = handle?.width ?? node.dimensions.width
  const height = handle?.height ?? node.dimensions.height
  const point = {
    [Position.Top]: { x: x + width / 2, y },
    [Position.Right]: { x: x + width, y: y + height / 2 },
    [Position.Bottom]: { x: x + width / 2, y: y + height },
    [Position.Left]: { x, y: y + height / 2 },
  }[side]
  return point ? { ...point, side } : null
}

/**
 * Gives what a router needs to know about each edge whose two nodes are shown.
 *
 * @param {Array<Object>} edges
 * @param {Function} findNode
 * @returns {Array<RouteRequest>}
 */
export function routeRequests(edges, findNode) {
  return edges.flatMap((edge) => {
    if (edge.hidden) return []
    const sourceNode = findNode(edge.source)
    const targetNode = findNode(edge.target)
    if (!sourceNode || !targetNode || sourceNode.hidden || targetNode.hidden) return []
    const source = handleEnd(sourceNode, edge.sourceHandle, Position.Bottom)
    const target = handleEnd(targetNode, edge.targetHandle, Position.Top)
    if (!source || !target) return []
    return [
      {
        id: edge.id,
        sourceX: source.x,
        sourceY: source.y,
        sourcePosition: source.side,
        targetX: target.x,
        targetY: target.y,
        targetPosition: target.side,
      },
    ]
  })
}

/**
 * Gives the rectangles of the shown nodes, for routes to avoid.
 *
 * @param {Array<Object>} nodes - vue-flow GraphNodes.
 * @returns {Array<{x: number, y: number, width: number, height: number}>}
 */
export function nodeObstacles(nodes) {
  return nodes
    .filter((node) => !node.hidden && node.dimensions?.width && node.dimensions?.height)
    .map((node) => ({ x: node.computedPosition.x, y: node.computedPosition.y, ...node.dimensions }))
}
