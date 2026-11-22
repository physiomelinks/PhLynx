import { describe, expect, it } from 'vitest'

import {
  BUILT_IN_PIECE_TEMPLATES,
  getBuiltInPieceTemplate,
} from '../../../../../src/services/bioView/pieces/builtInTemplates.js'
import { layoutPieces, membraneKey, pieceKey, routeTube } from '../../../../../src/services/bioView/pieces/layout.js'
import { validatePieces } from '../../../../../src/services/bioView/pieces/model.js'
import { GLYPH_WIDTH, MIN_CELL } from '../../../../../src/services/bioView/geometry.js'
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
  it('draws a membrane as a cell, its bulk filling it, at its frame and at least the least size', () => {
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
    expect(place.rect).toMatchObject({ x: 40, y: 60 })
    expect(place.rect.width).toBeGreaterThanOrEqual(MIN_CELL.width)
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
