/**
 * Where a suggested edge runs between two nodes: the sides that face each other, and the points it joins. Accepting
 * the suggestion activates a ghost handle on those same sides.
 */

const OPPOSITE = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }

/**
 * A node's box in flow coordinates; a node in a parent frame is placed by its computed (absolute) position.
 *
 * @param {Object} node - A Vue Flow node.
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
export function nodeRect(node) {
  const position = node?.computedPosition ?? node?.position ?? { x: 0, y: 0 }
  const width = node?.dimensions?.width || node?.width || 0
  const height = node?.dimensions?.height || node?.height || 0
  return { x: position.x ?? 0, y: position.y ?? 0, width: Number(width) || 0, height: Number(height) || 0 }
}

/**
 * The sides of two boxes that face each other: top and bottom when they are further apart vertically, else left
 * and right.
 *
 * @param {{ x: number, y: number, width: number, height: number }} source
 * @param {{ x: number, y: number, width: number, height: number }} target
 * @returns {{ sourceSide: 'top'|'bottom'|'left'|'right', targetSide: 'top'|'bottom'|'left'|'right' }}
 */
export function facingSides(source, target) {
  const dx = target.x + target.width / 2 - (source.x + source.width / 2)
  const dy = target.y + target.height / 2 - (source.y + source.height / 2)
  const sourceSide = Math.abs(dy) >= Math.abs(dx) ? (dy >= 0 ? 'bottom' : 'top') : dx >= 0 ? 'right' : 'left'
  return { sourceSide, targetSide: OPPOSITE[sourceSide] }
}

/**
 * The middle of one side of a box.
 *
 * @param {{ x: number, y: number, width: number, height: number }} rect
 * @param {'top'|'bottom'|'left'|'right'} side
 * @returns {{ x: number, y: number }}
 */
export function sideAnchor(rect, side) {
  switch (side) {
    case 'top':
      return { x: rect.x + rect.width / 2, y: rect.y }
    case 'bottom':
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height }
    case 'left':
      return { x: rect.x, y: rect.y + rect.height / 2 }
    default:
      return { x: rect.x + rect.width, y: rect.y + rect.height / 2 }
  }
}

/**
 * Sides to try for a free handle, the facing one first, then its neighbours, the far side last.
 *
 * @param {'top'|'bottom'|'left'|'right'} side
 * @returns {Array<string>}
 */
export function sidesByPreference(side) {
  const neighbours = side === 'top' || side === 'bottom' ? ['left', 'right'] : ['top', 'bottom']
  return [side, ...neighbours, OPPOSITE[side]]
}
