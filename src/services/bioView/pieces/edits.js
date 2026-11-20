/**
 * Edits to the pieces the physiology view is built from: each takes the validated pieces and gives a new raw list,
 * which validatePieces then checks, so an edit never leaves the pieces broken. Each is what a drop of one of the five
 * pieces does (see drops.js).
 */

import { LIMITS, SIDES } from './constants.js'
import { writtenPieces } from './model.js'
import { freeId } from './stamp.js'
import { topologyOf } from './topology.js'

/** How near a compartment's edge must be to its enclosure's to count as meeting it. */
const MEETS = 2

/** A plain copy of the pieces as they are written, to change. */
const copy = writtenPieces

/** The ids of every piece. */
const taken = (pieces) => new Set(pieces.map((piece) => piece.id))

/** A piece's label, numbered after the first of its kind: 'Compartment', 'Compartment 2', ... */
function numbered(pieces, kind, base) {
  const count = pieces.filter((piece) => piece.kind === kind && piece.label.startsWith(base)).length
  return count ? `${base} ${count + 1}` : base
}

/** A frame rounded to whole pixels. */
const whole = ({ x, y, width, height }) => ({
  x: Math.round(x),
  y: Math.round(y),
  width: Math.round(width),
  height: Math.round(height),
})

/**
 * A side's spans as a template writes them, from a membrane's validated spans: each with its `to`, the last
 * without.
 */
const written = (spans) =>
  spans.map(({ from, to, ...span }, index) => (index === spans.length - 1 ? span : { ...span, to }))

/**
 * Cuts a side's spans at `from` and `to`, so the stretch between is a span of its own (a protein site for what is
 * docked there), named `label`. A span the stretch already is, exactly, stays as it is.
 *
 * @param {Array<{id: string, label: string, from: number, to: number}>} spans - The side's, validated.
 * @param {number} from
 * @param {number} to
 * @param {{id: string, label: string}} stretch - The new span's id and name.
 * @param {Set<string>} ids - Span ids in use on the membrane, added to.
 * @returns {Array<Object>} The side's spans, with from and to.
 */
export function splitSpans(spans, from, to, stretch, ids) {
  if (spans.some((span) => span.from === from && span.to === to)) return spans
  const out = [{ id: stretch.id, label: stretch.label, from, to }]
  ids.add(stretch.id)
  for (const span of spans) {
    if (span.to <= from || span.from >= to) {
      out.push(span)
      continue
    }
    // The part before the stretch keeps the span's id, and so does the part after it where there is none before.
    if (span.from < from) out.push({ ...span, to: from })
    if (span.to > to) {
      const id = span.from < from ? freeId(span.id, ids) : span.id
      ids.add(id)
      out.push({ ...span, id, from: to })
    }
  }
  return out.sort((a, b) => a.from - b.from)
}

/**
 * The stretch of a membrane's side free on one face, around a point along it: from the end of the dock before it to
 * the start of the dock after it.
 *
 * @param {ReadonlyArray<Object>} pieces
 * @param {string} membraneId
 * @param {string} side
 * @param {'inside'|'outside'} face
 * @param {number} at - 0 to 1 along the side.
 * @returns {{from: number, to: number}|null} Null when a dock covers the point.
 */
export function freeStretch(pieces, membraneId, side, face, at) {
  const docks = pieces
    .flatMap((piece) => piece.docks ?? [])
    .filter((dock) => dock.on === membraneId && dock.side === side && dock.face === face)
  if (docks.some((dock) => dock.from <= at && at < dock.to)) return null
  const from = Math.max(0, ...docks.filter((dock) => dock.to <= at).map((dock) => dock.to))
  const to = Math.min(1, ...docks.filter((dock) => dock.from > at).map((dock) => dock.from))
  return to > from ? { from, to } : null
}

/**
 * Adds a compartment standing freely: on the canvas, or inside another compartment, at a frame from its corner.
 *
 * @param {ReadonlyArray<Object>} pieces
 * @param {{parent?: string|null, frame: Object, label?: string}} options
 * @returns {{pieces: Array<Object>, id: string}}
 */
export function addCompartment(pieces, { parent = null, frame, label }) {
  const id = freeId('compartment', taken(pieces))
  const piece = {
    id,
    kind: 'compartment',
    label: label ?? numbered(pieces, 'compartment', 'Compartment'),
    ...(parent && { parent }),
    frame: whole(frame),
  }
  return { pieces: [...copy(pieces), piece], id }
}

/**
 * Adds a compartment docked to a stretch of a membrane's side: inside it (as a microdomain is, in the membrane's
 * bulk, or among what it encloses where it has none), or outside it (as a fluid beside a cell is). The stretch becomes
 * a span of its own, the protein site between the compartment and what lies across the membrane.
 *
 * @param {ReadonlyArray<Object>} pieces
 * @param {{membrane: string, side: string, face: 'inside'|'outside', from: number, to: number, label?: string}} options
 * @returns {{pieces: Array<Object>, id: string}}
 */
export function dockCompartment(pieces, { membrane: membraneId, side, face, from, to, label }) {
  const topology = topologyOf(pieces)
  const raw = copy(pieces)
  const membrane = raw.find((piece) => piece.id === membraneId)
  const validated = pieces.find((piece) => piece.id === membraneId)
  const id = freeId(face === 'inside' ? 'microdomain' : 'compartment', taken(pieces))
  const name =
    label ??
    (face === 'inside'
      ? numbered(pieces, 'compartment', 'Microdomain')
      : numbered(pieces, 'compartment', 'Compartment'))
  const bulk = topology.bulkOf(membraneId)
  const piece = {
    id,
    kind: 'compartment',
    label: name,
    // Inside, it stands in the bulk; with none, it is one of what the membrane encloses.
    ...(face === 'inside' ? (bulk ? { parent: bulk } : {}) : membrane.parent ? { parent: membrane.parent } : {}),
    docks: [{ on: membraneId, side, face, ...(from > 0 && { from }), ...(to < 1 && { to }) }],
  }
  if (face === 'inside' && !bulk) membrane.encloses.push(id)
  cutStretch(membrane, validated, side, from, to, id, name)
  return { pieces: [...raw, piece], id }
}

/**
 * Makes the stretch of a membrane's side a compartment is docked to a span of its own: the protein site between that
 * compartment and what lies across the membrane.
 *
 * @param {Object} membrane - The copy, to change.
 * @param {Object} validated - The same membrane, validated, whose spans know where each starts.
 * @param {string} side
 * @param {number} from
 * @param {number} to
 * @param {string} compartmentId - What the span's id is made from.
 * @param {string} name - The compartment's name, in the span's.
 */
function cutStretch(membrane, validated, side, from, to, compartmentId, name) {
  const ids = new Set(
    Object.values(membrane.sides)
      .flat()
      .map((span) => span.id),
  )
  const stretch = { id: freeId(compartmentId, ids), label: `${membrane.label} (${name})` }
  membrane.sides = Object.fromEntries(
    SIDES.map((each) => [
      each,
      // The validated spans know where each starts; the copy's are as written.
      each === side ? written(splitSpans(validated.sides[each], from, to, stretch, ids)) : membrane.sides[each],
    ]),
  )
}

/** Whether a dock is to the same membrane side, or fold, as another. */
const sameTarget = (a, b) => a.on === b.on && (a.side ?? null) === (b.side ?? null)

/**
 * Docks a compartment already docked somewhere to one more membrane side, or fold, as one lying between the two
 * does: a dyadic cleft between a T-tubule and the junctional SR, say. A stretch of a side becomes a protein site of its
 * own, as a first dock's does; a fold's walls are its site already.
 *
 * @param {ReadonlyArray<Object>} pieces - Validated.
 * @param {string} compartmentId
 * @param {{on: string, side?: string, face: 'inside'|'outside', from?: number, to?: number}} dock
 * @returns {{pieces: Array<Object>|null, id: string|null, error?: string}} Raw, for validatePieces.
 */
export function addDock(pieces, compartmentId, dock) {
  const compartment = pieces.find((piece) => piece.id === compartmentId)
  if (compartment?.kind !== 'compartment' || !compartment.docks?.length) {
    return { pieces: null, id: null, error: 'Only a compartment against a membrane can be docked to another.' }
  }
  if (compartment.docks.length >= LIMITS.docks) {
    return { pieces: null, id: null, error: `A compartment can be against at most ${LIMITS.docks} membranes or folds.` }
  }
  if (compartment.docks.some((each) => sameTarget(each, dock))) {
    return { pieces: null, id: null, error: `${compartment.label} is against that already.` }
  }
  const raw = copy(pieces)
  const target = raw.find((piece) => piece.id === dock.on)
  if (target?.kind !== 'membrane' && target?.kind !== 'fold') {
    return { pieces: null, id: null, error: 'It can only be docked to a membrane’s side or a fold.' }
  }
  const from = dock.from ?? 0
  const to = dock.to ?? 1
  const added = {
    on: dock.on,
    ...(target.kind === 'membrane' && { side: dock.side }),
    face: dock.face,
    ...(target.kind === 'membrane' && from > 0 && { from }),
    ...(target.kind === 'membrane' && to < 1 && { to }),
  }
  raw.find((piece) => piece.id === compartmentId).docks.push(added)
  if (target.kind === 'membrane') {
    const validated = pieces.find((piece) => piece.id === dock.on)
    cutStretch(target, validated, dock.side, from, to, compartmentId, compartment.label)
  }
  return { pieces: raw, id: compartmentId }
}

/**
 * Takes one of a compartment's docks away, leaving it against the rest. The span its stretch was cut into stays, a
 * protein site still.
 *
 * @param {ReadonlyArray<Object>} pieces
 * @param {string} compartmentId
 * @param {number} index - Which of its docks.
 * @returns {Array<Object>|null} Null for its only dock, or one it hasn't.
 */
export function removeDock(pieces, compartmentId, index) {
  const raw = copy(pieces)
  const compartment = raw.find((piece) => piece.id === compartmentId)
  if (!compartment?.docks || compartment.docks.length < 2 || !compartment.docks[index]) return null
  compartment.docks.splice(index, 1)
  return raw
}

/**
 * Encloses a compartment, and every compartment joined to it by tubes that stands with it, in a membrane (see
 * tubeGroupOf). One compartment fills the membrane as its bulk; of several, each is docked inside along the sides of
 * the box round them that it meets, so each stretch of membrane meets one of them.
 *
 * @param {ReadonlyArray<Object>} pieces
 * @param {string} compartmentId
 * @param {Map<string, Object>} rects - Where each piece is drawn now (see layoutPieces).
 * @returns {{pieces: Array<Object>|null, id: string|null, error?: string}}
 */
export function encloseCompartment(pieces, compartmentId, rects) {
  const topology = topologyOf(pieces)
  const group = topology.tubeGroupOf(compartmentId)
  if (!group.length) return { pieces: null, id: null, error: 'It is enclosed by a membrane already.' }
  const raw = copy(pieces)
  const byId = new Map(raw.map((piece) => [piece.id, piece]))
  const first = byId.get(compartmentId)
  if (group.some((id) => byId.get(id).docks?.length)) {
    return { pieces: null, id: null, error: 'A compartment docked to a membrane can’t be enclosed by another.' }
  }
  // Where each is, from the corner of what it stands in.
  const corner = first.parent ? rects.get(first.parent) : { x: 0, y: 0 }
  const frameOf = (id) => {
    const rect = rects.get(id)
    return byId.get(id).frame ?? (rect && { ...rect, x: rect.x - corner.x, y: rect.y - corner.y })
  }
  const frames = new Map(group.map((id) => [id, frameOf(id)]))
  if ([...frames.values()].some((frame) => !frame)) return { pieces: null, id: null, error: 'It has no place yet.' }
  const left = Math.min(...[...frames.values()].map((f) => f.x))
  const top = Math.min(...[...frames.values()].map((f) => f.y))
  const right = Math.max(...[...frames.values()].map((f) => f.x + f.width))
  const bottom = Math.max(...[...frames.values()].map((f) => f.y + f.height))
  const box = { x: left, y: top, width: right - left, height: bottom - top }
  const id = freeId(`${compartmentId}-membrane`, taken(pieces))
  const membrane = {
    id,
    kind: 'membrane',
    label: 'Membrane',
    ...(first.parent && { parent: first.parent }),
    encloses: group,
    frame: whole(box),
  }
  if (group.length > 1) {
    // Each docked along the stretches of the box's sides it meets.
    const sides = Object.fromEntries(SIDES.map((side) => [side, []]))
    let loose = 0
    for (const member of group) {
      const frame = frames.get(member)
      const piece = byId.get(member)
      const meets = {
        top: Math.abs(frame.y - top) <= MEETS,
        bottom: Math.abs(frame.y + frame.height - bottom) <= MEETS,
        left: Math.abs(frame.x - left) <= MEETS,
        right: Math.abs(frame.x + frame.width - right) <= MEETS,
      }
      const along = (side) =>
        side === 'top' || side === 'bottom'
          ? [(frame.x - left) / box.width, (frame.x + frame.width - left) / box.width]
          : [(frame.y - top) / box.height, (frame.y + frame.height - top) / box.height]
      const docks = SIDES.filter((side) => meets[side]).map((side) => {
        const [from, to] = along(side).map((value) => Math.min(1, Math.max(0, Math.round(value * 1000) / 1000)))
        const dock = { on: id, side, face: 'inside', from, to }
        sides[side].push({ from, to, member: piece, dock })
        return dock
      })
      if (docks.length) piece.docks = docks
      else loose++
      delete piece.frame
    }
    if (loose > 1)
      return {
        pieces: null,
        id: null,
        error: 'Only one of them may meet none of the sides: lay them out so the rest each reach a side.',
      }
    // With none filling it, the stretches between them go to the nearer, and the ends of each side to the first and
    // last along it, so every stretch of membrane meets one of them.
    if (!loose) {
      for (const side of SIDES) {
        const docked = sides[side].sort((a, b) => a.from - b.from)
        docked.forEach((entry, index) => {
          const next = docked[index + 1]
          if (next && next.from > entry.to)
            entry.to = next.from = Math.round(((entry.to + next.from) / 2) * 1000) / 1000
        })
        if (docked.length) {
          docked[0].from = 0
          docked.at(-1).to = 1
        }
        for (const entry of docked) Object.assign(entry.dock, { from: entry.from, to: entry.to })
      }
    }
    // A dock along a whole side leaves its stretch unsaid.
    for (const member of group) {
      for (const dock of byId.get(member).docks ?? []) {
        if (dock.from === 0) delete dock.from
        if (dock.to === 1) delete dock.to
      }
    }
    // Each side's spans: a stretch per compartment docked there, and whatever is left between.
    membrane.sides = Object.fromEntries(
      SIDES.map((side) => {
        const ids = new Set()
        const next = (base) => {
          const spanId = freeId(base.slice(0, 32), ids)
          ids.add(spanId)
          return spanId
        }
        const spans = []
        let at = 0
        for (const { from, to, member } of sides[side].sort((a, b) => a.from - b.from)) {
          if (from > at) spans.push({ id: next(side), label: `Membrane (${side})`, from: at, to: from })
          spans.push({ id: next(`${member.id}-${side}`), label: `${member.label} membrane`, from, to })
          at = to
        }
        if (at < 1) spans.push({ id: next(side), label: `Membrane (${side})`, from: at, to: 1 })
        return [side, written(spans)]
      }),
    )
  } else delete first.frame
  return { pieces: [...raw, membrane], id }
}

/**
 * Adds a tube between two compartments: a junction between two spaces within one membrane, else a flow.
 *
 * @param {ReadonlyArray<Object>} pieces
 * @param {[string, string]} ends - Upstream first.
 * @returns {{pieces: Array<Object>, id: string}}
 */
export function addTube(pieces, ends) {
  const topology = topologyOf(pieces)
  const id = freeId('tube', taken(pieces))
  const within = (end) => topology.depthOf(end) > 0
  const sameEnclosure = ends.every(within) && topology.depthOf(ends[0]) === topology.depthOf(ends[1])
  const flux = sameEnclosure ? 'junction' : 'flow'
  const label = numbered(pieces, 'tube', flux === 'junction' ? 'Junction' : 'Tube')
  return { pieces: [...copy(pieces), { id, kind: 'tube', label, ends: [...ends], flux }], id }
}

/**
 * Adds a fold to a membrane, dipping in from one side at a point along it.
 *
 * @param {ReadonlyArray<Object>} pieces
 * @param {{membrane: string, side: string, at: number}} options
 * @returns {{pieces: Array<Object>, id: string}}
 */
export function addFold(pieces, { membrane, side, at }) {
  const membranePiece = pieces.find((piece) => piece.id === membrane)
  const ids = taken(pieces)
  for (const span of Object.values(membranePiece.sides).flat()) ids.add(span.id)
  const id = freeId('fold', ids)
  const label = numbered(pieces, 'fold', 'Fold')
  return {
    pieces: [...copy(pieces), { id, kind: 'fold', label, membrane, side, at: Math.round(at * 1000) / 1000 }],
    id,
  }
}

/**
 * Adds a process zone within a compartment, in a row with its others.
 *
 * @param {ReadonlyArray<Object>} pieces
 * @param {string} compartment
 * @returns {{pieces: Array<Object>, id: string}}
 */
export function addZone(pieces, compartment) {
  const id = freeId('zone', taken(pieces))
  const label = numbered(pieces, 'zone', 'Process zone')
  return { pieces: [...copy(pieces), { id, kind: 'zone', label, compartment }], id }
}

/**
 * Renames a piece, or a stretch of a membrane.
 *
 * @param {ReadonlyArray<Object>} pieces
 * @param {string} path - A piece's id, or '<membrane>.<span>'.
 * @param {string} label - Not blank.
 * @returns {Array<Object>|null} Null when there is no such piece or stretch, or the label is blank.
 */
export function relabelPiece(pieces, path, label) {
  const name = String(label ?? '').trim()
  if (!name) return null
  const [id, spanId] = path.split('.')
  const raw = copy(pieces)
  const piece = raw.find((each) => each.id === id)
  if (!piece) return null
  if (spanId === undefined) {
    piece.label = name
    return raw
  }
  for (const side of SIDES) {
    const spans = piece.sides?.[side]
    const span = spans?.find((each) => each.id === spanId)
    if (!span) continue
    span.label = name
    piece.sides[side] = written(spans)
    return raw
  }
  return null
}

/**
 * Draws a membrane or compartment with a skin, or plain.
 *
 * @param {ReadonlyArray<Object>} pieces
 * @param {string} id
 * @param {{ref: string, mode?: string, opacity?: number}|null} skin - Null for none.
 * @returns {Array<Object>|null} Null when there is no such membrane or compartment.
 */
export function skinPiece(pieces, id, skin) {
  const raw = copy(pieces)
  const piece = raw.find((each) => each.id === id && (each.kind === 'membrane' || each.kind === 'compartment'))
  if (!piece) return null
  if (skin) piece.skin = { ...skin }
  else delete piece.skin
  return raw
}

/**
 * What goes with the pieces removed: what stands in them, the tubes to them, the zones in them, the folds on them,
 * the compartments docked to them, and a membrane once all it encloses has gone; each in turn, until nothing more
 * depends on what goes.
 *
 * @param {ReadonlyArray<Object>} pieces
 * @param {Iterable<string>} ids
 * @returns {Set<string>} The ids that go, those asked for among them.
 */
export function removedWith(pieces, ids) {
  const going = new Set(ids)
  const dependsOnGoing = (piece) =>
    going.has(piece.parent) ||
    (piece.kind === 'tube' && piece.ends.some((end) => going.has(end))) ||
    (piece.kind === 'zone' && going.has(piece.compartment)) ||
    (piece.kind === 'fold' && going.has(piece.membrane)) ||
    (piece.docks ?? []).some((dock) => going.has(dock.on)) ||
    (piece.kind === 'membrane' && piece.encloses.every((id) => going.has(id)))
  for (let grew = true; grew;) {
    grew = false
    for (const piece of pieces) {
      if (going.has(piece.id) || !dependsOnGoing(piece)) continue
      going.add(piece.id)
      grew = true
    }
  }
  return going
}

/**
 * Removes pieces, and what goes with them (see removedWith). A membrane removed on its own leaves what it enclosed
 * standing where it was, its inside a compartment of its own the membrane's size.
 *
 * @param {ReadonlyArray<Object>} pieces
 * @param {Iterable<string>} ids
 * @returns {{pieces: Array<Object>, removed: Set<string>}}
 */
export function removePieces(pieces, ids) {
  const removed = removedWith(pieces, ids)
  const topology = topologyOf(pieces)
  const raw = copy(pieces).filter((piece) => !removed.has(piece.id))
  for (const piece of raw) {
    if (piece.kind === 'membrane') piece.encloses = piece.encloses.filter((id) => !removed.has(id))
  }
  // A bulk whose membrane goes keeps the place the membrane had.
  for (const membrane of pieces.filter((piece) => piece.kind === 'membrane' && removed.has(piece.id))) {
    const bulk = raw.find((piece) => piece.id === topology.bulkOf(membrane.id))
    if (bulk && !bulk.frame && membrane.frame) bulk.frame = { ...membrane.frame }
  }
  return { pieces: raw, removed }
}
