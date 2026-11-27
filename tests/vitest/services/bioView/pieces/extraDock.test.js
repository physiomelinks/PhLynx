import { describe, expect, it } from 'vitest'

import { getBuiltInPieceTemplate } from '../../../../../src/services/bioView/pieces/builtInTemplates.js'
import {
  dropScene,
  previewDrop,
  resolveDrop,
  resolveExtraDock,
} from '../../../../../src/services/bioView/pieces/drops.js'
import { addDock, removeDock } from '../../../../../src/services/bioView/pieces/edits.js'
import { reachTo } from '../../../../../src/services/bioView/pieces/moves.js'
import { layoutPieces, pieceKey } from '../../../../../src/services/bioView/pieces/layout.js'
import { validatePieces } from '../../../../../src/services/bioView/pieces/model.js'
import { topologyOf } from '../../../../../src/services/bioView/pieces/topology.js'
import { CELL_RADIUS } from '../../../../../src/services/bioView/geometry.js'

const valid = (raw) => {
  const { pieces, errors } = validatePieces(raw)
  expect(errors).toEqual([])
  return pieces
}
const byId = (pieces, id) => pieces.find((piece) => piece.id === id)

const cardiomyocyte = () => valid(getBuiltInPieceTemplate('cardiomyocyte').pieces)
/** The cardiomyocyte without its dyadic cleft, to build one by hand. */
const withoutCleft = () =>
  valid(getBuiltInPieceTemplate('cardiomyocyte').pieces.filter((piece) => piece.id !== 'cleft'))

/** Drops a compartment against the SR's right side, outside, as the palette does; gives the pieces and its id. */
function cleftAgainstSr() {
  const pieces = withoutCleft()
  const scene = dropScene(pieces)
  const sr = scene.rects.get('sr-membrane')
  const drop = resolveDrop('compartment', { x: sr.x + sr.width + 10, y: sr.y + sr.height / 2 }, scene)
  expect(drop.label).toBe('Against SR membrane’s right side, outside')
  const preview = previewDrop(scene, drop)
  expect(preview.errors).toEqual([])
  return { pieces: preview.pieces, id: preview.id }
}

/** A point just beside the T-tubule's wall nearer the SR, in the cell. */
function besideTubule(scene) {
  const lumen = scene.folds.get('t-tubule')
  return { x: lumen.x - 6, y: lumen.y + lumen.height / 2 }
}

describe('docking a compartment to a second membrane side or fold', () => {
  it('docks a compartment against an organelle to a fold’s walls too, drawn as the template’s dyadic cleft', () => {
    const { pieces, id } = cleftAgainstSr()
    const scene = dropScene(pieces)
    const drop = resolveExtraDock(scene, id, besideTubule(scene))
    expect(drop.label).toBe('Also against T-tubule, round its walls')
    expect(drop.highlights).toEqual([{ type: 'rect', rect: scene.folds.get('t-tubule') }])
    const { pieces: next, errors } = previewDrop(scene, drop)
    expect(errors).toEqual([])
    expect(byId(next, id).docks).toEqual([
      { on: 'sr-membrane', side: 'right', face: 'outside', from: 0, to: 1 },
      { on: 't-tubule', face: 'inside', from: 0, to: 1 },
    ])
    // Drawn just as the cardiomyocyte's own cleft is: the gap between the SR and the T-tubule.
    const built = layoutPieces(next).places.get(pieceKey(id)).rect
    const template = layoutPieces(cardiomyocyte()).places.get(pieceKey('cleft')).rect
    expect(built).toEqual(template)
    // And it meets both: the SR's junctional stretch outside, the T-tubule's walls inside.
    const topology = topologyOf(next)
    expect(topology.outsideOf('sr-membrane.junctional')).toEqual([id])
  })

  it('docks to the inner face of a cell’s side across from an organelle, drawn as the gap between the two', () => {
    const { pieces, id } = cleftAgainstSr()
    const scene = dropScene(pieces)
    const cell = scene.rects.get('sarcolemma')
    const sr = scene.rects.get('sr-membrane')
    const drop = resolveExtraDock(scene, id, { x: cell.x + cell.width - 10, y: sr.y + sr.height / 2 })
    expect(drop.label).toBe('Also inside Sarcolemma, along its right side')
    const { pieces: next, errors } = previewDrop(scene, drop)
    expect(errors).toEqual([])
    const dock = byId(next, id).docks[1]
    expect(dock).toMatchObject({ on: 'sarcolemma', side: 'right', face: 'inside' })
    // The stretch it spans, not the whole side: a protein site of its own. Below it, what is left is too short to
    // draw, so it runs on to the side's end, and the cell keeps its size.
    expect(dock.from).toBeGreaterThan(0)
    expect(dock.to).toBe(1)
    expect(byId(next, 'sarcolemma').sides.right.some((span) => span.from === dock.from && span.to === dock.to)).toBe(
      true,
    )
    const { rects } = layoutPieces(next)
    const gap = rects.get(id)
    const after = rects.get('sarcolemma')
    expect(after).toEqual(cell)
    expect(gap.x).toBe(rects.get('sr-membrane').x + rects.get('sr-membrane').width - CELL_RADIUS / 2)
    expect(gap.x + gap.width).toBe(after.x + after.width - 10)
  })

  it('takes in what it would leave of a cell’s side too short to draw, so the cell keeps its size', () => {
    // A paracellular space: against one cell's right side, reaching to the next cell's left, which stands a little
    // higher and is a little taller, so the space meets its side just below its top and well above its bottom.
    const pieces = valid([
      { id: 'a-in', kind: 'compartment', label: 'A' },
      {
        id: 'a',
        kind: 'membrane',
        label: 'Cell A',
        encloses: ['a-in'],
        frame: { x: 100, y: 100, width: 320, height: 240 },
      },
      { id: 'b-in', kind: 'compartment', label: 'B' },
      {
        id: 'b',
        kind: 'membrane',
        label: 'Cell B',
        encloses: ['b-in'],
        frame: { x: 600, y: 80, width: 320, height: 300 },
      },
      {
        id: 'gap',
        kind: 'compartment',
        label: 'Gap',
        docks: [{ on: 'a', side: 'right', face: 'outside' }],
        depth: 180,
      },
    ])
    const scene = dropScene(pieces)
    const before = scene.rects.get('b')
    const space = scene.rects.get('gap')
    const drop = resolveExtraDock(scene, 'gap', { x: before.x - 4, y: space.y + space.height / 2 })
    expect(drop.label).toBe('Also against Cell B’s left side, outside')
    const { pieces: next, errors } = previewDrop(scene, drop)
    expect(errors).toEqual([])
    // The slivers above and below the space are too short for a span of their own: the dock takes the whole side.
    expect(byId(next, 'gap').docks[1]).toEqual({ on: 'b', side: 'left', face: 'outside', from: 0, to: 1 })
    expect(layoutPieces(next).rects.get('b')).toEqual(before)
    // Left as slivers, they would have made the cell grow many times as tall to fit them.
    const along = (y) => Math.round(((y - before.y) / before.height) * 1000) / 1000
    const exact = { on: 'b', side: 'left', face: 'outside', from: along(space.y), to: along(space.y + space.height) }
    const slivered = valid(addDock(pieces, 'gap', exact).pieces)
    expect(layoutPieces(slivered).rects.get('b').height).toBeGreaterThan(3 * before.height)
  })

  it('keeps what it would leave of a side where there is room to draw it', () => {
    const pieces = valid([
      { id: 'a-in', kind: 'compartment', label: 'A' },
      {
        id: 'a',
        kind: 'membrane',
        label: 'Cell A',
        encloses: ['a-in'],
        frame: { x: 100, y: 100, width: 320, height: 240 },
      },
      { id: 'b-in', kind: 'compartment', label: 'B' },
      {
        id: 'b',
        kind: 'membrane',
        label: 'Cell B',
        encloses: ['b-in'],
        frame: { x: 600, y: 100, width: 320, height: 600 },
      },
      {
        id: 'gap',
        kind: 'compartment',
        label: 'Gap',
        docks: [{ on: 'a', side: 'right', face: 'outside' }],
        depth: 180,
      },
    ])
    const scene = dropScene(pieces)
    const before = scene.rects.get('b')
    const space = scene.rects.get('gap')
    const drop = resolveExtraDock(scene, 'gap', { x: before.x - 4, y: space.y + space.height / 2 })
    const { pieces: next } = previewDrop(scene, drop)
    const dock = byId(next, 'gap').docks[1]
    // Level with its top, so nothing above; the long stretch below stays a span of its own.
    expect(dock.from).toBe(0)
    expect(dock.to).toBeLessThan(1)
    expect(layoutPieces(next).rects.get('b')).toEqual(before)
  })

  it('offers nothing by the side it is docked to already, nor far from any membrane', () => {
    const { pieces, id } = cleftAgainstSr()
    const scene = dropScene(pieces)
    const sr = scene.rects.get('sr-membrane')
    expect(resolveExtraDock(scene, id, { x: sr.x + sr.width + 4, y: sr.y + sr.height / 2 })?.label).not.toBe(
      'Also against SR membrane’s right side, outside',
    )
    expect(resolveExtraDock(scene, id, { x: -5000, y: -5000 })).toBeNull()
  })

  it('refuses another cell’s side that doesn’t face the one it is against, and takes one that does', () => {
    const cell = (id, x, y) => [
      { id, kind: 'compartment', label: id.toUpperCase() },
      { id: `${id}-pm`, kind: 'membrane', label: `${id.toUpperCase()} membrane`, encloses: [id], frame: { x, y, width: 300, height: 200 } },
    ]
    const pieces = valid([
      ...cell('a', 0, 300),
      ...cell('b', 500, 0),
      ...cell('c', 500, 300),
      { id: 'gap', kind: 'compartment', label: 'Gap', docks: [{ on: 'a-pm', side: 'right', face: 'outside' }] },
    ])
    const scene = dropScene(pieces)
    const b = scene.rects.get('b-pm')
    const top = resolveExtraDock(scene, 'gap', { x: b.x + b.width / 2, y: b.y - 6 })
    expect(top.invalid).toBe('B membrane’s top doesn’t face the side Gap is against.')
    const c = scene.rects.get('c-pm')
    const left = resolveExtraDock(scene, 'gap', { x: c.x - 6, y: c.y + c.height / 2 })
    expect(left.invalid).toBeUndefined()
    expect(left.label).toBe('Also against C membrane’s left side, outside')
  })

  it('says why where a compartment is already against that stretch', () => {
    const { pieces, id } = cleftAgainstSr()
    const scene = dropScene(pieces)
    const cell = scene.rects.get('sarcolemma')
    // The extracellular space is against the sarcolemma's top, outside.
    const drop = resolveExtraDock(scene, id, { x: cell.x + 40, y: cell.y - 10 })
    expect(drop.invalid).toMatch(/already against that stretch of Sarcolemma/)
  })

  it('refuses a compartment docked nowhere, or a second dock to the same target', () => {
    const pieces = cardiomyocyte()
    expect(addDock(pieces, 'sr', { on: 't-tubule', face: 'inside' }).error).toMatch(/Only a compartment against/)
    expect(addDock(pieces, 'cleft', { on: 't-tubule', face: 'outside' }).error).toMatch(/against that already/)
  })

  it('detaches one dock, leaving the rest, but never the last', () => {
    const pieces = cardiomyocyte()
    const once = valid(removeDock(pieces, 'cleft', 1))
    expect(byId(once, 'cleft').docks).toEqual([{ on: 't-tubule', face: 'inside', from: 0, to: 1 }])
    expect(removeDock(once, 'cleft', 0)).toBeNull()
  })
})

describe('a docked compartment’s reach grip', () => {
  it('sits at the middle of its far edge, and is gone once it is docked twice', () => {
    const { pieces, id } = cleftAgainstSr()
    const { places, rects } = layoutPieces(pieces)
    const rect = rects.get(id)
    expect(places.get(`grip:reach:${id}`)).toMatchObject({
      kind: 'grip',
      grip: 'reach',
      piece: id,
      x: rect.x + rect.width,
      y: rect.y + rect.height / 2,
    })
    // The cardiomyocyte's cleft is docked to the T-tubule and the SR both.
    expect(layoutPieces(cardiomyocyte()).places.has('grip:reach:cleft')).toBe(false)
    // Its extracellular space, docked along the top, outside, has one on its top edge.
    const outside = layoutPieces(cardiomyocyte())
    expect(outside.places.get('grip:reach:extracellular').y).toBe(outside.rects.get('extracellular').y)
  })

  it('sets how far it reaches as far out as the grip is dragged, or in for one docked inside', () => {
    const { pieces, id } = cleftAgainstSr()
    const { rects } = layoutPieces(pieces)
    const sr = rects.get('sr-membrane')
    const out = valid(reachTo(pieces, id, { x: sr.x + sr.width + 90, y: 0 }, rects))
    expect(byId(out, id).depth).toBe(90)
    expect(layoutPieces(out).rects.get(id).x + layoutPieces(out).rects.get(id).width).toBe(sr.x + sr.width + 90)
    // A microdomain, docked inside a cell's top: as far in as the grip is, less the inset it starts at.
    const cell = valid(getBuiltInPieceTemplate('cell').pieces)
    const scene = dropScene(cell)
    const host = scene.rects.get('plasma-membrane')
    const drop = resolveDrop('compartment', { x: host.x + host.width / 2, y: host.y + 10 }, scene)
    const { pieces: within, id: microdomain } = previewDrop(scene, drop)
    expect(byId(within, microdomain).docks[0]).toMatchObject({ side: 'top', face: 'inside' })
    const inRects = layoutPieces(within).rects
    const deeper = valid(reachTo(within, microdomain, { x: 0, y: inRects.get('plasma-membrane').y + 130 }, inRects))
    expect(byId(deeper, microdomain).depth).toBe(120)
  })
})
