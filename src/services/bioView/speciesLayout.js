/**
 * Where species mode draws the species network (see species.js) over the physiological view: a token for each
 * species a compartment shows, and a path for each way a protein carries one across its membrane. A region's
 * tokens go towards its edge away from the cells, a cell's in a row across its middle; each sits under or over the
 * proteins its paths run to (midway between them), nudged along so none overlap, and the rest are split between
 * the two ends of the row so it sits evenly in the compartment. Tokens keep inside the membrane and clear of
 * names, cartoons and process zones, wrapping onto more rows where one is too long. A compartment whose tokens the
 * user put in order keeps those places, filled in that order. Paths run from a token to the
 * protein's face on that side and stop there, as the cartoon shows what crosses; so does a dependence, ending in an
 * open circle.
 */

import { facePoint } from './faces.js'
import { GLYPH_HEIGHT, GLYPH_WIDTH, HEAD_OFFSET, partOf, proteinLabelWidth } from './geometry.js'
import { DEFAULT_ARROW_ROOM } from './glyphLibrary.js'
import { CARD } from './layout.js'
import { CELL_RADIUS, FACET_BAND } from './metrics.js'
import { EPITHELIAL_SHAPE, facetById } from './shape.js'

/** A token's height, and the space between two in a row. */
export const TOKEN = { height: 22, gap: 8 }
/** How far from a region's far edge its tokens' centres sit, as a share of its depth. */
const REGION_DEPTH = 0.42
/** How far a path leaves a face or token before it bends. */
const BEND = 40
/** The thinnest and thickest a path is drawn, its width following the size of its flow after a run. */
const WIDTH = { min: 1.5, max: 5 }

/** The radius of the open circle a dependence link ends in at its protein (SBGN's modulation). */
export const DEPENDENCE_END = 4

/**
 * An arrowhead's length and width for a path of a width, so a thick line never covers it.
 *
 * @param {number} width - The path's.
 * @returns {number}
 */
export const arrowHead = (width) => Math.round((6 + 2 * width) * 10) / 10

/**
 * A token's width for its label.
 *
 * @param {string} label
 * @returns {number}
 */
export const tokenWidth = (label) => Math.round(18 + 7.5 * [...label].length)

/** Orders by label, then as given, so tokens that want the same place come out the same way round every time. */
const byLabel = (a, b) => {
  const [x, y] = [a.label ?? '', b.label ?? '']
  return x < y ? -1 : x > y ? 1 : a.index - b.index
}

const centreOf = (rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })

/**
 * Spreads items along a line so none overlap: each starts where it wants, the run is moved back over where they
 * wanted to be, then kept within bounds where it fits.
 *
 * @param {Array<{want: number, size: number}>} items - Wanted centres and sizes along the line.
 * @param {number} gap
 * @param {[number, number]} bounds
 * @returns {number[]} Each item's centre, in the order given.
 */
export function spreadAlong(items, gap, [low, high]) {
  const order = items.map((item, index) => ({ ...item, index })).sort((a, b) => a.want - b.want || byLabel(a, b))
  const at = []
  for (const [i, item] of order.entries()) {
    const previous = order[i - 1]
    at[i] = previous ? Math.max(item.want, at[i - 1] + (previous.size + item.size) / 2 + gap) : item.want
  }
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1)
  let shift = mean(order.map((item) => item.want)) - mean(at)
  const first = at[0] + shift - order[0]?.size / 2
  const last = at[at.length - 1] + shift + order[order.length - 1]?.size / 2
  if (last - first <= high - low) shift += Math.max(0, low - first) - Math.max(0, last - high)
  const centres = []
  for (const [i, item] of order.entries()) centres[item.index] = at[i] + shift
  return centres
}

/** How far in from a cell's outline its tokens stay: past the bilayer's inner head groups, and a margin. */
export const CELL_INSET = 32
/** How far in from a region's edge its tokens stay. */
export const REGION_INSET = 16
/** Space kept between a token and anything else drawn in its compartment. */
const CLEARANCE = 6
/** A row whose tokens, side by side, take more than this share of its space is centred in it. */
const CENTRE_SHARE = 0.7
/** How far a block of rows is moved at a time when looking for somewhere clear. */
const STEP = 2
/** Rough sizes of the names the view draws, so tokens can keep clear of them. */
const TEXT = {
  cell: { char: 8.5, height: 20 },
  hint: { width: 90, height: 16 },
  region: { char: 8.5, height: 20, padding: { x: 12, y: 8 } },
  protein: { height: 16, detailHeight: 12, gap: 4 },
  facet: { char: 6, height: 12, padding: 4 },
}

const box = (x, y, width, height) => ({ x, y, width, height })
const grow = (rect, by) => box(rect.x - by, rect.y - by, rect.width + 2 * by, rect.height + 2 * by)
const overlap = (a, b) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
const sum = (values) => values.reduce((total, value) => total + value, 0)
const mean = (values) => (values.length ? sum(values) / values.length : null)

/**
 * The boxes a membrane protein takes: its cartoon, and its name (and what it carries) on the cell's side of it.
 *
 * @param {Object} place - The protein's, from layoutPhysiology.
 * @param {{name?: string, detail?: string}} [label]
 * @returns {[Object, Object]} The cartoon's box and the name's.
 */
export function proteinBoxes(place, { name = '', detail = '' } = {}) {
  const sideways = place.outward === 'left' || place.outward === 'right'
  const [w, h] = sideways ? [GLYPH_HEIGHT, GLYPH_WIDTH] : [GLYPH_WIDTH, GLYPH_HEIGHT]
  const glyph = box(place.x - w / 2, place.y - h / 2, w, h)
  const { height, detailHeight, gap } = TEXT.protein
  const width = proteinLabelWidth(name, detail)
  const tall = height + (detail ? detailHeight : 0)
  const label = {
    top: box(place.x - width / 2, glyph.y + h + gap, width, tall),
    bottom: box(place.x - width / 2, glyph.y - gap - tall, width, tall),
    left: box(glyph.x + w + gap, place.y - tall / 2, width, tall),
    right: box(glyph.x - gap - width, place.y - tall / 2, width, tall),
  }[place.outward] ?? box(place.x - width / 2, glyph.y + h + gap, width, tall)
  return [glyph, label]
}

/** How far a cell's name is moved at a time when looking for a clear corner. */
const NAME_STEP = 4
/** How far along a cell, as a share of its width, its name may move from a corner to keep clear. */
const CORNER = 0.3
/** How far in from the membrane its name may move: a little, so it never reads as a protein's name above it. */
const NAME_DROP = 12

/**
 * Where a cell's name is drawn: in its upper-left corner inside the membrane, moved in from it until clear of the
 * proteins (with their names), process zones and cards drawn there; failing that, likewise in its lower-left,
 * and failing both, right in the lower-left. (An empty template cell's is centred by BioCell, with its hint.)
 *
 * @param {string} cellId
 * @param {Map<string, Object>} layout - From layoutPhysiology.
 * @param {(id: string) => {name?: string, detail?: string}|undefined} [labelOf] - As for obstaclesOf.
 * @returns {Object|null} Its box, or nothing for a cell with no name.
 */
export function cellNameBox(cellId, layout, labelOf = () => undefined) {
  const place = layout.get(cellId)
  const name = labelOf(cellId)?.name ?? ''
  if (!place || !name) return null
  const { rect } = place
  const width = [...name].length * TEXT.cell.char + 8
  const height = TEXT.cell.height
  const others = [...(place.zones ?? []).map((zone) => zone.rect)]
  for (const [id, other] of layout) {
    if (other.cell !== cellId) continue
    if (other.kind === 'protein') others.push(...proteinBoxes(other, labelOf(id)))
    if (other.kind === 'cytosolic') others.push(box(other.x, other.y, CARD.width, CARD.height))
  }
  const [left, top] = [rect.x + CELL_INSET, rect.y + CELL_INSET]
  const bottom = rect.y + rect.height - CELL_INSET - height
  // The name stays in a corner or tries the next.
  const [reachX, reachY] = [rect.width * CORNER - CELL_INSET, NAME_DROP]
  const clear = (candidate) => others.every((other) => !overlap(grow(candidate, CLEARANCE / 2), other))
  const steps = (reach) => Array.from({ length: Math.max(0, Math.floor(reach / NAME_STEP)) + 1 }, (_, i) => i)
  // Nearest the corner first, moving in from it down (or up) and across.
  const inCorner = (y0, way) => {
    const spots = steps(reachY).flatMap((i) => steps(reachX).map((j) => ({ i, j })))
    spots.sort((a, b) => a.i + a.j - (b.i + b.j) || a.i - b.i)
    return spots
      .map(({ i, j }) => box(left + j * NAME_STEP, y0 + way * i * NAME_STEP, width, height))
      .find(clear)
  }
  return inCorner(top, 1) ?? inCorner(bottom, -1) ?? box(left, bottom, width, height)
}

/** How far an empty cell's name and hint are moved at a time when looking for somewhere clear. */
const HINT_STEP = 8

/**
 * Where an empty template cell's name and its "Drop a module" hint are drawn: where cellHint puts them, or, if
 * that would cover a protein or its name (with what it carries), the nearest clear spot between the cell's process
 * areas and its facets' bands, so a drop on the hint still goes to the cell itself.
 *
 * @param {string} cellId
 * @param {Map<string, Object>} layout - From layoutPhysiology.
 * @param {(id: string) => {name?: string, detail?: string}|undefined} [labelOf] - As for obstaclesOf.
 * @returns {{x: number, y: number}|null} Their centre, in the cell's own coordinates, or nothing for a cell with no
 *   hint.
 */
export function cellHintAt(cellId, layout, labelOf = () => undefined) {
  const place = layout.get(cellId)
  if (!place?.hintAt) return null
  const { rect, hintAt } = place
  const name = labelOf(cellId)?.name ?? ''
  const width = Math.max([...name].length * TEXT.cell.char, TEXT.hint.width) + 8
  const height = TEXT.cell.height + TEXT.hint.height
  const others = []
  for (const [id, other] of layout) {
    if (other.cell === cellId && other.kind === 'protein') others.push(...proteinBoxes(other, labelOf(id)))
  }
  const at = ({ x, y }) => box(rect.x + x - width / 2, rect.y + y - height / 2, width, height)
  const clear = (centre) => others.every((other) => !overlap(grow(at(centre), CLEARANCE / 2), other))
  if (clear(hintAt)) return hintAt
  // Between the process areas and the bottom facet's band, and clear of the side facets' bands.
  const top = Math.max(FACET_BAND, ...(place.zones ?? []).map((zone) => zone.rect.y + zone.rect.height - rect.y))
  const span = (low, high) => {
    const count = Math.max(0, Math.floor((high - low) / HINT_STEP))
    return Array.from({ length: count + 1 }, (_, i) => low + i * HINT_STEP)
  }
  const xs = span(FACET_BAND + width / 2, rect.width - FACET_BAND - width / 2)
  const ys = span(top + height / 2, rect.height - FACET_BAND - height / 2)
  const distance = ({ x, y }) => Math.hypot(x - hintAt.x, y - hintAt.y)
  const spots = ys.flatMap((y) => xs.map((x) => ({ x, y }))).sort((a, b) => distance(a) - distance(b))
  return spots.find(clear) ?? hintAt
}

/**
 * How far out from a cell's outline a facet's name sits: past the bilayer's outer head groups, on the outside,
 * where only the outer half of a protein's cartoon reaches and its name never does.
 */
export const FACET_LABEL_OFFSET = 14
/** How far a facet's name is moved along its edge at a time when looking for somewhere clear. */
const FACET_LABEL_STEP = 4

/**
 * Where a template cell's facets are named: each just outside its edge, beside the membrane. A name starts in the
 * middle of its edge and moves along it, either way and past its corners if need be, to the nearest spot clear of
 * the proteins' cartoons (any cell's), the facets named before it, the other cells and the regions' names; failing
 * that, clear of this cell's proteins and facet names only; failing both, in the middle.
 *
 * @param {string} cellId
 * @param {Map<string, Object>} layout - From layoutPhysiology.
 * @param {(id: string) => {name?: string, detail?: string}|undefined} [labelOf] - As for obstaclesOf.
 * @returns {Array<{facetId: string, label: string, edge: string, x: number, y: number, width: number,
 *   height: number}>} Each name's box, in the cell's own coordinates, in the order of the cell's facetLabels.
 */
export function facetLabelBoxes(cellId, layout, labelOf = () => undefined) {
  const place = layout.get(cellId)
  if (!place?.facetLabels?.length) return []
  const { rect } = place
  const own = []
  const others = []
  for (const [id, other] of layout) {
    if (other.kind === 'protein') (other.cell === cellId ? own : others).push(proteinBoxes(other, labelOf(id))[0])
    if (other.kind === 'cell' && id !== cellId) others.push(grow(other.rect, HEAD_OFFSET + 4))
    const name = other.kind === 'region' && labelOf(id)?.name
    if (name) others.push(regionNameBox(other, name))
  }
  const { char, height, padding } = TEXT.facet
  return place.facetLabels.map((facet) => {
    const length = [...(facet.label ?? '')].length * char + padding
    const sideways = facet.edge === 'left' || facet.edge === 'right'
    const [w, h] = sideways ? [height, length] : [length, height]
    const run = sideways ? rect.height : rect.width
    // The name's start along its edge, from the cell's corner.
    const at = (along) => {
      const x = { left: -FACET_LABEL_OFFSET - w, right: rect.width + FACET_LABEL_OFFSET }[facet.edge] ?? along
      const y = { top: -FACET_LABEL_OFFSET - h, bottom: rect.height + FACET_LABEL_OFFSET }[facet.edge] ?? along
      return box(rect.x + x, rect.y + y, w, h)
    }
    const middle = (run - length) / 2
    // Past the rounded corners if need be: the outline curves away from it there.
    const [low, high] = [Math.min(-CELL_RADIUS, middle), Math.max(run - length + CELL_RADIUS, middle)]
    const spots = [middle]
    for (let step = FACET_LABEL_STEP; middle - step >= low || middle + step <= high; step += FACET_LABEL_STEP) {
      if (middle - step >= low) spots.push(middle - step)
      if (middle + step <= high) spots.push(middle + step)
    }
    const clearOf = (boxes) => (along) => boxes.every((other) => !overlap(grow(at(along), CLEARANCE / 2), other))
    const along = spots.find(clearOf([...own, ...others])) ?? spots.find(clearOf(own)) ?? middle
    const found = at(along)
    own.push(found)
    return { ...facet, x: found.x - rect.x, y: found.y - rect.y, width: w, height: h }
  })
}

/**
 * Where a region's name is drawn, as BioRegion puts it.
 *
 * @param {Object} place - The region's.
 * @param {string} name
 * @returns {Object}
 */
function regionNameBox(place, name) {
  const { rect } = place
  const { char, height, padding } = TEXT.region
  const length = [...name].length * char
  const edge = place.instance
    ? place.edge
    : place.side && facetById(EPITHELIAL_SHAPE, partOf(place.side, place.adjacent?.[0]?.at ?? undefined))?.edge
  if (edge === 'left' || edge === 'right') {
    const middle = centreOf(rect)
    if (place.instance) return box(middle.x - height / 2, middle.y - length / 2, height, length)
    const width = height + 2 * padding.y
    return box(edge === 'right' ? rect.x + rect.width - width : rect.x, rect.y, width, length + 2 * padding.x)
  }
  const [width, tall] = [length + 2 * padding.x, height + 2 * padding.y]
  if (place.instance && edge) return box(rect.x, rect.y + rect.height / 2 - tall / 2, width, tall)
  return box(rect.x, edge === 'bottom' ? rect.y + rect.height - tall : rect.y, width, tall)
}

/**
 * What else is drawn in a compartment, for its tokens to keep clear of: a cell's name, process zones and cards,
 * and its proteins with their names; a region's name, the cells over it with their facets' names, and the cartoons
 * that stick into it.
 *
 * @param {string} nodeId - The compartment's.
 * @param {Map<string, Object>} layout - From layoutPhysiology.
 * @param {(id: string) => {name?: string, detail?: string}|undefined} [labelOf] - A node's name, and for a protein
 *   what it carries.
 * @returns {Array<Object>} Boxes.
 */
export function obstaclesOf(nodeId, layout, labelOf = () => undefined) {
  const place = layout.get(nodeId)
  const name = labelOf(nodeId)?.name ?? ''
  const boxes = []
  if (place.kind === 'cell') {
    const named = cellNameBox(nodeId, layout, labelOf)
    if (named) boxes.push(named)
    for (const zone of place.zones ?? []) boxes.push(zone.rect)
    for (const [id, other] of layout) {
      if (other.cell !== nodeId) continue
      if (other.kind === 'protein') boxes.push(...proteinBoxes(other, labelOf(id)))
      if (other.kind === 'cytosolic') boxes.push(box(other.x, other.y, CARD.width, CARD.height))
    }
    return boxes
  }
  if (name) boxes.push(regionNameBox(place, name))
  for (const [id, other] of layout) {
    if (other.kind === 'cell') boxes.push(grow(other.rect, HEAD_OFFSET + 4))
    for (const facet of other.kind === 'cell' ? facetLabelBoxes(id, layout, labelOf) : []) {
      boxes.push(box(other.rect.x + facet.x, other.rect.y + facet.y, facet.width, facet.height))
    }
    if (other.kind === 'protein') boxes.push(proteinBoxes(other, labelOf(id))[0])
  }
  return boxes
}

const rowLength = (row, gap) => sum(row.map((item) => item.size)) + gap * Math.max(0, row.length - 1)

/**
 * Splits tokens into as few rows as fit a length. A coupled token goes on the row nearest the proteins it is
 * coupled to, where there is room; the rest go, by label, where there is most room.
 *
 * @param {Array<{size: number, side: number|null, want: number|null, label: string, index: number}>} items - side:
 *   where across the rows its proteins are, from 0 (the first row's side) to 1.
 * @param {number} length
 * @param {number} gap
 * @returns {Array<Array<Object>>} The rows, first to last, each in no particular order.
 */
export function wrapRows(items, length, gap) {
  if (rowLength(items, gap) <= length) return [items]
  const coupled = items
    .filter((item) => item.side !== null)
    .sort((a, b) => a.side - b.side || a.want - b.want || byLabel(a, b))
  const free = items.filter((item) => item.side === null).sort(byLabel)
  const fits = (row, item) => rowLength([...row, item], gap) <= length
  for (let count = 2; count <= items.length; count++) {
    const rows = Array.from({ length: count }, () => [])
    const room = (r) => length - rowLength(rows[r], gap)
    const indices = [...rows.keys()]
    const placed = [
      ...coupled.map((item) => {
        const nearest = Math.round(item.side * (count - 1))
        return [item, [...indices].sort((a, b) => Math.abs(a - nearest) - Math.abs(b - nearest) || a - b)]
      }),
      ...free.map((item) => [item, null]),
    ].every(([item, order]) => {
      const row = (order ?? [...indices].sort((a, b) => room(b) - room(a) || a - b)).find((r) => fits(rows[r], item))
      if (row === undefined) return false
      rows[row].push(item)
      return true
    })
    if (placed) return rows.filter((row) => row.length)
  }
  return items.map((item) => [item])
}

/**
 * Spreads coupled tokens as spreadAlong does, closing the spaces between them when that leaves them too long for
 * their bounds: packed side by side, in the same order, about where they wanted to be and within the bounds.
 *
 * @param {Array<{want: number, size: number}>} items
 * @param {number} gap
 * @param {[number, number]} bounds
 * @returns {number[]} Each item's centre, in the order given.
 */
function squeeze(items, gap, [low, high]) {
  const at = spreadAlong(items, gap, [low, high])
  const first = Math.min(...at.map((centre, i) => centre - items[i].size / 2))
  const last = Math.max(...at.map((centre, i) => centre + items[i].size / 2))
  if (last - first <= high - low) return at
  const order = items.map((item, index) => ({ ...item, index })).sort((a, b) => a.want - b.want || byLabel(a, b))
  const length = rowLength(order, gap)
  const middle = mean(order.map((item) => item.want))
  let start = Math.min(Math.max(middle - length / 2, low), Math.max(low, high - length))
  const centres = []
  for (const item of order) {
    centres[item.index] = start + item.size / 2
    start += item.size + gap
  }
  return centres
}

/**
 * Lays a row of tokens along a line. Coupled tokens go where they want (spread so none overlap, closed up where
 * the row would not otherwise fit); the rest are split, by label, between the two ends of that run, so the space
 * left at each end is as even as it can be. A row whose tokens would take most of the line side by side is centred
 * on it.
 *
 * @param {Array<{size: number, want: number|null, label: string, index: number}>} items
 * @param {[number, number]} bounds
 * @param {number} gap
 * @returns {number[]} Each item's centre, in the order given.
 */
export function arrangeRow(items, [low, high], gap) {
  const coupled = items.filter((item) => item.want !== null)
  const free = items.filter((item) => item.want === null).sort(byLabel)
  const centres = new Map()
  const reach = (list) => sum(list.map((item) => item.size + gap))
  const pack = (list, start) => {
    let at = start
    for (const item of list) {
      centres.set(item, at + item.size / 2)
      at += item.size + gap
    }
  }
  if (!coupled.length) pack(free, (low + high) / 2 - (reach(free) - gap) / 2)
  else {
    let best = null
    for (let k = 0; k <= free.length; k++) {
      const [left, right] = [free.slice(0, k), free.slice(k)]
      const at = squeeze(coupled, gap, [low + reach(left), high - reach(right)])
      const first = Math.min(...at.map((centre, i) => centre - coupled[i].size / 2))
      const last = Math.max(...at.map((centre, i) => centre + coupled[i].size / 2))
      const score = Math.abs(first - reach(left) - low - (high - last - reach(right)))
      if (!best || score < best.score - 0.5) best = { score, left, right, at, first, last }
    }
    coupled.forEach((item, i) => centres.set(item, best.at[i]))
    pack(best.left, best.first - reach(best.left))
    pack(best.right, best.last + gap)
  }
  const start = Math.min(...items.map((item) => centres.get(item) - item.size / 2))
  const end = Math.max(...items.map((item) => centres.get(item) + item.size / 2))
  const shift = rowLength(items, gap) > CENTRE_SHARE * (high - low) ? (low + high) / 2 - (start + end) / 2 : 0
  return items.map((item) => centres.get(item) + shift)
}

/**
 * Places a compartment's tokens: in rows along it (or columns down it) within its inner bounds, the block of
 * them as near the line given as it can be without touching anything else drawn there.
 *
 * @param {Array<{size: number, cross: number, want: number|null, crossAt: number|null, label: string,
 *   index: number}>} items - size along the rows and cross across them; crossAt: where its proteins are, across.
 * @param {Object} options
 * @param {Object} options.inner - The box tokens stay in.
 * @param {boolean} options.across - Rows run across (along x), else down (along y).
 * @param {number} options.line - Where the block's middle would be, across.
 * @param {Array<Object>} [options.obstacles]
 * @param {boolean} [options.ordered=false] - Items carry a `rank`, the user's order: the rows keep the places worked
 *   out for them, and the items fill those places in rank order, first row first, each row along its line.
 * @returns {Array<{x: number, y: number}>} Each item's centre, in the order given.
 */
export function placeTokens(items, { inner, across, line, obstacles = [], ordered = false }) {
  const [low, high] = across ? [inner.x, inner.x + inner.width] : [inner.y, inner.y + inner.height]
  const [crossLow, crossHigh] = across ? [inner.y, inner.y + inner.height] : [inner.x, inner.x + inner.width]
  const sided = items.map((item) => ({
    ...item,
    side:
      item.crossAt === null ? null : Math.min(1, Math.max(0, (item.crossAt - crossLow) / (crossHigh - crossLow || 1))),
  }))
  const rows = wrapRows(sided, high - low, TOKEN.gap)
  const alongs = rows.map((row) => arrangeRow(row, [low, high], TOKEN.gap))
  if (ordered) {
    // Each row takes as many items as before, in rank order, at about the places worked out for it.
    const sequence = [...sided].sort((a, b) => a.rank - b.rank || byLabel(a, b))
    let next = 0
    rows.forEach((row, r) => {
      const slots = [...alongs[r]].sort((a, b) => a - b)
      rows[r] = sequence.slice(next, next + row.length)
      next += row.length
      const wanted = rows[r].map((item, i) => ({ ...item, want: slots[i] + i * 1e-6 }))
      alongs[r] = squeeze(wanted, TOKEN.gap, [low, high])
    })
  }
  const thickness = rows.map((row) => Math.max(...row.map((item) => item.cross)))
  const block = sum(thickness) + TOKEN.gap * (rows.length - 1)
  const offsets = []
  let at = -block / 2
  for (const thick of thickness) {
    offsets.push(at + thick / 2)
    at += thick + TOKEN.gap
  }
  const centresAt = (middle) =>
    rows.flatMap((row, r) => row.map((item, i) => [item, alongs[r][i], middle + offsets[r]]))
  const boxesAt = (middle) =>
    centresAt(middle).map(([item, along, cross]) =>
      across
        ? box(along - item.size / 2, cross - item.cross / 2, item.size, item.cross)
        : box(cross - item.cross / 2, along - item.size / 2, item.cross, item.size)
    )
  const hits = obstacles.map((obstacle) => grow(obstacle, CLEARANCE))
  const cost = (middle) => sum(boxesAt(middle).flatMap((token) => hits.map((hit) => overlap(token, hit))))
  const [min, max] = [crossLow + block / 2, crossHigh - block / 2]
  let middle = (crossLow + crossHigh) / 2
  if (min <= max) {
    const start = Math.min(max, Math.max(min, line))
    let best = { middle: start, cost: cost(start) }
    for (let step = STEP; best.cost > 0 && (start - step >= min || start + step <= max); step += STEP) {
      for (const candidate of [start - step, start + step]) {
        if (candidate < min || candidate > max) continue
        const found = cost(candidate)
        if (found < best.cost) best = { middle: candidate, cost: found }
        if (!found) break
      }
    }
    middle = best.middle
  }
  const placed = new Map(centresAt(middle).map(([item, along, cross]) => [item.index, { along, cross }]))
  return items.map((item) => {
    const { along, cross } = placed.get(item.index)
    return across ? { x: along, y: cross } : { x: cross, y: along }
  })
}

/**
 * Finds where a region's far edge is: the side of it away from the first cell given (the one it is coupled
 * through, where there is one).
 *
 * @param {Object} rect - The region's.
 * @param {Array<Object>} cells - Cell rects, the one it is coupled through first.
 * @returns {'top'|'bottom'|'left'|'right'|null} null without cells.
 */
function farEdge(rect, cells) {
  if (!cells.length) return null
  const centre = centreOf(rect)
  const nearest = cells[0]
  const cell = centreOf(nearest)
  if (rect.width >= rect.height) return centre.y <= cell.y ? 'top' : 'bottom'
  return centre.x <= cell.x ? 'left' : 'right'
}

/**
 * How far along a protein's faces a species' paths attach: under its arrow on the cartoon, which spreads them
 * evenly across its arrow room in the order they are carried (one alone down the middle). A species the cartoon
 * shows no arrow for attaches at the middle of the face.
 *
 * @param {{species: string[], room?: {left: number, right: number}}|undefined} arrows - What the cartoon's arrows
 *   carry, in order, and where it spreads them, in its unturned box.
 * @param {string} species
 * @returns {number} The offset from the face's middle, as the unturned box's x runs.
 */
export function arrowOffset(arrows, species) {
  const index = arrows?.species?.indexOf(species) ?? -1
  return index < 0 ? 0 : spreadOffset(index, arrows.species.length, arrows.room)
}

/** The offset from a face's middle of the index-th of count points spread evenly across a cartoon's arrow room. */
function spreadOffset(index, count, { left, right } = DEFAULT_ARROW_ROOM) {
  const x = count > 1 ? left + ((right - left) * index) / (count - 1) : (left + right) / 2
  return x - GLYPH_WIDTH / 2
}

/**
 * Places the network's tokens and paths.
 *
 * @param {Object} network - From speciesNetwork.
 * @param {Map<string, Object>} layout - From layoutPhysiology.
 * @param {Object} [options]
 * @param {(id: string) => Object|undefined} [options.facesOf] - A protein's glyph's face anchors.
 * @param {(id: string) => Object|undefined} [options.arrowsOf] - What a protein's cartoon's arrows carry, and
 *   where (see arrowOffset), so each species' path attaches under its own arrow.
 * @param {(path: Object) => {direction: 'in'|'out'|null, size: number}|null} [options.flowOf] - Which way a path's
 *   species went in the last run, and how much.
 * @param {(id: string) => {name?: string, detail?: string}|undefined} [options.labelOf] - A node's name, and for a
 *   protein what it carries, so tokens keep clear of them.
 * @param {(id: string) => string[]|undefined} [options.orderOf] - A compartment's own order of its tokens' species,
 *   as the user dragged them (bioView.speciesOrder).
 * @returns {{tokens: Array<Object>, paths: Array<Object>, dependences: Array<Object>}} Tokens with their centre,
 *   size and label; paths with an SVG `d` for each of their outside and inside legs, the way they go, a width, and
 *   the length of the arrowhead each leg stops short of (0 without one); dependences with an SVG `d` from their
 *   token to the protein's face, and the open circle they end in there.
 */
export function layoutSpecies(
  network,
  layout,
  {
    facesOf = () => undefined,
    arrowsOf = () => undefined,
    flowOf = () => null,
    labelOf = () => undefined,
    orderOf = () => undefined,
  } = {}
) {
  const tokens = placeSpeciesTokens(network, layout, { labelOf, orderOf })
  return { tokens, ...routeSpecies(network, layout, tokens, { facesOf, arrowsOf, flowOf }) }
}

/** A protein's place in the layout, if it is in a membrane. */
const proteinPlaceIn = (layout) => (id) => {
  const place = layout.get(id)
  return place?.kind === 'protein' ? place : null
}

/**
 * Places the network's tokens: the part of layoutSpecies a run doesn't change.
 *
 * @param {Object} network - From speciesNetwork.
 * @param {Map<string, Object>} layout - From layoutPhysiology.
 * @param {Object} [options]
 * @param {(id: string) => {name?: string, detail?: string}|undefined} [options.labelOf] - As for layoutSpecies.
 * @param {(id: string) => string[]|undefined} [options.orderOf] - As for layoutSpecies. Species it leaves out follow
 *   those it names, by label.
 * @param {string} [options.only] - The one compartment whose tokens are placed, as when previewing a new order.
 * @returns {Array<Object>} Tokens with their centre, size and label, and the `row` they can be dragged along: its
 *   axis ('x' or 'y') and the bounds their centres' row keeps within.
 */
export function placeSpeciesTokens(
  network,
  layout,
  { labelOf = () => undefined, orderOf = () => undefined, only = null } = {}
) {
  const proteinPlace = proteinPlaceIn(layout)
  const cells = [...layout.values()].filter((place) => place.kind === 'cell').map((place) => place.rect)

  const tokens = []
  for (const [nodeId, entries] of network.compartments) {
    if (only && nodeId !== only) continue
    const place = layout.get(nodeId)
    if (!place?.rect || (place.kind !== 'cell' && place.kind !== 'region')) continue
    const { rect } = place
    // Only proteins a path is drawn to: a token with none (ATP at a pump, say) has nothing to line up with, and
    // pulling it there would crowd one end of the row.
    const coupledTo = (species) => [
      ...new Set(
        network.paths
          .filter((path) => path.species === species && (path.outside === nodeId || path.inside === nodeId))
          .map((path) => proteinPlace(path.protein))
          .filter(Boolean)
      ),
    ]
    const others = cells.filter((cell) => cell !== rect)
    const firstProtein = network.links
      .filter((link) => link.compartment === nodeId)
      .map((link) => proteinPlace(link.protein))
      .find(Boolean)
    const near = firstProtein ? [layout.get(firstProtein.cell)?.rect, ...others].filter(Boolean) : others
    const edge = place.kind === 'region' ? farEdge(rect, near) : null
    const across = edge !== 'left' && edge !== 'right'
    const order = orderOf(nodeId)
    const ordered = Array.isArray(order) && order.length > 0
    const items = entries.map((entry, index) => {
      const width = tokenWidth(entry.label)
      const proteins = coupledTo(entry.species)
      const rank = ordered ? order.indexOf(entry.species) : -1
      return {
        index,
        rank: rank < 0 ? Infinity : rank,
        label: entry.label,
        size: across ? width : TOKEN.height,
        cross: across ? TOKEN.height : width,
        want: mean(proteins.map((protein) => (across ? protein.x : protein.y))),
        crossAt: mean(proteins.map((protein) => (across ? protein.y : protein.x))),
      }
    })
    const inset = place.kind === 'cell' ? CELL_INSET : REGION_INSET
    const inner = grow(rect, -Math.min(inset, rect.width / 2, rect.height / 2))
    // A cell's row goes across the middle of its inside; a region's towards its far edge.
    const line =
      {
        top: rect.y + rect.height * REGION_DEPTH,
        bottom: rect.y + rect.height * (1 - REGION_DEPTH),
        left: rect.x + rect.width * REGION_DEPTH,
        right: rect.x + rect.width * (1 - REGION_DEPTH),
      }[edge] ?? centreOf(inner).y
    const obstacles = obstaclesOf(nodeId, layout, labelOf)
    const centres = placeTokens(items, { inner, across, line, obstacles, ordered })
    const row = across
      ? { axis: 'x', low: inner.x, high: inner.x + inner.width }
      : { axis: 'y', low: inner.y, high: inner.y + inner.height }
    for (const [index, entry] of entries.entries()) {
      const token = {
        key: `${nodeId}::${entry.species}`,
        nodeId,
        species: entry.species,
        label: entry.label,
        ...centres[index],
        width: tokenWidth(entry.label),
        height: TOKEN.height,
        row,
      }
      tokens.push(token)
    }
  }
  return tokens
}

/**
 * A compartment's tokens' species in reading order (row by row, then along each row), with one token moved along its
 * row: the order a drag of it leaves, for bioView.speciesOrder.
 *
 * @param {Array<Object>} tokens - From placeSpeciesTokens.
 * @param {string} key - The dragged token's.
 * @param {number} [along] - Where its centre was let go, along its row; where it is, if not given.
 * @returns {string[]|null} Its compartment's species, or null for no such token.
 */
export function chipOrder(tokens, key, along) {
  const dragged = tokens.find((token) => token.key === key)
  if (!dragged) return null
  const axis = dragged.row?.axis ?? 'x'
  const cross = axis === 'x' ? 'y' : 'x'
  const at = (token) => (token.key === key && Number.isFinite(along) ? along : token[axis])
  return tokens
    .filter((token) => token.nodeId === dragged.nodeId)
    .sort((a, b) => Math.round(a[cross]) - Math.round(b[cross]) || at(a) - at(b))
    .map((token) => token.species)
}

/**
 * Draws the network's paths and dependences between placed tokens and proteins: the part of layoutSpecies that
 * follows a run.
 *
 * @param {Object} network - From speciesNetwork.
 * @param {Map<string, Object>} layout - From layoutPhysiology.
 * @param {Array<Object>} tokens - From placeSpeciesTokens.
 * @param {Object} [options] - facesOf, arrowsOf and flowOf, as for layoutSpecies.
 * @returns {{paths: Array<Object>, dependences: Array<Object>}} Each with the `ends` its legs were drawn between,
 *   so driftSpecies can redraw a leg alone.
 */
export function routeSpecies(
  network,
  layout,
  tokens,
  { facesOf = () => undefined, arrowsOf = () => undefined, flowOf = () => null } = {}
) {
  const proteinPlace = proteinPlaceIn(layout)
  const tokenAt = new Map(tokens.map((token) => [token.key, token]))
  const flows = network.paths.map((path) => flowOf(path))
  const largest = Math.max(0, ...flows.map((flow) => Math.abs(flow?.size ?? 0)))
  const paths = []
  for (const [index, path] of network.paths.entries()) {
    const place = proteinPlace(path.protein)
    const outer = tokenAt.get(`${path.outside}::${path.species}`)
    const inner = tokenAt.get(`${path.inside}::${path.species}`)
    if (!place || !outer || !inner) continue
    const size = { width: GLYPH_WIDTH, height: GLYPH_HEIGHT }
    const anchors = facesOf(path.protein)
    const offset = arrowOffset(arrowsOf(path.protein), path.species)
    const out = facePoint(place, 'outside', size, anchors, offset)
    const into = facePoint(place, 'inside', size, anchors, offset)
    const flow = flows[index]
    const share = largest > 0 && flow?.size ? Math.sqrt(Math.abs(flow.size) / largest) : 0
    const width = WIDTH.min + (WIDTH.max - WIDTH.min) * share
    const head = flow?.direction ? arrowHead(width) : 0
    paths.push({
      key: `${path.protein}::${path.species}::${path.outside}::${path.inside}`,
      protein: path.protein,
      species: path.species,
      outside: path.outside,
      inside: path.inside,
      direction: flow?.direction ?? null,
      width,
      head,
      legs: {
        outside: leg(outer, out, flow?.direction === 'out', head),
        inside: leg(inner, into, flow?.direction !== 'out', head),
      },
      ends: {
        outside: { token: outer.key, face: out, toToken: flow?.direction === 'out', head },
        inside: { token: inner.key, face: into, toToken: flow?.direction !== 'out', head },
      },
    })
  }

  // A dependence goes to the face on its compartment's side: under the species' arrow if the cartoon has one, else
  // spread with the protein's other such dependences on that face, in the order of their tokens along it.
  const placedDependences = []
  for (const dependence of network.dependences ?? []) {
    const place = proteinPlace(dependence.protein)
    const token = tokenAt.get(`${dependence.compartment}::${dependence.species}`)
    if (!place || !token) continue
    const face = dependence.side ?? (layout.get(dependence.compartment)?.kind === 'cell' ? 'inside' : 'outside')
    placedDependences.push({ ...dependence, place, token, face })
  }
  const dependences = []
  for (const dependence of placedDependences) {
    const { protein, compartment, species, place, token, face } = dependence
    const arrows = arrowsOf(protein)
    const hasArrow = (entry) => !!arrows?.species?.includes(entry.species)
    // Along the face as the cartoon's x runs: on screen, reversed where it is turned upside down or onto the left.
    const along = (entry) =>
      ({ top: entry.token.x, bottom: -entry.token.x, left: -entry.token.y, right: entry.token.y })[place.outward] ??
      entry.token.x
    const shared = placedDependences
      .filter((other) => other.protein === protein && other.face === face && !hasArrow(other))
      .sort((a, b) => along(a) - along(b) || byLabel(a, b))
    const offset = hasArrow(dependence)
      ? arrowOffset(arrows, species)
      : shared.length > 1
        ? spreadOffset(shared.indexOf(dependence), shared.length, arrows?.room)
        : 0
    const at = facePoint(place, face, { width: GLYPH_WIDTH, height: GLYPH_HEIGHT }, facesOf(protein), offset)
    dependences.push({
      key: `${protein}::${species}::${compartment}`,
      protein,
      compartment,
      species,
      d: leg(token, at, false, 2 * DEPENDENCE_END),
      ends: { token: token.key, face: at, toToken: false, head: 2 * DEPENDENCE_END },
      end: {
        x: at.point.x + at.direction.x * DEPENDENCE_END,
        y: at.point.y + at.direction.y * DEPENDENCE_END,
        r: DEPENDENCE_END,
      },
    })
  }
  return { paths, dependences }
}

/**
 * The species drawing while something is dragged, without laying it out again: tokens of the compartments moved
 * shift with them, a token put somewhere of its own goes there, and only the legs with an end that moved are drawn
 * again (a protein's face moves with its cell). Moved tokens keep their centre and gain an `offset`, so they can be
 * drawn where they were and translated, and slide there.
 *
 * @param {{tokens: Array<Object>, paths: Array<Object>, dependences: Array<Object>}|null} species - From
 *   layoutSpecies.
 * @param {Map<string, Object>} layout - From layoutPhysiology, as the species were laid out over.
 * @param {Object} [drift]
 * @param {Map<string, {x: number, y: number}>} [drift.moved] - Cell or region id -> how far it has moved.
 * @param {Map<string, {x: number, y: number}>} [drift.placed] - Token key -> where its centre is now.
 * @returns {Object|null} The species as given if nothing moved; otherwise a copy, unmoved pieces kept as they were.
 */
export function driftSpecies(species, layout, { moved = new Map(), placed = new Map() } = {}) {
  if (!species || (!moved.size && !placed.size)) return species
  const offsets = new Map()
  const tokens = species.tokens.map((token) => {
    const at = placed.get(token.key)
    const offset = at ? { x: at.x - token.x, y: at.y - token.y } : moved.get(token.nodeId)
    if (!offset || (!offset.x && !offset.y)) return token
    offsets.set(token.key, offset)
    return { ...token, offset }
  })
  const faceShift = (protein) => moved.get(layout.get(protein)?.cell)
  const tokenOf = new Map(species.tokens.map((token) => [token.key, token]))
  // A leg drawn again from its ends, moved; the one it had if neither end moved.
  const redraw = (ends, d, shift) => {
    const offset = offsets.get(ends.token)
    if (!offset && !shift) return d
    const token = tokenOf.get(ends.token)
    const at = offset ? { ...token, x: token.x + offset.x, y: token.y + offset.y } : token
    const face = shift
      ? { ...ends.face, point: { x: ends.face.point.x + shift.x, y: ends.face.point.y + shift.y } }
      : ends.face
    return leg(at, face, ends.toToken, ends.head)
  }
  const paths = species.paths.map((path) => {
    if (!path.ends) return path
    const shift = faceShift(path.protein)
    const outside = redraw(path.ends.outside, path.legs.outside, shift)
    const inside = redraw(path.ends.inside, path.legs.inside, shift)
    return outside === path.legs.outside && inside === path.legs.inside ? path : { ...path, legs: { outside, inside } }
  })
  const dependences = species.dependences.map((dependence) => {
    if (!dependence.ends) return dependence
    const shift = faceShift(dependence.protein)
    const d = redraw(dependence.ends, dependence.d, shift)
    if (d === dependence.d) return dependence
    const end = shift ? { ...dependence.end, x: dependence.end.x + shift.x, y: dependence.end.y + shift.y } : dependence.end
    return { ...dependence, d, end }
  })
  return { ...species, tokens, paths, dependences }
}

/**
 * Draws a path's leg between a token's edge and a protein's face, as a curve leaving each square on.
 *
 * @param {Object} token - Its centre and size.
 * @param {{point: Object, direction: Object}} face
 * @param {boolean} toToken - Whether the leg runs from the face to the token, so an arrow at its end points there.
 * @param {number} [head=0] - How far short of its end it stops, for an arrowhead to fill.
 * @returns {string} An SVG path.
 */
function leg(token, face, toToken, head = 0) {
  const dx = face.point.x - token.x
  const dy = face.point.y - token.y
  const isVertical = Math.abs(dy) * token.width >= Math.abs(dx) * token.height
  const toward = isVertical ? { x: 0, y: Math.sign(dy) || 1 } : { x: Math.sign(dx) || 1, y: 0 }
  const edge = {
    x: token.x + (toward.x * token.width) / 2,
    y: token.y + (toward.y * token.height) / 2,
  }
  const reach = Math.min(BEND, Math.hypot(face.point.x - edge.x, face.point.y - edge.y) / 2)
  const nearEdge = { x: edge.x + toward.x * reach, y: edge.y + toward.y * reach }
  const nearFace = { x: face.point.x + face.direction.x * reach, y: face.point.y + face.direction.y * reach }
  const round = (point) => `${Math.round(point.x * 10) / 10},${Math.round(point.y * 10) / 10}`
  const [start, c1, bend, tip] = toToken ? [face.point, nearFace, nearEdge, edge] : [edge, nearEdge, nearFace, face.point]
  // Its last stretch moves back along itself, so it still meets the arrowhead's base head on.
  const along = Math.hypot(tip.x - bend.x, tip.y - bend.y)
  const back = along > 0 ? Math.min(head, Math.hypot(tip.x - start.x, tip.y - start.y) / 2) : 0
  const shift = (point) => ({
    x: point.x - ((tip.x - bend.x) / along) * back,
    y: point.y - ((tip.y - bend.y) / along) * back,
  })
  const [c2, end] = back > 0 ? [shift(bend), shift(tip)] : [bend, tip]
  return `M${round(start)} C${round(c1)} ${round(c2)} ${round(end)}`
}
