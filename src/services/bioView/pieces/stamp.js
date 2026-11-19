/**
 * Drops a template's pieces onto the view: copies of them, the workspace's own from then on, each with an id no piece
 * there has yet, standing where the template was dropped.
 */

import { layoutPieces } from './layout.js'
import { validatePieces } from './model.js'

/** The references a piece makes to other pieces, rewritten when ids change. */
function renamed(piece, idOf) {
  const copy = JSON.parse(JSON.stringify(piece))
  copy.id = idOf(piece.id)
  if (copy.parent) copy.parent = idOf(copy.parent)
  if (copy.encloses) copy.encloses = copy.encloses.map(idOf)
  if (copy.ends) copy.ends = copy.ends.map(idOf)
  if (copy.membrane) copy.membrane = idOf(copy.membrane)
  if (copy.compartment) copy.compartment = idOf(copy.compartment)
  if (copy.docks) copy.docks = copy.docks.map((dock) => ({ ...dock, on: idOf(dock.on) }))
  return copy
}

/**
 * An id free among `taken`: the id itself, else it with the first number after it that is free. Ids stay within 32
 * characters.
 */
export function freeId(id, taken) {
  if (!taken.has(id)) return id
  for (let n = 2; ; n++) {
    const suffix = `-${n}`
    const candidate = `${id.slice(0, 32 - suffix.length).replace(/-+$/, '')}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * The view's pieces with a template's added, its corner where it was dropped.
 *
 * @param {ReadonlyArray<Object>} pieces - The view's, validated.
 * @param {{ pieces: ReadonlyArray<Object> }} template - Validated (see validatePiecesTemplate).
 * @param {{x: number, y: number}} at - Where its corner goes, in flow coordinates.
 * @param {{ shapes?: Map<string, Object> }} [options] - The skins' geometry, which sizes what they draw.
 * @returns {{ pieces: ReadonlyArray<Object>|null, ids: Map<string, string>, errors: string[] }} pieces: all of them,
 *   validated; ids: each of the template's ids -> the id its copy has.
 */
export function stampTemplate(pieces, template, at, { shapes = new Map() } = {}) {
  const taken = new Set(pieces.map((piece) => piece.id))
  const ids = new Map()
  for (const piece of template.pieces) {
    const id = freeId(piece.id, taken)
    taken.add(id)
    ids.set(piece.id, id)
  }
  // What stands on the canvas goes where it is drawn in the template, from where it was dropped, so the copy looks
  // as the template does wherever it goes; what stands inside them keeps its place in them.
  const { rects } = layoutPieces(template.pieces, { shapes })
  const corner = (() => {
    const placed = template.pieces
      .filter((piece) => !piece.parent && rects.has(piece.id))
      .map((piece) => rects.get(piece.id))
    return placed.length
      ? { x: Math.min(...placed.map((r) => r.x)), y: Math.min(...placed.map((r) => r.y)) }
      : { x: 0, y: 0 }
  })()
  const idOf = (id) => ids.get(id) ?? id
  const added = template.pieces.map((piece) => {
    const copy = renamed(piece, idOf)
    const standsAlone = !piece.parent && (piece.kind === 'membrane' || (piece.kind === 'compartment' && !piece.docks))
    const rect = rects.get(piece.id)
    // A compartment a membrane fills is drawn by it, and needs no frame of its own.
    const isFilling =
      piece.kind === 'compartment' && template.pieces.some((other) => other.encloses?.includes(piece.id))
    if (standsAlone && rect && !isFilling) {
      copy.frame = {
        x: Math.round(at.x + rect.x - corner.x),
        y: Math.round(at.y + rect.y - corner.y),
        width: Math.round(piece.frame?.width ?? rect.width),
        height: Math.round(piece.frame?.height ?? rect.height),
      }
    }
    return copy
  })
  const { pieces: all, errors } = validatePieces([...pieces, ...added])
  return { pieces: all, ids, errors }
}
