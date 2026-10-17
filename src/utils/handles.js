import { Position } from '@vue-flow/core'
import {
  HANDLE_SIDES,
  SOURCE_HANDLE_PRIORITY,
  TARGET_HANDLE_PRIORITY,
  TARGET_HANDLE_TYPE,
  SOURCE_HANDLE_TYPE,
  HANDLE_VARIANT,
  HANDLE_SPACING,
  NUM_GHOST_HANDLES_TOP_BOT,
  NUM_GHOST_HANDLES_LEFT_RIGHT,
  SUPER_INSTANCE_NODE_TYPE,
  SUPERMODULE_INTERFACE_NODE_TYPE,
} from './constants'

export function randomHandleSide() {
  return HANDLE_SIDES[Math.floor(Math.random() * HANDLE_SIDES.length)]
}

export function getHandleId(handle) {
  return `handle_${handle.uid}`
}

export function getHandleUidFromHandleId(handleId) {
  return handleId.replace('handle_', '')
}

export function handlePosition(side) {
  switch (side) {
    case 'left':
      return Position.Left
    case 'right':
      return Position.Right
    case 'top':
      return Position.Top
    case 'bottom':
      return Position.Bottom
    default:
      return Position.Left
  }
}

export function normaliseHandleSlots(handles = []) {
  const sideHandles = Object.fromEntries(HANDLE_SIDES.map((side) => [side, []]))

  handles.forEach((handle) => {
    if (!handle || !handle.side || !sideHandles[handle.side]) return
    sideHandles[handle.side].push(handle)
  })

  const ordered = []

  Object.entries(sideHandles).forEach(([side, handlesOnSide]) => {
    const active = [...handlesOnSide]
      .filter((handle) => handle.variant !== HANDLE_VARIANT.GHOST)
      .sort((a, b) => {
        const aSlot = Number.isInteger(a.slotIndex) ? a.slotIndex : 0
        const bSlot = Number.isInteger(b.slotIndex) ? b.slotIndex : 0
        return aSlot - bSlot || (a.uid || '').localeCompare(b.uid || '')
      })

    const ghosts = [...handlesOnSide]
      .filter((handle) => handle.variant === HANDLE_VARIANT.GHOST)
      .sort((a, b) => {
        const aSlot = Number.isInteger(a.slotIndex) ? a.slotIndex : 0
        const bSlot = Number.isInteger(b.slotIndex) ? b.slotIndex : 0
        return aSlot - bSlot || (a.uid || '').localeCompare(b.uid || '')
      })

    const totalSlots = handlesOnSide.length
    const startIdx = Math.max(0, Math.floor((totalSlots - active.length) / 2))
    const canonical = [...ghosts.slice(0, startIdx), ...active, ...ghosts.slice(startIdx)]

    canonical.forEach((handle, index) => {
      handle.slotIndex = index
      ordered.push(handle)
    })
  })

  return ordered
}

export function getHandleStyle(handle, allHandles) {
  const handlesOfSameType = allHandles.filter((h) => h.side === handle.side)
  const n = handlesOfSameType.length
  const explicitSlot = Number.isInteger(handle.slotIndex) ? handle.slotIndex : null
  const positionIndex = explicitSlot ?? handlesOfSameType.findIndex((h) => h.uid === handle.uid)
  const safeIndex = positionIndex === -1 ? 0 : positionIndex

  const offset = HANDLE_SPACING * (safeIndex - (n - 1) / 2)

  if (['top', 'bottom'].includes(handle.side)) {
    return { left: `calc(50% + ${offset}px)` }
  }

  return { top: `calc(50% + ${offset}px)` }
}

function parseInstanceNames(connectedInstances) {
  return Array.from(new Set(connectedInstances?.trim().split(/\s+/).filter(Boolean) ?? []))
}

export function findMostCentralGhostHandle(side, allHandles) {
  const handlesOnSide = allHandles.filter((h) => h.side === side)
  const center = (handlesOnSide.length - 1) / 2

  let mostCentral = null
  let smallestDistance = Infinity

  handlesOnSide.forEach((handle, index) => {
    if (handle.variant !== HANDLE_VARIANT.GHOST) return
    const slotIndex = Number.isInteger(handle.slotIndex) ? handle.slotIndex : index
    const distance = Math.abs(slotIndex - center)
    if (distance < smallestDistance) {
      smallestDistance = distance
      mostCentral = handle
    }
  })

  return mostCentral
}

export function buildHandles(instanceRef, ghostHandles) {
  const handles = ghostHandles.map((h) => ({ ...h }))

  const promote = (names, type, side) => {
    names.forEach((name) => {
      const ghost = findMostCentralGhostHandle(side, handles)

      if (!ghost) {
        console.warn(
          `[buildHandles] No free "${side}" ghost slot for "${name}" on instance ` +
            `"${instanceRef.name}" — exceeds the per-edge handle limit. Adding an overflow handle.`
        )
        handles.push({
          uid: crypto.randomUUID(),
          type,
          side,
          name,
          variant: HANDLE_VARIANT.DEFAULT,
        })
        return
      }

      ghost.type = type
      ghost.name = name
      ghost.variant = HANDLE_VARIANT.DEFAULT
    })
  }

  if (instanceRef.inp_instances) {
    promote(parseInstanceNames(instanceRef.inp_instances), TARGET_HANDLE_TYPE, 'top')
  }

  if (instanceRef.out_instances) {
    promote(parseInstanceNames(instanceRef.out_instances), SOURCE_HANDLE_TYPE, 'bottom')
  }

  return handles
}

export function buildGhostHandles(
  countTopBot = NUM_GHOST_HANDLES_TOP_BOT,
  countLeftRight = NUM_GHOST_HANDLES_LEFT_RIGHT,
  activeHandles = []
) {
  const handles = []
  const realHandleCounts = Object.fromEntries(HANDLE_SIDES.map((side) => [side, 0]))

  activeHandles.forEach((handle) => {
    if (!handle || !handle.side || handle.variant === HANDLE_VARIANT.GHOST) return
    if (realHandleCounts[handle.side] !== undefined) {
      realHandleCounts[handle.side] += 1
    }
  })

  HANDLE_SIDES.forEach((side) => {
    let totalSlots = countTopBot
    if (side === 'left' || side === 'right') {
      totalSlots = countLeftRight
    }

    const ghostCount = Math.max(0, totalSlots - realHandleCounts[side])

    for (let i = 0; i < ghostCount; i++) {
      handles.push({
        uid: crypto.randomUUID(),
        side,
        name: '',
        slotIndex: i,
        variant: HANDLE_VARIANT.GHOST,
      })
    }
  })

  return handles
}

/**
 * Gives a loaded super instance or interface node without handles a fresh set of ghosts, as one built new has (see
 * buildSuperInstance). Any other node, or one with handles, is returned as it is.
 *
 * @param {Object} node
 * @returns {Object} The node, copied when handles were added.
 */
export function withHierarchyHandles(node) {
  if (node?.type !== SUPER_INSTANCE_NODE_TYPE && node?.type !== SUPERMODULE_INTERFACE_NODE_TYPE) return node
  if (node.data?.handles?.length) return node
  return { ...node, data: { ...node.data, handles: buildGhostHandles() } }
}

/**
 * Gets the style and corner flag of every handle in one pass.
 *
 * @param {Array<Object>} allHandles - The node's handles.
 * @returns {Map<string, {style: Object, isCorner: boolean}>} Keyed by handle uid.
 */
export function getHandleLayout(allHandles) {
  const bySide = new Map()
  for (const handle of allHandles) {
    if (!bySide.has(handle.side)) bySide.set(handle.side, [])
    bySide.get(handle.side).push(handle)
  }

  const layout = new Map()
  for (const handlesOfSameType of bySide.values()) {
    handlesOfSameType.forEach((handle, index) => {
      layout.set(handle.uid, {
        style: getHandleStyle(handle, handlesOfSameType),
        isCorner: index === 0 || index === handlesOfSameType.length - 1,
      })
    })
  }
  return layout
}

export function isCornerHandle(handle, allHandles) {
  const handlesOfSameType = allHandles.filter((h) => h.side === handle.side)
  const n = handlesOfSameType.length
  const positionIndex = handlesOfSameType.findIndex((h) => h.uid === handle.uid)

  return positionIndex === 0 || positionIndex === n - 1
}

export function reorganiseHandles(nodes, edges) {
  const nodeById = new Map(nodes.map((n) => [n.id, n]))

  const centerOf = (node) => ({
    x: node.position.x + (node.dimensions?.width ?? 0) / 2,
    y: node.position.y + (node.dimensions?.height ?? 0) / 2,
  })

  const neighbourCenter = (node, handle) => {
    const edge = edges.find((e) => e.sourceHandle === getHandleId(handle) || e.targetHandle === getHandleId(handle))
    if (!edge) return null
    const neighbourId = edge.source === node.id ? edge.target : edge.source
    const neighbour = nodeById.get(neighbourId)
    return neighbour ? centerOf(neighbour) : null
  }

  nodes.forEach((node) => {
    if (!node.data.handles) return
    const { x, y } = centerOf(node)

    node.data.handles.forEach((handle) => {
      if (handle.variant !== HANDLE_VARIANT.DEFAULT) return
      const nCenter = neighbourCenter(node, handle)
      if (!nCenter) return

      const dx = nCenter.x - x
      const dy = nCenter.y - y
      const newSide = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'bottom' : 'top'

      if (newSide === handle.side) return

      const ghost = findMostCentralGhostHandle(newSide, node.data.handles)
      if (ghost) {
        const oldSide = handle.side
        ghost.side = oldSide
        handle.side = newSide
      } else {
        console.warn(
          `[reorganiseHandles] No free "${newSide}" ghost slot to swap with on "${node.data.name}" — bucket sizes will be uneven.`
        )
        handle.side = newSide
      }
    })

    const sides = { top: [], right: [], bottom: [], left: [] }
    node.data.handles.forEach((h) => {
      if (sides[h.side]) sides[h.side].push(h)
    })

    Object.entries(sides).forEach(([side, handlesOnSide]) => {
      const isVertical = side === 'left' || side === 'right'

      const active = handlesOnSide
        .filter((h) => h.variant === HANDLE_VARIANT.DEFAULT)
        .sort((a, b) => {
          const ca = neighbourCenter(node, a)
          const cb = neighbourCenter(node, b)
          if (!ca || !cb) return 0
          return isVertical ? ca.y - cb.y : ca.x - cb.x
        })

      const ghosts = handlesOnSide.filter((h) => h.variant === HANDLE_VARIANT.GHOST)

      const n = handlesOnSide.length
      const k = active.length
      const startIdx = Math.max(0, Math.floor((n - k) / 2))

      const reordered = [...ghosts.slice(0, startIdx), ...active, ...ghosts.slice(startIdx)]

      reordered.forEach((handle, index) => {
        handle.slotIndex = index
      })

      sides[side] = reordered
    })

    node.data.handles = normaliseHandleSlots([...sides.top, ...sides.right, ...sides.bottom, ...sides.left])
  })
}
