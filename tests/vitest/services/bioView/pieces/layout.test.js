import { describe, expect, it } from 'vitest'

import {
  BUILT_IN_PIECE_TEMPLATES,
  getBuiltInPieceTemplate,
} from '../../../../../src/services/bioView/pieces/builtInTemplates.js'
import { layoutPieces, membraneKey, pieceKey, routeTube } from '../../../../../src/services/bioView/pieces/layout.js'
import { validatePieces } from '../../../../../src/services/bioView/pieces/model.js'
import { CELL_RADIUS, GLYPH_WIDTH, MIN_CELL } from '../../../../../src/services/bioView/geometry.js'
import { encloseCompartment } from '../../../../../src/services/bioView/pieces/edits.js'
import { fitToContents, moveFrame, resizeFrame } from '../../../../../src/services/bioView/pieces/moves.js'
import { LABEL_GAP } from '../../../../../src/services/bioView/metrics.js'

const laidOut = (raw, options) => {
  const { pieces, errors } = validatePieces(raw)
  expect(errors).toEqual([])
  return layoutPieces(pieces, options)
}
const rectOf = (layout, id) => layout.places.get(pieceKey(id)).rect
const right = (rect) => rect.x + rect.width
const bottom = (rect) => rect.y + rect.height
const contains = (outer, inner) =>
  inner.x >= outer.x && inner.y >= outer.y && right(inner) <= right(outer) && bottom(inner) <= bottom(outer)

describe('the built-in templates written as pieces', () => {
  it('all validate', () => {
    expect(BUILT_IN_PIECE_TEMPLATES.map((template) => template.id)).toEqual([
      'cell',
      'epithelial-cell',
      'two-cell-epithelium',
      'chemical-synapse',
      'cardiomyocyte',
      'rod-photoreceptor',
    ])
  })

  it('give every piece a place', () => {
    for (const template of BUILT_IN_PIECE_TEMPLATES) {
      const { places } = layoutPieces(template.pieces)
      // A membrane's bulk is drawn as its cell, and a fold in its membrane's.
      const placed = template.pieces.filter((piece) => places.has(pieceKey(piece.id)))
      const bulks = template.pieces.filter((piece) => [...places.values()].some((place) => place.bulk === piece.id))
      const folds = template.pieces.filter((piece) =>
        [...places.values()].some((place) => place.folds?.some((fold) => fold.facetId === piece.id)),
      )
      expect(placed.length + bulks.length + folds.length, template.id).toBe(template.pieces.length)
    }
  })
})

describe('layoutPieces', () => {
  it('draws a membrane with no frame at the least size of a cell', () => {
    const layout = laidOut([
      { id: 'cell', kind: 'compartment', label: 'Cell' },
      { id: 'pm', kind: 'membrane', label: 'Plasma membrane', encloses: ['cell'] },
    ])
    const { rect } = layout.places.get(pieceKey('pm'))
    expect(rect.width).toBeGreaterThanOrEqual(MIN_CELL.width)
    expect(rect.height).toBeGreaterThanOrEqual(MIN_CELL.height)
  })

  it('takes the size of the compartment a membrane is dropped on', () => {
    const compartment = { x: 100, y: 100, width: 320, height: 160 }
    const enclosed = encloseCompartment(
      [{ id: 'c', kind: 'compartment', label: 'C', frame: compartment }],
      'c',
      new Map([['c', compartment]]),
    )
    const layout = laidOut(enclosed.pieces)
    expect(layout.places.get(pieceKey(enclosed.id)).rect).toEqual(compartment)
  })

  it('draws a membrane as a cell, its bulk filling it, at its frame, grown only for its sides’ spare places', () => {
    const layout = laidOut([
      { id: 'cell', kind: 'compartment', label: 'Cell' },
      {
        id: 'pm',
        kind: 'membrane',
        label: 'Plasma membrane',
        encloses: ['cell'],
        frame: { x: 40, y: 60, width: 100, height: 100 },
      },
    ])
    const place = layout.places.get(pieceKey('pm'))
    expect(place).toMatchObject({
      kind: 'cell',
      piece: 'pm',
      bulk: 'cell',
      site: 'pieces/cell',
      membraneSite: 'pieces/pm',
      label: 'Cell',
    })
    // A cartoon's room between the rounded corners of each empty side, not the size a cell with no frame is drawn at.
    expect(place.rect).toEqual({
      x: 40,
      y: 60,
      width: GLYPH_WIDTH + 2 * CELL_RADIUS,
      height: GLYPH_WIDTH + 2 * CELL_RADIUS,
    })
    expect(layout.rects.get('cell')).toEqual(place.rect)
    expect(layout.places.has(pieceKey('cell'))).toBe(false)
  })

  it('marks a membrane with no module of its own as empty, whatever is in its cell', () => {
    const pieces = [
      { id: 'cell', kind: 'compartment', label: 'Cell' },
      { id: 'pm', kind: 'membrane', label: 'Plasma membrane', encloses: ['cell'] },
    ]
    const on = (site) => ({ id: site, data: { bioView: { site: `pieces/${site}` } } })
    const cellOf = (layout) => [...layout.places.values()].find((place) => place.kind === 'cell')
    expect(cellOf(laidOut(pieces, { nodes: [on('cell')] })).membraneEmpty).toBe(true)
    expect(cellOf(laidOut(pieces, { nodes: [on('cell'), on('pm')] })).membraneEmpty).toBe(false)
  })

  it('gives an empty membrane a place of its own, so its band can be selected and deleted', () => {
    const pieces = [
      { id: 'cell', kind: 'compartment', label: 'Cell' },
      { id: 'pm', kind: 'membrane', label: 'Plasma membrane', encloses: ['cell'] },
    ]
    const on = (site) => ({ id: site, data: { bioView: { site: `pieces/${site}` } } })
    // Whether or not the cell's inside has a module, which the cell is keyed by.
    for (const [nodes, cell] of [
      [[on('cell')], 'cell'],
      [[], pieceKey('pm')],
    ]) {
      const { places } = laidOut(pieces, { nodes })
      expect(places.get(membraneKey('pm'))).toMatchObject({ kind: 'membrane', cell, piece: 'pm' })
    }
    const { places } = laidOut(pieces, { nodes: [on('cell'), on('pm')] })
    expect(places.has(membraneKey('pm'))).toBe(false)
    expect(places.get('pm')).toMatchObject({ kind: 'membrane', cell: 'cell' })
  })

  it('grows a membrane for its process zones, which go in rows inside it', () => {
    const layout = laidOut(getBuiltInPieceTemplate('cardiomyocyte').pieces)
    const cell = rectOf(layout, 'sarcolemma')
    const [first, second] = ['myofilaments', 'mitochondria'].map((id) => rectOf(layout, id))
    expect(contains(cell, first)).toBe(true)
    expect(second.y).toBeGreaterThan(first.y)
    expect(layout.places.get(pieceKey('myofilaments'))).toMatchObject({
      kind: 'zone',
      compartment: 'myocyte',
      site: 'pieces/myofilaments',
    })
  })

  it('puts an organelle inside the compartment it stands in, by its frame', () => {
    const layout = laidOut(getBuiltInPieceTemplate('cardiomyocyte').pieces)
    const cell = rectOf(layout, 'sarcolemma')
    const sr = rectOf(layout, 'sr-membrane')
    expect(sr).toMatchObject({ x: cell.x + 80, y: cell.y + 310 })
    expect(layout.places.get(pieceKey('sr-membrane'))).toMatchObject({ kind: 'cell', parent: pieceKey('sarcolemma') })
  })

  it('lays a fluid docked to one side out along it as a band, past its ends', () => {
    const layout = laidOut(getBuiltInPieceTemplate('epithelial-cell').pieces)
    const cell = rectOf(layout, 'plasma-membrane')
    const apical = rectOf(layout, 'apical-fluid')
    expect(apical.x).toBeLessThan(cell.x)
    expect(right(apical)).toBeGreaterThan(right(cell))
    expect(apical.y).toBeLessThan(cell.y)
    expect(bottom(apical)).toBeGreaterThan(cell.y)
    expect(layout.places.get(pieceKey('apical-fluid'))).toMatchObject({
      kind: 'region',
      form: 'band',
      edge: 'top',
      tone: 'sky',
    })
  })

  it('fills the gap between two facing sides', () => {
    const layout = laidOut(getBuiltInPieceTemplate('two-cell-epithelium').pieces)
    const [a, b] = ['a-membrane', 'b-membrane'].map((id) => rectOf(layout, id))
    const gap = rectOf(layout, 'paracellular')
    expect(gap.x).toBeLessThan(right(a))
    expect(right(gap)).toBeGreaterThan(b.x)
    // Shared fluids span both cells.
    const apical = rectOf(layout, 'apical-fluid')
    expect(apical.x).toBeLessThan(a.x)
    expect(right(apical)).toBeGreaterThan(right(b))
  })

  it('draws a compartment docked inside from the stretches it is docked to', () => {
    const layout = laidOut([
      {
        id: 'a',
        kind: 'compartment',
        label: 'A',
        docks: [
          { on: 'm', side: 'top', face: 'inside', to: 0.5 },
          { on: 'm', side: 'bottom', face: 'inside', to: 0.5 },
          { on: 'm', side: 'left', face: 'inside' },
        ],
      },
      {
        id: 'b',
        kind: 'compartment',
        label: 'B',
        docks: [
          { on: 'm', side: 'top', face: 'inside', from: 0.5 },
          { on: 'm', side: 'bottom', face: 'inside', from: 0.5 },
          { on: 'm', side: 'right', face: 'inside' },
        ],
      },
      { id: 'm', kind: 'membrane', label: 'M', encloses: ['a', 'b'], frame: { x: 0, y: 0, width: 600, height: 300 } },
      { id: 'cilium', kind: 'tube', label: 'Cilium', ends: ['a', 'b'], flux: 'junction' },
    ])
    const cell = rectOf(layout, 'm')
    const [a, b] = ['a', 'b'].map((id) => rectOf(layout, id))
    expect(contains(cell, a) && contains(cell, b)).toBe(true)
    expect(right(a)).toBeCloseTo(cell.x + cell.width / 2)
    expect(b.x).toBeCloseTo(cell.x + cell.width / 2)
    expect(layout.places.get(pieceKey('a'))).toMatchObject({ form: 'inner', parent: pieceKey('m') })
    // The two touch, so the tube between them is the joint where they meet.
    const tube = layout.places.get(pieceKey('cilium'))
    expect(tube).toMatchObject({ kind: 'link', joint: 'junction', flow: 'junction' })
    expect(tube.zone.x + tube.zone.width / 2).toBeCloseTo(right(a))
    // With no bulk, the cell takes no module of its own.
    expect(layout.places.get(pieceKey('m')).site).toBeNull()
  })

  it('draws a bridge between two cells apart as a channel across the gap between their membranes', () => {
    const cells = getBuiltInPieceTemplate('two-cell-epithelium').pieces
    const tube = (flux) => ({ id: 'link', kind: 'tube', label: 'Link', ends: ['a', 'b'], flux })
    const layout = laidOut([...cells, tube('bridge')])
    const [a, b] = ['a-membrane', 'b-membrane'].map((id) => layout.rects.get(id))
    const place = layout.places.get(pieceKey('link'))
    expect(place).toMatchObject({ kind: 'link', joint: 'bridge', channel: { vertical: false } })
    expect(place.channel.from.x).toBeCloseTo(right(a))
    expect(place.channel.to.x).toBeCloseTo(b.x)
    // Its module goes in the middle of the gap.
    expect(place.zone.x + place.zone.width / 2).toBeCloseTo((right(a) + b.x) / 2)
    // A gap junction between the same two is no channel: a line, there being no touching.
    expect(laidOut([...cells, tube('junction')]).places.get(pieceKey('link')).channel).toBeUndefined()
  })

  it('puts a compartment docked to a fold round the fold, and the fold in the colour of its lumen', () => {
    const layout = laidOut(getBuiltInPieceTemplate('cardiomyocyte').pieces)
    const cell = layout.places.get(pieceKey('sarcolemma'))
    expect(cell.folds).toHaveLength(1)
    expect(cell.folds[0]).toMatchObject({ facetId: 't-tubule', edge: 'top', tone: 'sky' })
    const cleft = rectOf(layout, 'cleft')
    const sr = rectOf(layout, 'sr-membrane')
    // Just the gap between the SR's junctional side and the T-tubule's nearer wall, over the stretch both reach.
    const { at, half, depth } = cell.folds[0]
    expect(cleft.x).toBeLessThan(right(sr))
    expect(right(cleft)).toBeCloseTo(cell.rect.x + at - half)
    expect(cleft.y).toBeGreaterThanOrEqual(sr.y)
    expect(bottom(cleft)).toBeLessThanOrEqual(Math.min(bottom(sr), cell.rect.y + depth))
    expect(cleft.height).toBeGreaterThan(60)
  })

  it('routes a tube between two compartments apart from each other with right angles', () => {
    const layout = laidOut([
      { id: 'a', kind: 'compartment', label: 'A', frame: { x: 0, y: 0, width: 200, height: 100 } },
      { id: 'b', kind: 'compartment', label: 'B', frame: { x: 500, y: 300, width: 200, height: 100 } },
      { id: 't', kind: 'tube', label: 'T', ends: ['a', 'b'] },
    ])
    const tube = layout.places.get(pieceKey('t'))
    expect(tube).toMatchObject({ kind: 'link', flow: 'flow', site: 'pieces/t' })
    expect(tube.points).toEqual([
      { x: 200, y: 50 },
      { x: 600, y: 50 },
      { x: 600, y: 300 },
    ])
  })
})

describe('routeTube', () => {
  const a = { x: 0, y: 0, width: 100, height: 100 }

  it('runs straight across where the two face each other', () => {
    expect(routeTube(a, { x: 300, y: 50, width: 100, height: 100 })).toEqual([
      { x: 100, y: 75 },
      { x: 300, y: 75 },
    ])
    expect(routeTube(a, { x: 20, y: 300, width: 100, height: 100 })).toEqual([
      { x: 60, y: 100 },
      { x: 60, y: 300 },
    ])
    expect(routeTube({ x: 300, y: 0, width: 100, height: 100 }, a)).toEqual([
      { x: 300, y: 50 },
      { x: 100, y: 50 },
    ])
  })

  it('bends once where they don’t, the bend inside neither', () => {
    const b = { x: 300, y: 300, width: 100, height: 100 }
    expect(routeTube(a, b)).toEqual([
      { x: 100, y: 50 },
      { x: 350, y: 50 },
      { x: 350, y: 300 },
    ])
    expect(routeTube(b, a)).toEqual([
      { x: 300, y: 350 },
      { x: 50, y: 350 },
      { x: 50, y: 100 },
    ])
  })

  it('goes through the bends it is given, square at each', () => {
    const b = { x: 300, y: 300, width: 100, height: 100 }
    const points = routeTube(a, b, [
      { x: 200, y: 50 },
      { x: 200, y: 350 },
    ])
    expect(points).toEqual([
      { x: 100, y: 50 },
      { x: 200, y: 50 },
      { x: 200, y: 350 },
      { x: 300, y: 350 },
    ])
    for (let i = 1; i < points.length; i++) {
      expect(points[i].x === points[i - 1].x || points[i].y === points[i - 1].y).toBe(true)
    }
  })
})

describe('a tube too short for its module', () => {
  it('has its module’s room beside its way, clear of both ends', () => {
    const layout = laidOut([
      { id: 'a', kind: 'compartment', label: 'A', frame: { x: 0, y: 0, width: 300, height: 200 } },
      { id: 'b', kind: 'compartment', label: 'B', frame: { x: 360, y: 0, width: 300, height: 200 } },
      { id: 't', kind: 'tube', label: 'T', ends: ['a', 'b'] },
    ])
    const { zone, points } = layout.places.get(pieceKey('t'))
    expect(points).toEqual([
      { x: 300, y: 100 },
      { x: 360, y: 100 },
    ])
    const clear = (rect) => zone.y >= rect.y + rect.height || zone.y + zone.height <= rect.y
    expect(clear({ x: 0, y: 0, width: 300, height: 200 })).toBe(true)
  })
})

describe('a tube between a compartment and one inside it', () => {
  it('is the joint on the inner one’s side', () => {
    const layout = laidOut([
      { id: 'outer', kind: 'compartment', label: 'Outer', frame: { x: 0, y: 0, width: 600, height: 400 } },
      {
        id: 'inner',
        kind: 'compartment',
        label: 'Inner',
        parent: 'outer',
        frame: { x: 100, y: 100, width: 200, height: 100 },
      },
      { id: 't', kind: 'tube', label: 'T', ends: ['outer', 'inner'], flux: 'diffusion' },
    ])
    const tube = layout.places.get(pieceKey('t'))
    expect(tube).toMatchObject({ joint: 'diffusion' })
    expect(tube.zone.x + tube.zone.width / 2).toBe(300)
    expect(tube.zone.y + tube.zone.height / 2).toBe(150)
  })
})

describe('a process zone spanning its cell', () => {
  it('stays within the cell, which grows only for the zone’s cards', () => {
    const layout = laidOut([
      { id: 'cell', kind: 'compartment', label: 'Cell' },
      { id: 'pm', kind: 'membrane', label: 'PM', encloses: ['cell'], frame: { x: 0, y: 0, width: 320, height: 240 } },
      { id: 'zone', kind: 'zone', label: 'Zone', compartment: 'cell' },
    ])
    const cell = rectOf(layout, 'pm')
    const zone = rectOf(layout, 'zone')
    expect(cell.width).toBe(320)
    expect(contains(cell, zone)).toBe(true)
  })
})

describe('process zones with frames', () => {
  const cell = [
    { id: 'cell', kind: 'compartment', label: 'Cell' },
    { id: 'pm', kind: 'membrane', label: 'PM', encloses: ['cell'] },
  ]
  const zone = (id) => ({ id, kind: 'zone', label: id, compartment: 'cell' })
  const cards = (id, count) =>
    Array.from({ length: count }, (_, n) => ({ id: `${id}-${n}`, data: { bioView: { site: `pieces/${id}` } } }))
  const overlap = (a, b) => a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a)
  /** The pieces as resizing one to a rect leaves them, as the view does. */
  const resized = (pieces, id, rect, options) => {
    const { pieces: valid } = validatePieces(pieces)
    const raw = resizeFrame(valid, id, rect, layoutPieces(valid, options).rects)
    expect(validatePieces(raw).errors).toEqual([])
    return raw
  }

  it('keeps a zone at least as big as its processes need, however small it is made', () => {
    const pieces = [...cell, zone('z')]
    const nodes = cards('z', 3)
    const before = rectOf(laidOut(pieces, { nodes }), 'z')
    const tiny = resized(pieces, 'z', { x: before.x, y: before.y, width: 20, height: 20 }, { nodes })
    const after = rectOf(laidOut(tiny, { nodes }), 'z')
    expect(after.width).toBeGreaterThanOrEqual(3 * (GLYPH_WIDTH + LABEL_GAP))
    expect(after.height).toBe(before.height)
    expect(contains(rectOf(laidOut(tiny, { nodes }), 'pm'), after)).toBe(true)
  })

  it('gives a zone fitted to its contents the least size they need', () => {
    const pieces = [...cell, zone('z')]
    const nodes = cards('z', 2)
    const before = rectOf(laidOut(pieces, { nodes }), 'z')
    const big = resized(pieces, 'z', { ...before, width: before.width + 300, height: before.height + 200 }, { nodes })
    const fitted = rectOf(laidOut(fitToContents(big, 'z'), { nodes }), 'z')
    expect(fitted.height).toBe(before.height)
    expect(fitted.width).toBeLessThan(before.width)
  })

  it('leaves its container as it was when a zone is first moved, and grows it with a band’s margin past one', () => {
    for (const host of [{ id: 'cell', kind: 'compartment', label: 'Cell' }, ...cell.slice(1)]) {
      const pieces = host.kind === 'membrane' ? [...cell, zone('z')] : [host, zone('z')]
      const outer = host.kind === 'membrane' ? 'pm' : 'cell'
      const { pieces: valid } = validatePieces(pieces)
      const before = layoutPieces(valid)
      const nudged = laidOut(moveFrame(valid, 'z', { x: 0, y: 1 }, before.rects))
      expect(rectOf(nudged, outer).width, outer).toBe(rectOf(before, outer).width)
      const z = rectOf(before, 'z')
      const pushed = laidOut(moveFrame(valid, 'z', { x: 100, y: 0 }, before.rects))
      expect(right(rectOf(pushed, outer)) - right(rectOf(pushed, 'z')), outer).toBe(z.x - rectOf(before, outer).x)
    }
  })

  it('moves a zone with no frame past the row a resized one stands in', () => {
    const pieces = [...cell, zone('a'), zone('b')]
    const a = rectOf(laidOut(pieces), 'a')
    const after = laidOut(resized(pieces, 'a', { ...a, width: a.width - 40 }))
    expect(overlap(rectOf(after, 'a'), rectOf(after, 'b'))).toBe(false)
    expect(contains(rectOf(after, 'pm'), rectOf(after, 'b'))).toBe(true)
  })

  it('pushes a resized zone out of the way of another grown for its processes', () => {
    const pieces = [...cell, zone('a'), zone('b')]
    const first = laidOut(pieces)
    const a = rectOf(first, 'a')
    const b = rectOf(first, 'b')
    const both = resized(resized(pieces, 'a', { ...a, width: 120 }), 'b', { ...b, x: a.x + 140, y: a.y, width: 120 })
    const apart = laidOut(both)
    expect(overlap(rectOf(apart, 'a'), rectOf(apart, 'b'))).toBe(false)
    // Its processes grow a past where b stood, so b moves on to keep the gap it had.
    const nodes = cards('a', 4)
    const pushed = laidOut(both, { nodes })
    expect(rectOf(pushed, 'a').width).toBeGreaterThan(140)
    expect(overlap(rectOf(pushed, 'a'), rectOf(pushed, 'b'))).toBe(false)
    expect(rectOf(pushed, 'b').x - right(rectOf(pushed, 'a'))).toBe(20)
  })
})

describe('what stands in a cell with a fold', () => {
  /** A cell with a fold in from one side, and what stands in it. */
  const folded = (side, at, ...inside) => [
    { id: 'cell', kind: 'compartment', label: 'Cell' },
    { id: 'pm', kind: 'membrane', label: 'PM', encloses: ['cell'] },
    { id: 'f', kind: 'fold', label: 'Fold', membrane: 'pm', side, at },
    ...inside,
  ]
  const apart = (a, b) => right(a) <= b.x || right(b) <= a.x || bottom(a) <= b.y || bottom(b) <= a.y
  const zone = (id) => ({ id, kind: 'zone', label: id, compartment: 'cell' })
  /** Nodes bound to a zone, as its processes. */
  const cards = (id, count) =>
    Array.from({ length: count }, (_, n) => ({ id: `${id}-${n}`, data: { bioView: { site: `pieces/${id}` } } }))

  it('runs a process zone along the wider side of a fold it would cross, in the row it is in', () => {
    const plain = laidOut(folded('bottom', 0.75, zone('z')))
    const layout = laidOut(folded('top', 0.75, zone('z')))
    const cell = rectOf(layout, 'pm')
    const pocket = pocketOf(layout)
    const z = rectOf(layout, 'z')
    expect(z.y).toBe(rectOf(plain, 'z').y)
    expect(apart(z, pocket)).toBe(true)
    // The side before the fold, the wider one, and none of the other.
    expect(z.x).toBeLessThan(pocket.x)
    expect(z.width).toBeGreaterThan(right(cell) - right(pocket))
    expect(contains(cell, z)).toBe(true)
  })

  it('takes the side past a fold when that is the wider', () => {
    const layout = laidOut(folded('top', 0.2, zone('z')))
    expect(rectOf(layout, 'z').x).toBeGreaterThan(right(pocketOf(layout)))
  })

  it('stops a zone short of a fold in from the cell’s side across its row', () => {
    for (const side of ['left', 'right']) {
      const layout = laidOut(folded(side, 0.15, zone('z')))
      const pocket = pocketOf(layout)
      expect(apart(rectOf(layout, 'z'), pocket), side).toBe(true)
      expect(contains(rectOf(layout, 'pm'), rectOf(layout, 'z')), side).toBe(true)
    }
  })

  it('grows the cell until a zone’s processes fit beside the fold', () => {
    for (const side of ['top', 'left', 'right']) {
      for (const at of [0.15, 0.5, 0.75]) {
        const layout = laidOut(folded(side, at, zone('z')), { nodes: cards('z', 3) })
        const z = rectOf(layout, 'z')
        expect(apart(z, pocketOf(layout)), `${side} ${at}`).toBe(true)
        // Room for each cartoon and its name, and a spare place past them.
        expect(z.width, `${side} ${at}`).toBeGreaterThanOrEqual(4 * (GLYPH_WIDTH + LABEL_GAP))
      }
    }
  })

  it('moves what stands in the cell clear of a fold, whether placed in a row or by its frame', () => {
    const organelle = (frame) => [
      { id: 'org', kind: 'compartment', label: 'Org', parent: 'cell' },
      { id: 'om', kind: 'membrane', label: 'OM', parent: 'cell', encloses: ['org'], ...(frame && { frame }) },
    ]
    for (const side of ['top', 'bottom', 'left', 'right']) {
      for (const at of [0.2, 0.5]) {
        for (const frame of [
          null,
          { x: 0, y: 0, width: 220, height: 150 },
          { x: 300, y: 200, width: 220, height: 150 },
        ]) {
          const layout = laidOut(folded(side, at, zone('z'), ...organelle(frame)))
          const om = rectOf(layout, 'om')
          const where = `${side} ${at} ${JSON.stringify(frame)}`
          expect(apart(om, pocketOf(layout)), where).toBe(true)
          expect(contains(rectOf(layout, 'pm'), om), where).toBe(true)
        }
      }
    }
  })

  it('leaves an organelle beside a fold where it is, with the cleft between them', () => {
    const layout = laidOut(getBuiltInPieceTemplate('cardiomyocyte').pieces)
    const cell = rectOf(layout, 'sarcolemma')
    expect(rectOf(layout, 'sr-membrane')).toMatchObject({ x: cell.x + 80, y: cell.y + 310 })
    for (const id of ['myofilaments', 'mitochondria'])
      expect(apart(rectOf(layout, id), pocketOf(layout, 'sarcolemma'))).toBe(true)
  })
})

/** The pocket of a membrane's fold, its lumen between its walls, in the view's coordinates. */
function pocketOf(layout, membrane = 'pm') {
  const cell = layout.places.get(pieceKey(membrane))
  const { edge, at, half, depth } = cell.folds[0]
  const { x, y, width, height } = cell.rect
  if (edge === 'top') return { x: x + at - half, y, width: 2 * half, height: depth }
  if (edge === 'bottom') return { x: x + at - half, y: y + height - depth, width: 2 * half, height: depth }
  if (edge === 'left') return { x, y: y + at - half, width: depth, height: 2 * half }
  return { x: x + width - depth, y: y + at - half, width: depth, height: 2 * half }
}

describe('making room for what grows', () => {
  /** A cell grown past its frame by proteins on its top side, and compartments standing by it. */
  const proteins = (count) =>
    Array.from({ length: count }, (_, n) => ({
      id: `p${n}`,
      data: { name: `p${n}`, bioView: { site: 'pieces/pm.top' } },
    }))
  const cell = { id: 'cell', kind: 'compartment', label: 'Cell' }
  const pm = {
    id: 'pm',
    kind: 'membrane',
    label: 'PM',
    encloses: ['cell'],
    frame: { x: 0, y: 0, width: 320, height: 240 },
    sides: { top: [{ id: 'top', label: 'Top' }] },
  }
  const beside = (id, x, y) => ({ id, kind: 'compartment', label: id, frame: { x, y, width: 200, height: 120 } })

  it('pushes what it now covers right, keeping the gap it had', () => {
    const raw = [cell, pm, beside('r', 360, 0)]
    const grown = laidOut(raw, { nodes: proteins(6) })
    const cellRect = rectOf(grown, 'pm')
    expect(cellRect.width).toBeGreaterThan(360)
    expect(rectOf(grown, 'r')).toMatchObject({ x: right(cellRect) + 40, y: 0 })
    // With nothing on it, it is where its frame puts it.
    expect(rectOf(laidOut(raw), 'r')).toMatchObject({ x: 360, y: 0 })
  })

  it('pushes what lies below it down, and on to what that then covers', () => {
    const tall = { ...pm, sides: { left: [{ id: 'left', label: 'Left' }] } }
    const nodes = Array.from({ length: 5 }, (_, n) => ({
      id: `p${n}`,
      data: { name: `p${n}`, bioView: { site: 'pieces/pm.left' } },
    }))
    const layout = laidOut([cell, tall, beside('b', 0, 280), beside('bb', 0, 420)], { nodes })
    const cellRect = rectOf(layout, 'pm')
    expect(cellRect.height).toBeGreaterThan(280)
    expect(rectOf(layout, 'b').y).toBe(bottom(cellRect) + 40)
    expect(rectOf(layout, 'bb').y).toBe(bottom(rectOf(layout, 'b')) + 20)
  })

  it('leaves alone what overlapped it at their frames, as it was put so', () => {
    const layout = laidOut([cell, pm, beside('o', 200, 100)], { nodes: proteins(6) })
    expect(rectOf(layout, 'o')).toMatchObject({ x: 200, y: 100 })
  })
})

describe('process zone margins', () => {
  const compartment = { id: 'c', kind: 'compartment', label: 'C' }
  const membrane = { id: 'm', kind: 'membrane', label: 'M', encloses: ['c'] }
  const zone = (id, frame) => ({ id, kind: 'zone', label: id, compartment: 'c', ...(frame && { frame }) })
  const marginsOf = (layout, host, id) => {
    const [outer, inner] = [rectOf(layout, host), rectOf(layout, id)]
    return {
      left: inner.x - outer.x,
      top: inner.y - outer.y,
      right: right(outer) - right(inner),
      bottom: bottom(outer) - bottom(inner),
    }
  }

  it('keeps a zone the same margin from each side of a compartment, at least, past its name', () => {
    const { left, top, right: past, bottom: below } = marginsOf(laidOut([compartment, zone('z')]), 'c', 'z')
    expect([top, past]).toEqual([left, left])
    expect(below).toBeGreaterThanOrEqual(left)
  })

  it('keeps a zone further in from a membrane, past its band and clear of its rounded corners', () => {
    const plain = marginsOf(laidOut([compartment, zone('z')]), 'c', 'z')
    const tight = { ...membrane, frame: { x: 0, y: 0, width: 120, height: 120 } }
    const inCell = marginsOf(laidOut([compartment, tight, zone('z')]), 'm', 'z')
    expect([inCell.top, inCell.right]).toEqual([inCell.left, inCell.left])
    expect(inCell.left).toBeGreaterThan(plain.left)
    // Its rounded corner keeps its margin from the inside of the band round the cell's corner.
    const fromCorner = Math.hypot(CELL_RADIUS - (inCell.left + 8), CELL_RADIUS - (inCell.top + 8)) + 8
    expect(CELL_RADIUS - 12 - fromCorner).toBeGreaterThanOrEqual(plain.left)
  })

  it('keeps a zone dragged into a corner its margin in, as one laid out in a row is', () => {
    const row = marginsOf(laidOut([compartment, membrane, zone('z')]), 'm', 'z')
    const dragged = laidOut([compartment, membrane, zone('z', { x: 0, y: 0, width: 200, height: 88 })])
    expect(marginsOf(dragged, 'm', 'z')).toMatchObject({ left: row.left, top: row.top })
  })

  it('keeps a zone clear of the proteins on a side of a membrane, with their names', () => {
    const bare = marginsOf(laidOut([compartment, membrane, zone('z')]), 'm', 'z')
    const nodes = [{ id: 'p', data: { name: 'p', bioView: { site: 'pieces/m.top' } } }]
    const withProtein = marginsOf(laidOut([compartment, membrane, zone('z')], { nodes }), 'm', 'z')
    expect(withProtein.top).toBeGreaterThan(bare.top)
    expect(withProtein.left).toBe(bare.left)
  })
})

describe('a joint between cells that touch', () => {
  const cellAt = (id, x, y) => [
    { id, kind: 'compartment', label: id },
    { id: `m${id}`, kind: 'membrane', label: `M${id}`, encloses: [id], frame: { x, y, width: 320, height: 240 } },
  ]
  const joined = (dy) =>
    laidOut([
      ...cellAt('a', 0, 0),
      ...cellAt('b', 320, dy),
      { id: 't', kind: 'tube', label: 'T', ends: ['a', 'b'], flux: 'bridge' },
    ]).places.get(pieceKey('t')).zone

  it('sits in the middle of the side they share, as big as a joint is', () => {
    const zone = joined(0)
    expect(zone.y + zone.height / 2).toBe(120)
    expect(zone.height).toBe(joined(60).height)
  })

  it('is no longer than where both membranes run straight, past their rounded corners, where they share little', () => {
    // They share 100 to 240 down; both run straight from 100 + CELL_RADIUS to 240 - CELL_RADIUS.
    const zone = joined(100)
    expect(zone.y).toBe(100 + CELL_RADIUS)
    expect(bottom(zone)).toBe(240 - CELL_RADIUS)
  })
})
