/**
 * Where a piece dragged from the palette would go, and what dropping it there would do: one resolver per kind of
 * piece, each reading the view's pieces and where they are drawn, never the screen. The view highlights the target,
 * says what the drop does, and draws the result as a ghost (see previewDrop), worked out again only when the target
 * changes (by its key).
 */

import { EMPTY_SPAN } from '../geometry.js'
import { IMAGE_NEW_SIDE, imageFrameSize } from '../images.js'
import { ROOM_INSIDE, SIDES } from './constants.js'
import {
  addCompartment,
  addDock,
  addFold,
  addImage,
  addTube,
  addZone,
  dockCompartment,
  encloseCompartment,
  freeStretch,
  joinsTwoCells,
} from './edits.js'
import { compartmentsTouch, layoutPieces } from './layout.js'
import { validatePieces } from './model.js'
import { reattachTube } from './moves.js'
import { dockPiece, liftedWith, standPiece, standingIn } from './relocate.js'
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
    hint: 'Joins two compartments, and carries a flux between them: the one it is dropped on and the nearest other, or the two it is dropped between',
  },
  {
    kind: 'fold',
    label: 'Fold',
    icon: 'pi pi-arrow-down',
    hint: 'An invagination of a membrane, such as a T-tubule, in from the side it is dropped on',
  },
  { kind: 'zone', label: 'Process zone', icon: 'pi pi-box', hint: 'An area in a compartment for process modules' },
  {
    kind: 'image',
    label: 'Image',
    icon: 'pi pi-image',
    hint: 'A picture on the bare canvas, only to look at: no part of the model. Place it, then choose its picture; or drop a picture file on the canvas',
  },
])

/** How big an image with no picture yet is drawn: a placeholder to choose one. */
export const EMPTY_IMAGE = Object.freeze({ width: IMAGE_NEW_SIDE, height: (IMAGE_NEW_SIDE * 2) / 3 })

/** How near a membrane's side a compartment or fold must be dropped to go against it, or into it. */
const DOCK_BAND = 28
const FOLD_BAND = 44
/** How far outside a compartment's edge a membrane may be dropped and still go round it. */
const EDGE_BAND = 24
/** How far from the compartment it is dropped on, or nearest, a tube's other end may be. */
const TUBE_REACH = 480
/** The size of what a drop adds standing freely. */
export const SIZES = Object.freeze({
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
 * The scene a drag reads: the pieces and where each is drawn. Worked out once per drag. Given the nodes on the pieces,
 * as the view lays them out, where each is drawn is where the view draws it, and a preview lays them out the same.
 *
 * @param {ReadonlyArray<Object>} pieces - Validated.
 * @param {{ nodes?: Array<Object>, widthOf?: (id: string) => number }} [options] - As for layoutPieces.
 * @returns {{pieces: ReadonlyArray<Object>, rects: Map<string, Object>, byId: Map<string, Object>,
 *   nodes: Array<Object>, widthOf: Function|undefined}}
 */
export function dropScene(pieces, { nodes = [], widthOf } = {}) {
  const { rects, places } = layoutPieces(pieces, { nodes, widthOf })
  // Each fold's lumen, where it is drawn.
  const folds = new Map()
  for (const place of places.values()) {
    for (const fold of place.folds ?? []) folds.set(fold.facetId, foldRect(place.rect, fold))
  }
  return {
    pieces,
    rects,
    folds,
    drawn: drawnShapes(places),
    byId: new Map(pieces.map((piece) => [piece.id, piece])),
    nodes,
    widthOf,
  }
}

/** How near a tube's way a point counts as on it. */
const ON_TUBE = 12

/**
 * What is drawn on the view, for a drop that needs bare canvas: the rect of each cell, compartment, zone and image,
 * and each tube's room and the stretches of its way.
 *
 * @param {Map<string, Object>} places - From layoutPieces.
 * @returns {{rects: Array<Object>, ways: Array<Array<{x: number, y: number}>>}}
 */
function drawnShapes(places) {
  const rects = []
  const ways = []
  for (const place of places.values()) {
    if (place.kind === 'link') {
      if (place.zone) rects.push(place.zone)
      if (place.channel) rects.push(channelRect(place.channel))
      if (place.points) ways.push(place.points)
      else if (!place.zone && place.rect) rects.push(place.rect)
    } else if (['cell', 'region', 'zone', 'image'].includes(place.kind) && place.rect) rects.push(place.rect)
  }
  return { rects, ways }
}

/** A bridge's channel as a rect, its band's width across it. */
const channelRect = ({ from, to }) => ({
  x: Math.min(from.x, to.x) - ON_TUBE,
  y: Math.min(from.y, to.y) - ON_TUBE,
  width: Math.abs(to.x - from.x) + 2 * ON_TUBE,
  height: Math.abs(to.y - from.y) + 2 * ON_TUBE,
})

/** How far a point is from the segment between two others. */
function segmentDistance(point, a, b) {
  const [dx, dy] = [b.x - a.x, b.y - a.y]
  const length = dx * dx + dy * dy
  const t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy))
}

/**
 * Whether a point is on bare canvas: on no cell, compartment, zone, image or tube.
 *
 * @param {Object} scene - From dropScene.
 * @param {{x: number, y: number}} point
 * @returns {boolean}
 */
export function isBareCanvas(scene, point) {
  const { rects, ways } = scene.drawn
  if (rects.some((rect) => contains(rect, point))) return false
  return !ways.some((way) => way.slice(1).some((b, index) => segmentDistance(point, way[index], b) <= ON_TUBE))
}

/** A fold's lumen as a rect, from its membrane's rect and where the fold is in it (see foldPocket). */
function foldRect(rect, fold) {
  const across = fold.edge === 'top' || fold.edge === 'bottom'
  const x = across ? rect.x + fold.at - fold.half : fold.edge === 'left' ? rect.x : rect.x + rect.width - fold.depth
  const y = across ? (fold.edge === 'top' ? rect.y : rect.y + rect.height - fold.depth) : rect.y + fold.at - fold.half
  return { x, y, width: across ? 2 * fold.half : fold.depth, height: across ? fold.depth : 2 * fold.half }
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
 * tie; with the face of it the point is on and how far along it (0 to 1). `allows` passes over the sides it says no
 * to.
 */
function membraneSideAt(scene, point, band, allows = () => true) {
  let best = null
  for (const piece of scene.pieces) {
    if (piece.kind !== 'membrane') continue
    const rect = scene.rects.get(piece.id)
    if (!rect) continue
    const inside = contains(rect, point)
    for (const side of SIDES) {
      if (!allows(piece, side)) continue
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

/** How far down a compartment dropped into another starts at least: below the other's name, in its corner. */
const NAME_ROOM = 56

/** A frame centred on a point, from a rect's corner, kept inside it where it fits, and below its name. */
function frameAt(point, size, within = null) {
  const at = { x: point.x - size.width / 2, y: point.y - size.height / 2 }
  if (!within) return { ...at, ...size }
  const x = Math.max(within.x + ROOM_INSIDE, Math.min(at.x, within.x + within.width - size.width - ROOM_INSIDE))
  const y = Math.max(within.y + NAME_ROOM, Math.min(at.y, within.y + within.height - size.height - ROOM_INSIDE))
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

/** The compartments a compartment stands in, innermost first. */
function ancestorsOf(scene, id) {
  const found = []
  for (let at = scene.byId.get(id)?.parent; at && !found.includes(at) && at !== id; at = scene.byId.get(at)?.parent) {
    found.push(at)
  }
  return found
}

/**
 * How a tube between two compartments joins them, where both are cells. Between two cells apart, only a bridge can,
 * a gap junction needing their membranes to meet. Between two that touch, whether it is a gap junction or a bridge is
 * the user's to say (see placePieceAt): `cells` names them for asking.
 */
function cellJoin(scene, ends) {
  const cells = joinsTwoCells(scene.pieces, ends)
  const apart = cells && !compartmentsTouch(...ends.map((id) => scene.rects.get(id)))
  return { apart, cells: cells && !apart ? ends.map((id) => scene.byId.get(id).label) : undefined }
}

/**
 * A tube joins the compartment it is dropped on to the nearest other, never one it stands in where another is in
 * reach: dropped on a cell among others in a compartment, it joins that cell to the nearest of them. Dropped between
 * compartments standing in one, it joins the nearest two of them, not the one they stand in.
 */
function resolveTube(scene, point) {
  const compartments = scene.pieces.filter((piece) => piece.kind === 'compartment' && scene.rects.get(piece.id))
  const ranked = (candidates) =>
    candidates
      .map((piece) => ({ piece, distance: distanceTo(scene.rects.get(piece.id), point) }))
      .sort((a, b) => a.distance - b.distance || area(scene.rects.get(a.piece.id)) - area(scene.rects.get(b.piece.id)))
  const inReach = (candidates) => ranked(candidates).filter(({ distance }) => distance <= TUBE_REACH)
  const host = compartmentAt(scene, point)
  const inside = host ? inReach(compartments.filter((piece) => piece.parent === host.id)) : []
  let first, second
  if (inside.length >= 2) [first, second] = inside.map(({ piece }) => piece)
  else {
    first = host ?? ranked(compartments)[0]?.piece
    const around = first ? ancestorsOf(scene, first.id) : []
    const others = compartments.filter((piece) => piece.id !== first?.id)
    second = (
      inReach(others.filter((piece) => !around.includes(piece.id)))[0] ??
      inReach(others.filter((piece) => around.includes(piece.id)))[0]
    )?.piece
  }
  if (!first) return { key: 'tube|none', invalid: 'Drop it on or between two compartments.' }
  if (!second) {
    return { key: `tube|${first.id}|none`, invalid: `Nothing else is near enough to ${first.label} to join it to.` }
  }
  const ends = [first.id, second.id]
  const { apart, cells } = cellJoin(scene, ends)
  return {
    key: `tube|${ends.join('|')}`,
    label: apart ? `Bridges ${first.label} to ${second.label}` : `Joins ${first.label} to ${second.label}`,
    highlights: ends.map((id) => ({ type: 'rect', rect: scene.rects.get(id) })),
    ...(cells && { cells }),
    apply: (pieces, { flux = apart ? 'bridge' : undefined } = {}) => addTube(pieces, ends, flux),
  }
}

/**
 * What letting go of a tube's end at a point would do: join that end to the innermost compartment there, carrying
 * what a tube dropped between the two would, as for resolveTube. Null where it is on no compartment, or on the one
 * it joins already; invalid (with why) where it would join the tube's other end to itself.
 *
 * @param {Object} scene - From dropScene.
 * @param {string} tubeId
 * @param {0|1} end - Upstream (0) or downstream (1).
 * @param {{x: number, y: number}} point - In flow coordinates.
 * @returns {{key: string, label?: string, invalid?: string, highlights?: Array<Object>, cells?: [string, string],
 *   apply?: Function}|null} apply(pieces, choice) gives the raw pieces, or null; cells names the two touching cells it
 *   would join, to ask whether by a gap junction or a bridge.
 */
export function resolveTubeEnd(scene, tubeId, end, point) {
  const tube = scene.byId.get(tubeId)
  const target = point && compartmentAt(scene, point)
  if (tube?.kind !== 'tube' || !target || tube.ends[end] === target.id) return null
  const ends = [...tube.ends]
  ends[end] = target.id
  const which = end ? 'downstream' : 'upstream'
  if (ends[0] === ends[1]) {
    return { key: `tube-end|${tubeId}|${end}|${target.id}`, invalid: `A tube can’t join ${target.label} to itself.` }
  }
  const { apart, cells } = cellJoin(scene, ends)
  return {
    key: `tube-end|${tubeId}|${end}|${target.id}`,
    label: `Joins its ${which} end to ${target.label}`,
    highlights: [{ type: 'rect', rect: scene.rects.get(target.id) }],
    ...(cells && { cells }),
    apply: (pieces, { flux = apart ? 'bridge' : undefined } = {}) => reattachTube(pieces, tubeId, end, target.id, flux),
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

/**
 * Where a docked compartment's far edge, dragged to a point, would dock it as well: the wall of a fold, or the side
 * of a membrane, nearest the point, within a band of it. Against a side, it takes the stretch of it that the
 * compartment spans, where that is free, else the free stretch round the point.
 *
 * @param {Object} scene - From dropScene.
 * @param {string} compartmentId - Docked already.
 * @param {{x: number, y: number}} point - In flow coordinates.
 * @returns {Object|null} As resolveDrop's, its apply adding the dock; null where the point is by nothing to dock to.
 */
export function resolveExtraDock(scene, compartmentId, point) {
  const compartment = scene.byId.get(compartmentId)
  if (!compartment?.docks?.length) return null
  const has = (on, side) => compartment.docks.some((dock) => dock.on === on && (dock.side ?? null) === (side ?? null))
  // The nearest fold wall: in its lumen, its outer face; beside it, in the cell, its inner face.
  let fold = null
  for (const [id, rect] of scene.folds ?? []) {
    if (has(id)) continue
    const distance = edgeDistance(rect, point)
    const inLumen = contains(rect, point)
    // Beside its walls means in its cell, not out past its mouth.
    const cell = scene.rects.get(scene.byId.get(id)?.membrane)
    if (distance > DOCK_BAND || (!inLumen && !(cell && contains(cell, point)))) continue
    if (!fold || distance < fold.distance) fold = { id, rect, distance, face: inLumen ? 'outside' : 'inside' }
  }
  const by = membraneSideAt(scene, point, DOCK_BAND, (membrane, side) => !has(membrane.id, side))
  if (fold && (!by || fold.distance <= by.score)) {
    const target = scene.byId.get(fold.id)
    return {
      key: `dock|${compartmentId}|${fold.id}|${fold.face}`,
      label:
        fold.face === 'inside'
          ? `Also against ${target.label}, round its walls`
          : `Also against ${target.label}, in its lumen`,
      highlights: [{ type: 'rect', rect: fold.rect }],
      apply: (pieces) => addDock(pieces, compartmentId, { on: fold.id, face: fold.face }),
    }
  }
  if (!by) return null
  const { membrane, side, face, at, rect } = by
  const free = freeStretch(scene.pieces, membrane.id, side, face, at)
  if (!free) {
    return {
      key: `dock|${compartmentId}|full|${membrane.id}|${side}|${face}`,
      invalid: `A compartment is already against that stretch of ${membrane.label}, on that face.`,
    }
  }
  // The stretch the compartment spans, as far as it is free: it lies across from it.
  const own = scene.rects.get(compartmentId)
  const across = side === 'top' || side === 'bottom'
  const along = (value, start, length) => Math.round(((value - start) / length) * 1000) / 1000
  const spans = own && {
    from: across ? along(own.x, rect.x, rect.width) : along(own.y, rect.y, rect.height),
    to: across ? along(own.x + own.width, rect.x, rect.width) : along(own.y + own.height, rect.y, rect.height),
  }
  let from = spans ? Math.max(free.from, spans.from) : free.from
  let to = spans ? Math.min(free.to, spans.to) : free.to
  // What it would leave of the free stretch either side, too short for an empty span to be drawn in, it takes too:
  // left, the cell would grow until that sliver was long enough.
  const least = EMPTY_SPAN / (across ? rect.width : rect.height)
  if (from - free.from < least) from = free.from
  if (free.to - to < least) to = free.to
  const stretch = to - from > 0.05 && from <= at && at <= to ? { from, to } : free
  return {
    key: `dock|${compartmentId}|${membrane.id}|${side}|${face}|${stretch.from}|${stretch.to}`,
    label:
      face === 'inside'
        ? `Also inside ${membrane.label}, along its ${SIDE_NAMES[side]}`
        : `Also against ${membrane.label}’s ${SIDE_NAMES[side]}, outside`,
    highlights: [sideHighlight(rect, side, stretch.from, stretch.to)],
    apply: (pieces) => addDock(pieces, compartmentId, { on: membrane.id, side, face, ...stretch }),
  }
}

/**
 * What letting go of a piece already on the view at a point would do, lifted from where it is (see relocate.js): a
 * compartment by a membrane's side is docked there, along as much of it as the compartment is long; else the piece
 * stands in the compartment the point is in, or on the view, moved as far as the pointer has. What is lifted with it
 * is no target.
 *
 * @param {Object} scene - From dropScene.
 * @param {string} id - A compartment, a cell's membrane or a process zone.
 * @param {{x: number, y: number}} point - In flow coordinates.
 * @param {{x: number, y: number}} shift - How far the pointer has gone since it took hold of the piece.
 * @returns {Object} As resolveDrop's, with `carried` (the tops lifted, each drawn where it would go by previewDrop)
 *   and `lifted` (the ids of all that goes with it).
 */
export function resolveCarry(scene, id, point, shift) {
  const lifted = liftedWith(scene.pieces, id)
  if (lifted.error) return { key: `carry|${id}|held`, invalid: lifted.error }
  const carry = { carried: lifted.tops, lifted: lifted.ids }
  const name = lifted.label
  const rest = { ...scene, pieces: scene.pieces.filter((piece) => !lifted.ids.has(piece.id)) }
  const by = lifted.kind === 'compartment' && membraneSideAt(rest, point, DOCK_BAND)
  if (by) {
    const { membrane, side, face, at, rect } = by
    const free = freeStretch(rest.pieces, membrane.id, side, face, at)
    if (!free) {
      return {
        key: `carry|${id}|full|${membrane.id}|${side}|${face}`,
        invalid: `A compartment is already against that stretch of ${membrane.label}, on that face.`,
      }
    }
    // As much of the free stretch as it is long, round the point, taking what it would leave too short to use.
    const own = scene.rects.get(id)
    const across = side === 'top' || side === 'bottom'
    const length = across ? rect.width : rect.height
    const share = own ? (across ? own.width : own.height) / length : 1
    let from = Math.max(free.from, Math.min(at - share / 2, free.to - share))
    let to = Math.min(free.to, from + share)
    const least = EMPTY_SPAN / length
    if (from - free.from < least) from = free.from
    if (free.to - to < least) to = free.to
    const fraction = (value) => Math.round(value * 1000) / 1000
    const stretch = to - from > 0.05 ? { from: fraction(from), to: fraction(to) } : free
    return {
      ...carry,
      key: `carry|${id}|dock|${membrane.id}|${side}|${face}|${stretch.from}|${stretch.to}`,
      label:
        face === 'inside'
          ? `Docks ${name} inside ${membrane.label}, along its ${SIDE_NAMES[side]}`
          : `Docks ${name} against ${membrane.label}’s ${SIDE_NAMES[side]}, outside`,
      highlights: [sideHighlight(rect, side, stretch.from, stretch.to)],
      apply: (pieces) => dockPiece(pieces, id, { on: membrane.id, side, face, ...stretch }, scene.rects),
    }
  }
  const host = compartmentAt(rest, point)
  if (lifted.kind === 'zone' && !host) return { key: `carry|${id}|none`, invalid: 'Drop it in a compartment.' }
  const here = standingIn(scene.pieces, lifted.root)
  const docked = !!scene.byId.get(lifted.root)?.docks?.length
  const stays = (host?.id ?? null) === here
  const where = host ? ` in ${host.label}` : ''
  return {
    ...carry,
    key: `carry|${id}|in|${host?.id ?? ''}|${snap(shift)}`,
    label: stays
      ? `${docked ? 'Detaches' : 'Moves'} ${name}${docked ? `, to stand${where || ' on its own'}` : where}`
      : host
        ? `Moves ${name} into ${host.label}`
        : `Moves ${name} out, onto the view`,
    highlights: host ? [{ type: 'rect', rect: scene.rects.get(host.id) }] : [],
    apply: (pieces) => standPiece(pieces, id, { parent: host?.id ?? null, shift }, scene.rects),
  }
}

/**
 * An image goes on bare canvas only, never on a piece or another image, centred where it is dropped, as big as
 * imageFrameSize says.
 *
 * @param {Object} scene
 * @param {{x: number, y: number}} point
 * @param {{picture?: {id: string, width: number, height: number, label?: string}}} [options] - Its picture, where
 *   it has one already (a file dropped from the desktop): its id in the image store, its own size and the name it is
 *   given. Without, it is a placeholder to choose one.
 */
function resolveImage(scene, point, { picture } = {}) {
  if (!isBareCanvas(scene, point)) return { key: 'image|taken', invalid: 'An image goes on bare canvas.' }
  return {
    key: `image|${picture?.id ?? ''}|${snap(point)}`,
    label: picture ? 'An image on the canvas' : 'An image on the canvas, to choose its picture',
    highlights: [],
    apply: (pieces) => {
      const size = picture ? imageFrameSize(picture) : EMPTY_IMAGE
      const frame = { x: Math.round(point.x - size.width / 2), y: Math.round(point.y - size.height / 2), ...size }
      return addImage(pieces, { image: picture?.id, frame, label: picture?.label })
    },
  }
}

const RESOLVERS = {
  compartment: resolveCompartment,
  membrane: resolveMembrane,
  tube: resolveTube,
  fold: resolveFold,
  zone: resolveZone,
  image: resolveImage,
}

/**
 * Works out what dropping a piece at a point would do.
 *
 * @param {'compartment'|'membrane'|'tube'|'fold'|'zone'|'image'} kind
 * @param {{x: number, y: number}} point - In flow coordinates.
 * @param {Object} scene - From dropScene.
 * @param {Object} [options] - For an image, the picture chosen already (see resolveImage).
 * @returns {{key: string, label: string, highlights: Array<Object>, apply: Function, cells?: [string, string]}|
 *   {key: string, invalid: string}} apply(pieces, choice) gives { pieces, id } (raw, for validatePieces) or
 *   { pieces: null, error }; highlights are lines ({type: 'line', from, to}) or rects ({type: 'rect', rect}) to draw
 *   over the target; cells, a tube's, names the two touching cells it would join, as a gap junction or a bridge.
 */
export function resolveDrop(kind, point, scene, options) {
  const resolve = RESOLVERS[kind]
  return resolve ? resolve(scene, point, options) : { key: `${kind}|unknown`, invalid: 'That is not a piece.' }
}

/** The box round the compartments already there that a new membrane encloses, or null where it encloses none. */
function enclosedBox(scene, pieces, membraneId) {
  const rects = (pieces.find((piece) => piece.id === membraneId)?.encloses ?? [])
    .map((id) => scene.rects.get(id))
    .filter(Boolean)
  if (!rects.length) return null
  const x = Math.min(...rects.map((rect) => rect.x))
  const y = Math.min(...rects.map((rect) => rect.y))
  const width = Math.max(...rects.map((rect) => rect.x + rect.width)) - x
  const height = Math.max(...rects.map((rect) => rect.y + rect.height)) - y
  return { x, y, width, height }
}

/** The places of pieces already there whose growing a preview shows: a compartment standing freely, and a cell. */
const GROWING_KINDS = new Set(['region', 'cell'])

/** Whether a rect is wider or taller than another, by more than rounding: moved alone, it has not grown. */
const isLarger = (rect, than) => rect.width > than.width + 0.5 || rect.height > than.height + 0.5

/** Whether a rect is somewhere else than another, by more than rounding. */
const isMoved = (rect, than) => Math.abs(rect.x - than.x) > 0.5 || Math.abs(rect.y - than.y) > 0.5

/** Whether a rect reaches past another on any side, by more than rounding. */
const isBigger = (rect, than) =>
  rect.x < than.x - 0.5 ||
  rect.y < than.y - 0.5 ||
  rect.x + rect.width > than.x + than.width + 0.5 ||
  rect.y + rect.height > than.y + than.height + 0.5

/**
 * The pieces a drop would leave, validated, and what it adds drawn as ghosts.
 *
 * @param {Object} scene - From dropScene.
 * @param {Object} drop - From resolveDrop, not invalid.
 * @param {Object} [choice] - What the user chose for it, passed to its apply: a tube's flux, between two cells.
 * @returns {{pieces: ReadonlyArray<Object>|null, id: string|null, ghosts: Array<Object>, errors: string[]}} ghosts:
 *   {type: 'rect', rect, kind} for each piece added, {type: 'path', points} for a tube's way ({type: 'conduit',
 *   points} for one drawn as a vessel, with no rect), {type: 'fold', ...} for
 *   a fold (its lumen's rect). A membrane round compartments already there says what they took (`was`, the box round
 *   them) and whether the cell it makes is bigger than that (`grows`). A compartment or cell already there that the
 *   drop makes bigger is {type: 'grows', kind, label, rect, was}, and one it pushes out of the way {type: 'moves', ...},
 *   first, so what is added is drawn over them.
 */
export function previewDrop(scene, drop, choice) {
  const result = drop.apply(scene.pieces, choice)
  if (!result.pieces) return { pieces: null, id: null, ghosts: [], errors: [result.error ?? 'It can’t go there.'] }
  const { pieces, errors } = validatePieces(result.pieces)
  if (!pieces) return { pieces: null, id: null, ghosts: [], errors }
  const before = new Set(scene.pieces.map((piece) => piece.id))
  const { places } = layoutPieces(pieces, { nodes: scene.nodes, widthOf: scene.widthOf })
  const ghosts = []
  const grown = []
  for (const place of places.values()) {
    // A grip is a handle on a piece, not part of it, and a membrane's band is drawn by its cell.
    if (place.kind === 'grip' || place.kind === 'membrane') continue
    if (drop.lifted?.has(place.piece)) {
      // A piece carried somewhere else is drawn where it would go, what goes with it left to follow.
      if (drop.carried.includes(place.piece) && place.rect) {
        ghosts.push({ type: 'rect', kind: place.kind, rect: place.rect })
      }
      continue
    }
    if (before.has(place.piece)) {
      // A compartment or cell made bigger to fit what the drop adds, or pushed out of the way of one that is.
      const was = GROWING_KINDS.has(place.kind) && scene.rects.get(place.piece)
      if (was && place.rect && isMoved(place.rect, was)) {
        grown.push({ type: 'moves', kind: place.kind, label: place.label, rect: place.rect, was })
      } else if (was && place.rect && isLarger(place.rect, was)) {
        grown.push({ type: 'grows', kind: place.kind, label: place.label, rect: place.rect, was })
      }
      // A membrane already there with a fold added.
      for (const fold of place.folds ?? []) {
        if (!before.has(fold.facetId)) ghosts.push({ type: 'rect', kind: 'fold', rect: foldRect(place.rect, fold) })
      }
      continue
    }
    // A conduit is drawn as a vessel along its way, with no card: its ghost is that vessel, as BioConduit draws it.
    if (place.conduit) {
      ghosts.push({ type: 'conduit', kind: place.kind, points: place.points })
      continue
    }
    if (place.points) ghosts.push({ type: 'path', points: place.points })
    const rect = place.zone ?? place.rect
    const was = place.kind === 'cell' ? enclosedBox(scene, pieces, place.piece) : null
    ghosts.push({ type: 'rect', kind: place.kind, rect, ...(was && { was, grows: isBigger(rect, was) }) })
  }
  return { pieces, id: result.id, ghosts: [...grown, ...ghosts], errors: [] }
}
