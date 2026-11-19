/**
 * Where a piece dragged from the palette would go, and what dropping it there would do: one resolver per kind of
 * piece, each reading the view's pieces and where they are drawn, never the screen. The view highlights the target,
 * says what the drop does, and draws the result as a ghost (see previewDrop), worked out again only when the target
 * changes (by its key).
 */

import { SIDES } from './constants.js'
import { addCompartment, addFold, addTube, addZone, dockCompartment, encloseCompartment, freeStretch } from './edits.js'
import { layoutPieces } from './layout.js'
import { validatePieces } from './model.js'
import { topologyOf } from './topology.js'

/** The kinds of piece the palette offers, in its order. */
export const PIECE_TILES = Object.freeze([
  {
    kind: 'compartment',
    label: 'Compartment',
    icon: 'pi pi-stop',
    hint: 'A space: on the view, inside another, or docked against a side of a membrane, inside or out',
  },
  {
    kind: 'membrane',
    label: 'Membrane',
    icon: 'pi pi-circle',
    hint: 'Round the compartment it is dropped on, with all the compartments tubes join to it: a cell, or an organelle for one inside a cell',
  },
  {
    kind: 'tube',
    label: 'Tube',
    icon: 'pi pi-arrows-h',
    hint: 'Joins two compartments, and carries a flux between them: the one it is dropped on and the nearest other',
  },
  {
    kind: 'fold',
    label: 'Fold',
    icon: 'pi pi-arrow-down',
    hint: 'An invagination of a membrane, such as a T-tubule, in from the side it is dropped on',
  },
  { kind: 'zone', label: 'Process zone', icon: 'pi pi-box', hint: 'An area in a compartment for process modules' },
])

/** How near a membrane's side a compartment or fold must be dropped to go against it, or into it. */
const DOCK_BAND = 28
const FOLD_BAND = 44
/** How far outside a compartment's edge a membrane may be dropped and still go round it. */
const EDGE_BAND = 24
/** How far from the compartment it is dropped on, or nearest, a tube's other end may be. */
const TUBE_REACH = 480
/** The size of what a drop adds standing freely. */
const SIZES = Object.freeze({
  compartment: { width: 320, height: 140 },
  subcompartment: { width: 200, height: 120 },
})

const contains = (rect, { x, y }) => x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height
const area = (rect) => rect.width * rect.height
/** How far a point is from a rect: 0 inside it. */
const distanceTo = (rect, point) =>
  Math.hypot(
    Math.max(rect.x - point.x, 0, point.x - rect.x - rect.width),
    Math.max(rect.y - point.y, 0, point.y - rect.y - rect.height),
  )
/** How far a point is from a rect's outline, in or out. */
const edgeDistance = (rect, point) => {
  if (!contains(rect, point)) return distanceTo(rect, point)
  return Math.min(point.x - rect.x, rect.x + rect.width - point.x, point.y - rect.y, rect.y + rect.height - point.y)
}
/** Rounds a point, so a drop that moves only a little keeps the same key. */
const snap = ({ x, y }) => `${Math.round(x / 8) * 8},${Math.round(y / 8) * 8}`

/**
 * The scene a drag reads: the pieces and where each is drawn. Worked out once per drag.
 *
 * @param {ReadonlyArray<Object>} pieces - Validated.
 * @param {{ shapes?: Map<string, Object> }} [options]
 * @returns {{pieces: ReadonlyArray<Object>, rects: Map<string, Object>, byId: Map<string, Object>, shapes: Map}}
 */
export function dropScene(pieces, { shapes = new Map() } = {}) {
  const { rects } = layoutPieces(pieces, { shapes })
  return { pieces, rects, byId: new Map(pieces.map((piece) => [piece.id, piece])), shapes }
}

/**
 * The compartment a point is in: the smallest of those drawn round it.
 *
 * @param {Object} scene - From dropScene.
 * @param {{x: number, y: number}} point
 * @returns {Object|null}
 */
export function compartmentAtPoint(scene, point) {
  return compartmentAt(scene, point)
}

function compartmentAt(scene, point) {
  return (
    scene.pieces
      .filter(
        (piece) =>
          piece.kind === 'compartment' && scene.rects.get(piece.id) && contains(scene.rects.get(piece.id), point),
      )
      .sort((a, b) => area(scene.rects.get(a.id)) - area(scene.rects.get(b.id)))[0] ?? null
  )
}

/**
 * The side of a membrane a point is by, within a band either side of it: the nearest, the innermost membrane's on a
 * tie; with the face of it the point is on and how far along it (0 to 1).
 */
function membraneSideAt(scene, point, band) {
  let best = null
  for (const piece of scene.pieces) {
    if (piece.kind !== 'membrane') continue
    const rect = scene.rects.get(piece.id)
    if (!rect) continue
    const inside = contains(rect, point)
    for (const side of SIDES) {
      const across = side === 'top' || side === 'bottom'
      const line = { top: rect.y, bottom: rect.y + rect.height, left: rect.x, right: rect.x + rect.width }[side]
      const distance = Math.abs((across ? point.y : point.x) - line)
      const along = across ? (point.x - rect.x) / rect.width : (point.y - rect.y) / rect.height
      if (distance > band || along < 0 || along > 1) continue
      const outward = { top: point.y < line, bottom: point.y > line, left: point.x < line, right: point.x > line }[side]
      const face = inside && !outward ? 'inside' : 'outside'
      const score = distance + area(rect) * 1e-9
      if (!best || score < best.score) best = { membrane: piece, side, face, at: along, score, rect }
    }
  }
  return best
}

/** A frame centred on a point, from a rect's corner, kept inside it where it fits. */
function frameAt(point, size, within = null) {
  const at = { x: point.x - size.width / 2, y: point.y - size.height / 2 }
  if (!within) return { ...at, ...size }
  const x = Math.max(within.x + 12, Math.min(at.x, within.x + within.width - size.width - 12))
  const y = Math.max(within.y + 12, Math.min(at.y, within.y + within.height - size.height - 12))
  return { x: x - within.x, y: y - within.y, ...size }
}

/** A side's stretch as a highlight: the line along it. */
function sideHighlight(rect, side, from, to) {
  if (side === 'top' || side === 'bottom') {
    const y = side === 'top' ? rect.y : rect.y + rect.height
    return { type: 'line', from: { x: rect.x + from * rect.width, y }, to: { x: rect.x + to * rect.width, y } }
  }
  const x = side === 'left' ? rect.x : rect.x + rect.width
  return { type: 'line', from: { x, y: rect.y + from * rect.height }, to: { x, y: rect.y + to * rect.height } }
}

const SIDE_NAMES = { top: 'top', bottom: 'bottom', left: 'left side', right: 'right side' }

function resolveCompartment(scene, point) {
  const by = membraneSideAt(scene, point, DOCK_BAND)
  if (by) {
    const { membrane, side, face, at, rect } = by
    const stretch = freeStretch(scene.pieces, membrane.id, side, face, at)
    if (!stretch) {
      return {
        key: `compartment|full|${membrane.id}|${side}|${face}`,
        invalid: `A compartment is already against that stretch of ${membrane.label}, on that face.`,
      }
    }
    return {
      key: `compartment|dock|${membrane.id}|${side}|${face}|${stretch.from}`,
      label:
        face === 'inside'
          ? `Inside ${membrane.label}, along its ${SIDE_NAMES[side]}`
          : `Against ${membrane.label}’s ${SIDE_NAMES[side]}, outside`,
      highlights: [sideHighlight(rect, side, stretch.from, stretch.to)],
      apply: (pieces) => dockCompartment(pieces, { membrane: membrane.id, side, face, ...stretch }),
    }
  }
  const host = compartmentAt(scene, point)
  if (host) {
    const rect = scene.rects.get(host.id)
    return {
      key: `compartment|in|${host.id}|${snap(point)}`,
      label: `A compartment in ${host.label}`,
      highlights: [{ type: 'rect', rect }],
      apply: (pieces) => addCompartment(pieces, { parent: host.id, frame: frameAt(point, SIZES.subcompartment, rect) }),
    }
  }
  return {
    key: `compartment|free|${snap(point)}`,
    label: 'A compartment',
    highlights: [],
    apply: (pieces) => addCompartment(pieces, { frame: frameAt(point, SIZES.compartment) }),
  }
}

/**
 * A membrane goes only round a compartment, as a zone goes only in one: the one it is dropped on, or by the edge of,
 * with those tubes join to it. Round one standing freely it makes a cell; round one inside a cell, an organelle.
 */
function resolveMembrane(scene, point) {
  const topology = topologyOf(scene.pieces)
  // The innermost compartment it is on or just outside the edge of decides: an outer one is never enclosed past it.
  const target = scene.pieces
    .filter((piece) => piece.kind === 'compartment')
    .map((piece) => ({ piece, rect: scene.rects.get(piece.id) }))
    .filter(({ rect }) => rect && (contains(rect, point) || edgeDistance(rect, point) <= EDGE_BAND))
    .sort((a, b) => area(a.rect) - area(b.rect))[0]?.piece
  if (!target) return { key: 'membrane|none', invalid: 'Drop it on a compartment, to enclose it.' }
  if (topology.enclosureOf(target.id)) {
    return {
      key: `membrane|enclosed|${target.id}`,
      invalid: `${target.label} has a membrane already. Drop it on a compartment inside it, to make an organelle.`,
    }
  }
  if (target.docks?.length) {
    return {
      key: `membrane|docked|${target.id}`,
      invalid: `${target.label} is against a membrane, so it can’t be enclosed by another.`,
    }
  }
  const group = topology.tubeGroupOf(target.id)
  const names = group.map((id) => scene.byId.get(id).label)
  const listed = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]
  return {
    key: `membrane|enclose|${target.id}`,
    label: `Encloses ${listed}`,
    highlights: group.map((id) => ({ type: 'rect', rect: scene.rects.get(id) })).filter((h) => h.rect),
    apply: (pieces) => encloseCompartment(pieces, target.id, scene.rects),
  }
}

function resolveTube(scene, point) {
  const compartments = scene.pieces.filter((piece) => piece.kind === 'compartment' && scene.rects.get(piece.id))
  const nearest = (except = []) =>
    compartments
      .filter((piece) => !except.includes(piece.id))
      .map((piece) => ({ piece, distance: distanceTo(scene.rects.get(piece.id), point) }))
      .sort(
        (a, b) => a.distance - b.distance || area(scene.rects.get(a.piece.id)) - area(scene.rects.get(b.piece.id)),
      )[0]
  const first = compartmentAt(scene, point) ?? nearest()?.piece
  const second = first && nearest([first.id])
  if (!first || !second || second.distance > TUBE_REACH) {
    return { key: 'tube|none', invalid: 'Drop it on or between two compartments.' }
  }
  const ends = [first.id, second.piece.id]
  return {
    key: `tube|${ends.join('|')}`,
    label: `Joins ${first.label} to ${second.piece.label}`,
    highlights: ends.map((id) => ({ type: 'rect', rect: scene.rects.get(id) })),
    apply: (pieces) => addTube(pieces, ends),
  }
}

function resolveFold(scene, point) {
  const by = membraneSideAt(scene, point, FOLD_BAND)
  if (!by) return { key: 'fold|none', invalid: 'Drop it on a side of a membrane.' }
  const { membrane, side, at, rect } = by
  const step = Math.round(at * 40) / 40
  return {
    key: `fold|${membrane.id}|${side}|${step}`,
    label: `Folds ${membrane.label} in from its ${SIDE_NAMES[side]}`,
    highlights: [sideHighlight(rect, side, Math.max(0, step - 0.04), Math.min(1, step + 0.04))],
    apply: (pieces) => addFold(pieces, { membrane: membrane.id, side, at: step }),
  }
}

function resolveZone(scene, point) {
  const host = compartmentAt(scene, point)
  if (!host) return { key: 'zone|none', invalid: 'Drop it in a compartment.' }
  return {
    key: `zone|${host.id}`,
    label: `A process zone in ${host.label}`,
    highlights: [{ type: 'rect', rect: scene.rects.get(host.id) }],
    apply: (pieces) => addZone(pieces, host.id),
  }
}

const RESOLVERS = {
  compartment: resolveCompartment,
  membrane: resolveMembrane,
  tube: resolveTube,
  fold: resolveFold,
  zone: resolveZone,
}

/**
 * Works out what dropping a piece at a point would do.
 *
 * @param {'compartment'|'membrane'|'tube'|'fold'|'zone'} kind
 * @param {{x: number, y: number}} point - In flow coordinates.
 * @param {Object} scene - From dropScene.
 * @returns {{key: string, label: string, highlights: Array<Object>, apply: Function}|{key: string, invalid: string}}
 *   apply(pieces) gives { pieces, id } (raw, for validatePieces) or { pieces: null, error }; highlights are lines
 *   ({type: 'line', from, to}) or rects ({type: 'rect', rect}) to draw over the target.
 */
export function resolveDrop(kind, point, scene) {
  const resolve = RESOLVERS[kind]
  return resolve ? resolve(scene, point) : { key: `${kind}|unknown`, invalid: 'That is not a piece.' }
}

/**
 * The pieces a drop would leave, validated, and what it adds drawn as ghosts.
 *
 * @param {Object} scene - From dropScene.
 * @param {Object} drop - From resolveDrop, not invalid.
 * @returns {{pieces: ReadonlyArray<Object>|null, id: string|null, ghosts: Array<Object>, errors: string[]}} ghosts:
 *   {type: 'rect', rect, kind} for each piece added, {type: 'path', points} for a tube's way, {type: 'fold', ...} for
 *   a fold (its lumen's rect).
 */
export function previewDrop(scene, drop) {
  const result = drop.apply(scene.pieces)
  if (!result.pieces) return { pieces: null, id: null, ghosts: [], errors: [result.error ?? 'It can’t go there.'] }
  const { pieces, errors } = validatePieces(result.pieces)
  if (!pieces) return { pieces: null, id: null, ghosts: [], errors }
  const before = new Set(scene.pieces.map((piece) => piece.id))
  const { places } = layoutPieces(pieces, { shapes: scene.shapes })
  const ghosts = []
  for (const place of places.values()) {
    // A grip is a handle on a piece, not part of it.
    if (place.kind === 'grip') continue
    if (before.has(place.piece)) {
      // A membrane already there with a fold added.
      for (const fold of place.folds ?? []) {
        if (before.has(fold.facetId)) continue
        const { rect } = place
        const across = fold.edge === 'top' || fold.edge === 'bottom'
        const x = across
          ? rect.x + fold.at - fold.half
          : fold.edge === 'left'
            ? rect.x
            : rect.x + rect.width - fold.depth
        const y = across
          ? fold.edge === 'top'
            ? rect.y
            : rect.y + rect.height - fold.depth
          : rect.y + fold.at - fold.half
        ghosts.push({
          type: 'rect',
          kind: 'fold',
          rect: { x, y, width: across ? 2 * fold.half : fold.depth, height: across ? fold.depth : 2 * fold.half },
        })
      }
      continue
    }
    if (place.points) ghosts.push({ type: 'path', points: place.points })
    ghosts.push({ type: 'rect', kind: place.kind, rect: place.zone ?? place.rect })
  }
  return { pieces, id: result.id, ghosts, errors: [] }
}
