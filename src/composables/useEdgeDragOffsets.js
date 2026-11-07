import { shallowRef } from 'vue'

/**
 * How far each routed edge's waypoints are carried while its two nodes are dragged together, by
 * edge id. Only drawing reads it; the waypoints themselves move once the drag ends.
 */
const edgeDragOffsets = shallowRef(new Map())

/**
 * Shares the routed edges' offsets during a group drag between the flow history and the edges.
 *
 * @returns {{ edgeDragOffsets: ShallowRef<Map<string, {x: number, y: number}>> }}
 */
export function useEdgeDragOffsets() {
  return { edgeDragOffsets }
}
