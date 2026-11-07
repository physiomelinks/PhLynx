import { useVueFlow } from '@vue-flow/core'
import { computed, onBeforeUnmount, ref } from 'vue'
import { getRouter, nodeObstacles, routeRequests } from '../services/routing'
import { useFlowHistoryStore } from '../stores/historyStore'
import { useEdgeDragOffsets } from './useEdgeDragOffsets'
import {
  MAX_WAYPOINTS,
  editableRoute,
  getEdgeWaypoints,
  moveSegment,
  routeWaypoints,
  segmentAxis,
  snapCoordinate,
  withEdgeWaypoints,
} from '../utils/edgeRoute'

/** Screen pixels within which a dragged segment lines up with a handle or another bend. */
const SNAP_PIXELS = 6

/** Shortest segment, in flow units, that gets a drag handle. */
const MIN_HANDLE_SEGMENT = 12

const sameWaypoints = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * Sets an edge's waypoints as one undo step. The edge is found by id on undo and redo, so the step
 * still applies after the edge is re-created.
 *
 * @param {Object} options
 * @param {Function} options.findEdge
 * @param {Object} options.history - The flow history store.
 * @param {string} edgeId
 * @param {Array<{x: number, y: number}>|undefined} waypoints - None goes back to smoothstep.
 * @returns {boolean} Whether anything changed.
 */
export function setEdgeRoute({ findEdge, history }, edgeId, waypoints) {
  const edge = findEdge(edgeId)
  if (!edge) return false
  const before = getEdgeWaypoints(edge)
  const after = waypoints?.length ? waypoints : undefined
  // A longer route would be refused when drawn, so it isn't stored.
  if ((after?.length ?? 0) > MAX_WAYPOINTS || sameWaypoints(before, after)) return false

  const apply = (value) => {
    const target = findEdge(edgeId)
    if (target) target.data = withEdgeWaypoints(target.data, value)
  }
  apply(after)
  history.addCommand({ type: 'edge-route', undo: () => apply(before), redo: () => apply(after) })
  return true
}

/**
 * Routes edges around the modules, as one undo step. An edge whose plain line is already clear
 * goes back to it; one with no way through keeps its route.
 *
 * @param {Object} options
 * @param {Function} options.findEdge
 * @param {Function} options.findNode
 * @param {Array<Object>} options.nodes - The flow's nodes, as obstacles.
 * @param {Object} options.history - The flow history store.
 * @param {Array<Object>} edges - The edges to route.
 * @param {string} [routerName] - A registered router; the default otherwise.
 * @returns {{ changed: number, unrouted: number }} How many routes changed, and how many edges had no way through.
 */
export function routeEdgesAroundModules({ findEdge, findNode, nodes, history }, edges, routerName) {
  const requests = routeRequests(edges, findNode)
  const routes = getRouter(routerName).routeAll(requests, { obstacles: nodeObstacles(nodes) })
  let changed = 0
  history.startBatch()
  try {
    routes.forEach((waypoints, id) => {
      if (setEdgeRoute({ findEdge, history }, id, waypoints)) changed++
    })
  } finally {
    history.endBatch()
  }
  return { changed, unrouted: requests.length - routes.size }
}

/**
 * Lets the user reshape a selected coupling edge by dragging its segments, draw.io style.
 *
 * @param {Object} props - The edge component's props.
 * @returns {{ route: ComputedRef, handles: ComputedRef, isEditing: ComputedRef, startDrag: Function }}
 *   route is the polyline to draw while dragging (else null); handles are the segment midpoints.
 */
export function useEdgeRouteEditing(props) {
  const { findEdge, getSelectedEdges, screenToFlowCoordinate, viewport } = useVueFlow()
  const history = useFlowHistoryStore()
  const { edgeDragOffsets } = useEdgeDragOffsets()

  const draft = ref(null)
  let drag = null

  const isEditing = computed(() => props.selected && getSelectedEdges.value.length === 1)

  // The segments between the two stubs, each with its midpoint and the way it moves.
  const handles = computed(() => {
    // While its nodes are dragged together the line moves away from its stored route.
    if (!isEditing.value || edgeDragOffsets.value.has(props.id)) return []
    const route = draft.value ?? editableRoute(props)
    const result = []
    for (let i = 1; i <= route.length - 3; i++) {
      const a = route[i]
      const b = route[i + 1]
      if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < MIN_HANDLE_SEGMENT) continue
      result.push({ index: i, axis: segmentAxis(route, i), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
    }
    return result
  })

  const toFlow = (event) => screenToFlowCoordinate({ x: event.clientX, y: event.clientY })

  function onMove(event) {
    if (!drag) return
    const point = toFlow(event)
    const { route, index, axis, start, origin } = drag
    const raw = origin + point[axis] - start[axis]
    // Line up with either handle or another bend; Alt places freely.
    const targets = route.filter((_, j) => j !== index && j !== index + 1).map((p) => p[axis])
    const value = event.altKey ? raw : snapCoordinate(raw, targets, SNAP_PIXELS / viewport.value.zoom)
    draft.value = moveSegment(route, index, value)
  }

  function finish(commit) {
    if (!drag) return
    const { element, pointerId } = drag
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
    window.removeEventListener('keydown', onKeyDown, true)
    if (element.isConnected && element.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId)
    if (commit && draft.value) setEdgeRoute({ findEdge, history }, props.id, routeWaypoints(draft.value))
    drag = null
    draft.value = null
  }

  const onUp = () => finish(true)
  const onCancel = () => finish(false)

  function onKeyDown(event) {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    finish(false)
  }

  /**
   * Starts dragging a segment handle.
   *
   * @param {PointerEvent} event
   * @param {{index: number, axis: 'x'|'y'}} handle
   */
  function startDrag(event, handle) {
    if (event.button !== 0 || drag) return
    event.stopPropagation()
    event.preventDefault()
    const route = editableRoute(props)
    const element = event.currentTarget
    element.setPointerCapture?.(event.pointerId)
    drag = {
      route,
      index: handle.index,
      axis: handle.axis,
      start: toFlow(event),
      origin: route[handle.index][handle.axis],
      element,
      pointerId: event.pointerId,
    }
    // On window, as the handle may be re-keyed, and so unmounted, as the route changes shape.
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKeyDown, true)
  }

  onBeforeUnmount(() => finish(false))

  return { route: computed(() => draft.value), handles, isEditing, startDrag }
}
