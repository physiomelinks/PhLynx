import { describe, expect, it } from 'vitest'

import { getBuiltInPieceTemplate } from '../../../../../src/services/bioView/pieces/builtInTemplates.js'
import { layoutPieces, pieceKey } from '../../../../../src/services/bioView/pieces/layout.js'
import { validatePieces } from '../../../../../src/services/bioView/pieces/model.js'
import {
  bendTube,
  dragModeOf,
  fitToContents,
  moveFold,
  moveFrame,
  reattachTube,
  resizeFrame,
  setDepth,
  slideDock,
} from '../../../../../src/services/bioView/pieces/moves.js'
import { topologyOf } from '../../../../../src/services/bioView/pieces/topology.js'

const valid = (raw) => {
  const { pieces, errors } = validatePieces(raw)
  expect(errors).toEqual([])
  return pieces
}
const rectsOf = (pieces) => layoutPieces(pieces).rects
const byId = (pieces, id) => pieces.find((piece) => piece.id === id)

const cardiomyocyte = valid(getBuiltInPieceTemplate('cardiomyocyte').pieces)

/** A cell with a microdomain docked along the middle of its top, inside. */
const withMicrodomain = valid([
  { id: 'cell', kind: 'compartment', label: 'Cell' },
  {
    id: 'pm',
    kind: 'membrane',
    label: 'PM',
    encloses: ['cell'],
    frame: { x: 0, y: 0, width: 400, height: 300 },
    sides: {
      top: [
        { id: 'top', label: 'Top', to: 0.25 },
        { id: 'md', label: 'Microdomain', to: 0.5 },
        { id: 'top-2', label: 'Top' },
      ],
    },
  },
  {
    id: 'md',
    kind: 'compartment',
    label: 'MD',
    parent: 'cell',
    docks: [{ on: 'pm', side: 'top', face: 'inside', from: 0.25, to: 0.5 }],
  },
])

describe('dragModeOf', () => {
  it('moves membranes, free compartments and zones by their frames, docked stretches along their side', () => {
    expect(dragModeOf(cardiomyocyte, 'sarcolemma')).toBe('frame')
    expect(dragModeOf(cardiomyocyte, 'sr-membrane')).toBe('frame')
    expect(dragModeOf(cardiomyocyte, 'myofilaments')).toBe('frame')
    expect(dragModeOf(withMicrodomain, 'md')).toBe('slide')
    // A bulk is its membrane's to move; a fluid along a whole side has nowhere to go; a cleft is held by its docks.
    expect(dragModeOf(cardiomyocyte, 'myocyte')).toBeNull()
    expect(dragModeOf(cardiomyocyte, 'extracellular')).toBeNull()
    expect(dragModeOf(cardiomyocyte, 'cleft')).toBeNull()
    expect(dragModeOf(cardiomyocyte, 't-tubule')).toBeNull()
  })
})

describe('moveFrame', () => {
  it('moves a cell, and everything in and against it with it', () => {
    const rects = rectsOf(cardiomyocyte)
    const moved = valid(moveFrame(cardiomyocyte, 'sarcolemma', { x: 100, y: 50 }, rects))
    const after = rectsOf(moved)
    for (const id of ['sarcolemma', 'sr-membrane', 'extracellular', 'cleft', 'myofilaments']) {
      expect(after.get(id), id).toMatchObject({ x: rects.get(id).x + 100, y: rects.get(id).y + 50 })
    }
  })

  it('keeps an organelle in its cell’s top and left, and grows the cell past its right', () => {
    const rects = rectsOf(cardiomyocyte)
    const up = valid(moveFrame(cardiomyocyte, 'sr-membrane', { x: -1000, y: -1000 }, rects))
    expect(byId(up, 'sr-membrane').frame).toMatchObject({ x: 8, y: 8 })
    const out = valid(moveFrame(cardiomyocyte, 'sr-membrane', { x: 800, y: 0 }, rects))
    const cell = rectsOf(out).get('sarcolemma')
    const sr = rectsOf(out).get('sr-membrane')
    expect(cell.x + cell.width).toBeGreaterThan(sr.x + sr.width)
  })

  it('moves an organelle drawn clear of a fold from where it is drawn, not the frame that put it on the fold', () => {
    // Its frame puts the SR on the T-tubule; it is drawn beside it.
    const onFold = valid(
      cardiomyocyte.map((piece) =>
        piece.id === 'sr-membrane' ? { ...piece, frame: { ...piece.frame, x: 420, y: 100 } } : piece,
      ),
    )
    const rects = rectsOf(onFold)
    const cell = rects.get('sarcolemma')
    const drawn = rects.get('sr-membrane')
    expect(drawn.x - cell.x).not.toBe(420)
    const moved = valid(moveFrame(onFold, 'sr-membrane', { x: 0, y: 10 }, rects))
    expect(byId(moved, 'sr-membrane').frame).toMatchObject({ x: drawn.x - cell.x, y: drawn.y - cell.y + 10 })
  })

  it('gives a zone placed in a row a frame of its own where it is dropped', () => {
    const rects = rectsOf(cardiomyocyte)
    const moved = valid(moveFrame(cardiomyocyte, 'mitochondria', { x: 0, y: 200 }, rects))
    const cell = rects.get('sarcolemma')
    expect(byId(moved, 'mitochondria').frame).toMatchObject({ y: rects.get('mitochondria').y - cell.y + 200 })
  })

  it('leaves the other zones in its compartment where they are when a zone moves onto them', () => {
    const raw = [
      { id: 'cell', kind: 'compartment', label: 'Cell' },
      { id: 'pm', kind: 'membrane', label: 'PM', encloses: ['cell'], frame: { x: 0, y: 0, width: 600, height: 500 } },
      { id: 'a', kind: 'zone', label: 'A', compartment: 'cell' },
      { id: 'b', kind: 'zone', label: 'B', compartment: 'cell' },
      { id: 'c', kind: 'zone', label: 'C', compartment: 'cell' },
    ]
    const pieces = valid(raw)
    const rects = rectsOf(pieces)
    const delta = { x: 0, y: rects.get('b').y - rects.get('a').y }
    const after = rectsOf(valid(moveFrame(pieces, 'a', delta, rects)))
    expect(after.get('a').y).toBe(rects.get('b').y)
    for (const id of ['b', 'c']) expect(after.get(id)).toMatchObject({ x: rects.get(id).x, y: rects.get(id).y })
  })

  it('puts a zone added among placed ones in a spare row, touching none of them', () => {
    const pieces = valid([
      { id: 'cell', kind: 'compartment', label: 'Cell' },
      { id: 'pm', kind: 'membrane', label: 'PM', encloses: ['cell'], frame: { x: 0, y: 0, width: 600, height: 500 } },
      { id: 'a', kind: 'zone', label: 'A', compartment: 'cell', frame: { x: 24, y: 30, width: 300, height: 100 } },
      { id: 'b', kind: 'zone', label: 'B', compartment: 'cell' },
    ])
    const rects = rectsOf(pieces)
    const [a, b] = [rects.get('a'), rects.get('b')]
    const apart = b.y >= a.y + a.height + 8 || a.y >= b.y + b.height + 8
    expect(apart).toBe(true)
  })
})

/** A cell with a gap junction to one on its right, which has one to a cell below it, and a fourth bridged apart. */
const cellAt = (id, x, y) => [
  { id, kind: 'compartment', label: id.toUpperCase() },
  {
    id: `${id}m`,
    kind: 'membrane',
    label: `${id.toUpperCase()}M`,
    encloses: [id],
    frame: { x, y, width: 200, height: 100 },
  },
]
const junctioned = valid([
  ...cellAt('a', 100, 100),
  ...cellAt('b', 300, 100),
  ...cellAt('c', 300, 200),
  ...cellAt('d', 800, 100),
  { id: 'ab', kind: 'tube', label: 'AB', ends: ['a', 'b'], flux: 'junction' },
  { id: 'bc', kind: 'tube', label: 'BC', ends: ['b', 'c'], flux: 'junction' },
  { id: 'bd', kind: 'tube', label: 'BD', ends: ['b', 'd'], flux: 'bridge' },
])
const junctionsBroken = (pieces) => ['ab', 'bc'].map((id) => !!layoutPieces(pieces).places.get(pieceKey(id)).broken)

describe('gap junctions hold their cells together', () => {
  it('moves a cell with every cell joined to it by gap junctions, but not one joined by a bridge', () => {
    const rects = rectsOf(junctioned)
    expect(junctionsBroken(junctioned)).toEqual([false, false])
    const moved = valid(moveFrame(junctioned, 'am', { x: 150, y: 40 }, rects))
    const after = rectsOf(moved)
    for (const id of ['am', 'bm', 'cm']) {
      expect(after.get(id), id).toMatchObject({ x: rects.get(id).x + 150, y: rects.get(id).y + 40 })
    }
    expect(after.get('dm')).toMatchObject({ x: rects.get('dm').x, y: rects.get('dm').y })
    expect(junctionsBroken(moved)).toEqual([false, false])
  })

  it('stops the whole group where any of it would leave the view', () => {
    const rects = rectsOf(junctioned)
    const moved = valid(moveFrame(junctioned, 'cm', { x: -5000, y: 0 }, rects))
    const after = rectsOf(moved)
    const shift = after.get('am').x - rects.get('am').x
    for (const id of ['bm', 'cm']) expect(after.get(id).x - rects.get(id).x, id).toBe(shift)
    expect(junctionsBroken(moved)).toEqual([false, false])
  })

  it('keeps the cells against a resized cell, each as its side moves, those beyond going with them', () => {
    const rects = rectsOf(junctioned)
    const rectsOfRaw = (raw) => rectsOf(valid(raw))
    // A widened leftwards: B and C stay; widened rightwards, they move along.
    const a = rects.get('am')
    const left = valid(
      resizeFrame(junctioned, 'am', { ...a, x: a.x - 50, width: a.width + 50 }, rects, { rectsOf: rectsOfRaw }),
    )
    expect(rectsOf(left).get('bm')).toMatchObject({ x: rects.get('bm').x })
    const right = valid(resizeFrame(junctioned, 'am', { ...a, width: a.width + 80 }, rects, { rectsOf: rectsOfRaw }))
    for (const id of ['bm', 'cm']) expect(rectsOf(right).get(id).x, id).toBe(rects.get(id).x + 80)
    expect(junctionsBroken(right)).toEqual([false, false])
    // B made taller: C, below it, moves down; A, to its left, stays; D, bridged, stays.
    const b = rects.get('bm')
    const taller = valid(resizeFrame(junctioned, 'bm', { ...b, height: b.height + 60 }, rects, { rectsOf: rectsOfRaw }))
    const after = rectsOf(taller)
    expect(after.get('cm').y).toBe(rects.get('cm').y + 60)
    expect(after.get('am')).toMatchObject({ x: rects.get('am').x, y: rects.get('am').y })
    expect(after.get('dm')).toMatchObject({ x: rects.get('dm').x, y: rects.get('dm').y })
    expect(junctionsBroken(taller)).toEqual([false, false])
  })
})

describe('resizeFrame and fitToContents', () => {
  it('sizes a cell at least as big as it is resized, and back to what its contents need', () => {
    const rects = rectsOf(cardiomyocyte)
    const cell = rects.get('sarcolemma')
    const big = valid(resizeFrame(cardiomyocyte, 'sarcolemma', { ...cell, width: cell.width + 200 }, rects))
    expect(rectsOf(big).get('sarcolemma').width).toBe(cell.width + 200)
    const fitted = valid(fitToContents(big, 'sarcolemma'))
    expect(rectsOf(fitted).get('sarcolemma').width).toBeLessThan(cell.width)
  })
})

describe('slideDock', () => {
  it('slides a microdomain along its side, its span and the spans beside it going with it', () => {
    const rects = rectsOf(withMicrodomain)
    // A tenth of the side along; across it counts for nothing.
    const width = rects.get('pm').width
    const slid = valid(slideDock(withMicrodomain, 'md', { x: width / 10, y: 300 }, rects))
    expect(byId(slid, 'md').docks[0]).toMatchObject({ from: 0.35, to: 0.6 })
    const top = topologyOf(slid)
      .spansOf('pm')
      .filter((span) => span.side === 'top')
    expect(top.map(({ id, from, to }) => [id, from, to])).toEqual([
      ['top', 0, 0.35],
      ['md', 0.35, 0.6],
      ['top-2', 0.6, 1],
    ])
    expect(topologyOf(slid).insideOf('pm.md')).toBe('md')
  })

  it('stops short of leaving a span beside it too short', () => {
    const rects = rectsOf(withMicrodomain)
    const slid = valid(slideDock(withMicrodomain, 'md', { x: -2000, y: 0 }, rects))
    expect(byId(slid, 'md').docks[0]).toMatchObject({ from: 0.05, to: 0.3 })
  })
})

describe('setDepth, moveFold, bendTube and reattachTube', () => {
  it('sets a docked compartment’s depth', () => {
    expect(byId(valid(setDepth(cardiomyocyte, 'extracellular', 60)), 'extracellular').depth).toBe(60)
  })

  it('moves a fold along its side to its grip, as deep as the grip is', () => {
    const rects = rectsOf(cardiomyocyte)
    const cell = rects.get('sarcolemma')
    const moved = valid(moveFold(cardiomyocyte, 't-tubule', { x: cell.x + cell.width / 2, y: cell.y + 200 }, rects))
    expect(byId(moved, 't-tubule')).toMatchObject({ at: 0.5, depth: 200 })
  })

  it('bends a tube through a point, its room there, and joins an end to another compartment', () => {
    const start = valid([
      { id: 'a', kind: 'compartment', label: 'A', frame: { x: 0, y: 0, width: 200, height: 100 } },
      { id: 'b', kind: 'compartment', label: 'B', frame: { x: 500, y: 0, width: 200, height: 100 } },
      { id: 'c', kind: 'compartment', label: 'C', frame: { x: 0, y: 400, width: 200, height: 100 } },
      { id: 't', kind: 'tube', label: 'T', ends: ['a', 'b'] },
    ])
    const bent = valid(bendTube(start, 't', { x: 350, y: 80 }))
    const place = layoutPieces(bent).places.get(pieceKey('t'))
    expect(place.points).toEqual([
      { x: 200, y: 80 },
      { x: 350, y: 80 },
      { x: 500, y: 80 },
    ])
    expect(place.zone.x + place.zone.width / 2).toBe(350)
    const moved = valid(reattachTube(bent, 't', 1, 'c'))
    expect(byId(moved, 't')).toMatchObject({ ends: ['a', 'c'] })
    expect(byId(moved, 't').bends).toBeUndefined()
    expect(reattachTube(bent, 't', 1, 'a')).toBeNull()
  })

  it('reattached, a tube carries what it joins now, renamed for it unless someone has named it', () => {
    const start = valid([
      { id: 'a', kind: 'compartment', label: 'A', frame: { x: 0, y: 0, width: 200, height: 100 } },
      { id: 'b', kind: 'compartment', label: 'B' },
      { id: 'bm', kind: 'membrane', label: 'BM', encloses: ['b'], frame: { x: 300, y: 0, width: 200, height: 100 } },
      { id: 'c', kind: 'compartment', label: 'C' },
      { id: 'cm', kind: 'membrane', label: 'CM', encloses: ['c'], frame: { x: 600, y: 0, width: 200, height: 100 } },
      { id: 't', kind: 'tube', label: 'Tube', ends: ['b', 'a'], flux: 'flow' },
      { id: 'named', kind: 'tube', label: 'Leak', ends: ['b', 'a'], flux: 'flow' },
      { id: 'd', kind: 'tube', label: 'D', ends: ['b', 'a'], flux: 'diffusion' },
    ])
    expect(byId(valid(reattachTube(start, 't', 1, 'c')), 't')).toMatchObject({
      flux: 'junction',
      label: 'Gap junction',
    })
    expect(byId(valid(reattachTube(start, 't', 1, 'c', 'bridge')), 't')).toMatchObject({
      flux: 'bridge',
      label: 'Bridge',
    })
    expect(byId(valid(reattachTube(start, 'named', 1, 'c')), 'named')).toMatchObject({
      flux: 'junction',
      label: 'Leak',
    })
    expect(byId(valid(reattachTube(start, 'd', 1, 'c')), 'd')).toMatchObject({ flux: 'diffusion' })
  })

  it('puts grips on a routed tube’s ends and above its room, and at a fold’s end', () => {
    const start = valid([
      { id: 'a', kind: 'compartment', label: 'A', frame: { x: 0, y: 0, width: 200, height: 100 } },
      { id: 'b', kind: 'compartment', label: 'B', frame: { x: 500, y: 0, width: 200, height: 100 } },
      { id: 't', kind: 'tube', label: 'T', ends: ['a', 'b'] },
    ])
    const { places } = layoutPieces(start)
    expect(places.get('grip:start:t')).toMatchObject({ kind: 'grip', grip: 'start', piece: 't', end: 0, x: 200, y: 50 })
    expect(places.get('grip:end:t')).toMatchObject({ end: 1, x: 500, y: 50 })
    expect(places.get('grip:bend:t')).toMatchObject({ grip: 'bend', x: 350 })
    expect(layoutPieces(cardiomyocyte).places.get('grip:fold:t-tubule')).toMatchObject({
      grip: 'fold',
      piece: 't-tubule',
    })
  })
})
