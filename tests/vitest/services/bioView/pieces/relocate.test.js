import { describe, expect, it } from 'vitest'

import { getBuiltInPieceTemplate } from '../../../../../src/services/bioView/pieces/builtInTemplates.js'
import { dropScene, previewDrop, resolveCarry } from '../../../../../src/services/bioView/pieces/drops.js'
import { layoutPieces } from '../../../../../src/services/bioView/pieces/layout.js'
import { EMPTY_SPAN } from '../../../../../src/services/bioView/geometry.js'
import { validatePieces } from '../../../../../src/services/bioView/pieces/model.js'
import {
  detachPiece,
  dockPiece,
  liftedWith,
  moveOut,
  outOf,
  standPiece,
  standingIn,
} from '../../../../../src/services/bioView/pieces/relocate.js'
import { topologyOf } from '../../../../../src/services/bioView/pieces/topology.js'

const valid = (raw) => {
  const { pieces, errors } = validatePieces(raw)
  expect(errors).toEqual([])
  return pieces
}
const rectsOf = (pieces) => layoutPieces(pieces).rects
const byId = (pieces, id) => pieces.find((piece) => piece.id === id)
const template = (id) => valid(getBuiltInPieceTemplate(id).pieces)

const cardiomyocyte = template('cardiomyocyte')
const rod = template('rod-photoreceptor')

/** Two cells joined by a gap junction, a fluid standing free with a pool in it, and a third cell on its own. */
const tissue = valid([
  { id: 'a', kind: 'compartment', label: 'A' },
  {
    id: 'a-membrane',
    kind: 'membrane',
    label: 'A membrane',
    encloses: ['a'],
    frame: { x: 0, y: 0, width: 240, height: 200 },
  },
  { id: 'b', kind: 'compartment', label: 'B' },
  {
    id: 'b-membrane',
    kind: 'membrane',
    label: 'B membrane',
    encloses: ['b'],
    frame: { x: 240, y: 0, width: 240, height: 200 },
  },
  { id: 'junction', kind: 'tube', label: 'Gap junction', ends: ['a', 'b'], flux: 'junction' },
  { id: 'fluid', kind: 'compartment', label: 'Fluid', frame: { x: 0, y: 400, width: 900, height: 500 } },
  { id: 'pool', kind: 'compartment', label: 'Pool', parent: 'fluid', frame: { x: 40, y: 60, width: 200, height: 120 } },
  { id: 'well', kind: 'zone', label: 'Well', compartment: 'pool' },
  { id: 'drain', kind: 'tube', label: 'Tube', ends: ['pool', 'fluid'], bends: [{ x: 10, y: 10 }] },
  { id: 'c', kind: 'compartment', label: 'C' },
  {
    id: 'c-membrane',
    kind: 'membrane',
    label: 'C membrane',
    encloses: ['c'],
    frame: { x: 1000, y: 0, width: 700, height: 240 },
  },
])

describe('liftedWith', () => {
  it('lifts a cell whole for its inside, with what stands in it and is docked to it alone', () => {
    const lifted = liftedWith(cardiomyocyte, 'myocyte')
    expect(lifted).toMatchObject({ root: 'sarcolemma', kind: 'cell', label: 'Cardiomyocyte', tops: ['sarcolemma'] })
    expect([...lifted.ids].sort()).toEqual([...cardiomyocyte.map((piece) => piece.id)].sort())
  })

  it('leaves a compartment docked to something left behind where it is', () => {
    // The dyadic cleft lies between the SR and the T-tubule: the SR lifted, it stays against the T-tubule.
    expect([...liftedWith(cardiomyocyte, 'sr-membrane').ids].sort()).toEqual(['sr', 'sr-membrane'])
  })

  it('lifts cells joined by gap junctions as one', () => {
    const lifted = liftedWith(tissue, 'b')
    expect(lifted.tops).toEqual(['b-membrane', 'a-membrane'])
    expect([...lifted.ids].sort()).toEqual(['a', 'a-membrane', 'b', 'b-membrane'])
  })

  it('refuses a compartment of a cell split between compartments, and what is no compartment, cell or zone', () => {
    expect(liftedWith(rod, 'outer-segment').error).toBe(
      'Outer segment is part of the inside of Plasma membrane, which has no other: it stays where it is.',
    )
    expect(liftedWith(cardiomyocyte, 't-tubule').error).toMatch(/^Only a compartment, a cell or a process zone/)
  })
})

describe('standPiece', () => {
  it('moves an organelle out of its cell onto the view, leaving the cleft against the T-tubule', () => {
    const rects = rectsOf(cardiomyocyte)
    const was = rects.get('sr-membrane')
    const cell = rects.get('sarcolemma')
    const shift = { x: cell.x + cell.width + 100 - was.x, y: 0 }
    const moved = valid(standPiece(cardiomyocyte, 'sr-membrane', { shift }, rects).pieces)
    expect(byId(moved, 'sr-membrane').parent).toBeUndefined()
    expect(byId(moved, 'sr').parent).toBeUndefined()
    expect(byId(moved, 'cleft').docks.map((dock) => dock.on)).toEqual(['t-tubule'])
    expect(rectsOf(moved).get('sr-membrane')).toMatchObject({ x: was.x + shift.x, y: was.y })
    expect(topologyOf(moved).depthOf('sr')).toBe(1)
  })

  it('moves a cell into a compartment, from that compartment’s corner, with the cells joined to it', () => {
    const rects = rectsOf(tissue)
    const fluid = rects.get('fluid')
    const shift = { x: 300, y: fluid.y + 200 - rects.get('a-membrane').y }
    const moved = valid(standPiece(tissue, 'a-membrane', { parent: 'fluid', shift }, rects).pieces)
    for (const id of ['a', 'a-membrane', 'b', 'b-membrane']) expect(byId(moved, id).parent, id).toBe('fluid')
    expect(byId(moved, 'a-membrane').frame).toMatchObject({ x: 300 - fluid.x, y: 200 })
    expect(byId(moved, 'b-membrane').frame).toMatchObject({ x: 540 - fluid.x, y: 200 })
    // Still a gap junction: the two went together.
    expect(byId(moved, 'junction').flux).toBe('junction')
  })

  it('keeps what goes into a compartment in from its top and left', () => {
    const rects = rectsOf(tissue)
    const fluid = rects.get('fluid')
    const c = rects.get('c-membrane')
    const shift = { x: fluid.x - 500 - c.x, y: fluid.y - 500 - c.y }
    const moved = valid(standPiece(tissue, 'c', { parent: 'fluid', shift }, rects).pieces)
    expect(byId(moved, 'c-membrane').frame).toMatchObject({ x: 30, y: 30, width: 700, height: 240 })
  })

  it('moves a compartment out with what is in it, and drops the bends of the tubes to it', () => {
    const rects = rectsOf(tissue)
    const moved = valid(standPiece(tissue, 'pool', { shift: { x: 1500, y: 0 } }, rects).pieces)
    expect(byId(moved, 'pool').parent).toBeUndefined()
    expect(byId(moved, 'well').compartment).toBe('pool')
    expect(byId(moved, 'drain')).toMatchObject({ ends: ['pool', 'fluid'], flux: 'flow' })
    expect(byId(moved, 'drain').bends).toBeUndefined()
  })

  it('moves a process zone to another compartment, and nowhere else', () => {
    const rects = rectsOf(cardiomyocyte)
    const moved = valid(standPiece(cardiomyocyte, 'mitochondria', { parent: 'sr' }, rects).pieces)
    expect(byId(moved, 'mitochondria').compartment).toBe('sr')
    expect(standPiece(cardiomyocyte, 'mitochondria', {}, rects).error).toBe('A process zone goes in a compartment.')
  })

  it('refuses to put a piece inside itself', () => {
    const rects = rectsOf(cardiomyocyte)
    expect(standPiece(cardiomyocyte, 'sarcolemma', { parent: 'sr' }, rects).error).toBe(
      'Cardiomyocyte can’t go inside itself.',
    )
  })
})

describe('detachPiece', () => {
  it('leaves a docked compartment standing where it was drawn, its stretch of membrane still a site', () => {
    const rects = rectsOf(cardiomyocyte)
    const was = rects.get('extracellular')
    const spans = byId(cardiomyocyte, 'sarcolemma').sides.top.map((span) => span.id)
    const detached = valid(detachPiece(cardiomyocyte, 'extracellular', rects).pieces)
    const piece = byId(detached, 'extracellular')
    expect(piece.docks).toBeUndefined()
    expect(piece.depth).toBeUndefined()
    expect(piece.frame).toEqual({
      x: Math.round(was.x),
      y: Math.round(was.y),
      width: Math.round(was.width),
      height: Math.round(was.height),
    })
    expect(byId(detached, 'sarcolemma').sides.top.map((span) => span.id)).toEqual(spans)
  })

  it('takes a compartment between two off both, to stand in the cell', () => {
    const detached = valid(detachPiece(cardiomyocyte, 'cleft', rectsOf(cardiomyocyte)).pieces)
    expect(byId(detached, 'cleft')).toMatchObject({ parent: 'myocyte' })
    expect(byId(detached, 'cleft').docks).toBeUndefined()
  })

  it('refuses a compartment of a split cell, and one against nothing', () => {
    expect(detachPiece(rod, 'inner-segment', rectsOf(rod)).error).toMatch(/^Inner segment is part of the inside/)
    expect(detachPiece(tissue, 'pool', rectsOf(tissue)).error).toBe('It is against no membrane.')
  })
})

describe('dockPiece', () => {
  it('docks a free compartment outside a membrane, standing where the membrane does, with what is in it', () => {
    const rects = rectsOf(tissue)
    const dock = { on: 'c-membrane', side: 'bottom', face: 'outside', from: 0.2, to: 0.8 }
    const docked = valid(dockPiece(tissue, 'pool', dock, rects).pieces)
    const pool = byId(docked, 'pool')
    expect(pool.parent).toBeUndefined()
    expect(pool.frame).toBeUndefined()
    expect(pool.docks).toEqual([dock])
    expect(pool.depth).toBe(Math.round(rects.get('pool').height))
    expect(byId(docked, 'well').compartment).toBe('pool')
    // Its stretch is a protein site between it and the cell.
    const topology = topologyOf(docked)
    const span = topology.spansOf('c-membrane').find((each) => each.from === 0.2 && each.to === 0.8)
    expect(topology.outsideOf(span.path)).toEqual(['pool'])
    expect(topology.insideOf(span.path)).toBe('c')
  })

  it('docks one inside a cell, standing in its inside', () => {
    const dock = { on: 'c-membrane', side: 'left', face: 'inside' }
    const docked = valid(dockPiece(tissue, 'pool', dock, rectsOf(tissue)).pieces)
    expect(byId(docked, 'pool')).toMatchObject({ parent: 'c', docks: [{ ...dock, from: 0, to: 1 }] })
  })

  it('moves a docked compartment from one membrane to another', () => {
    const rects = rectsOf(cardiomyocyte)
    const dock = { on: 'sr-membrane', side: 'left', face: 'outside' }
    const docked = valid(dockPiece(cardiomyocyte, 'extracellular', dock, rects).pieces)
    expect(byId(docked, 'extracellular')).toMatchObject({ parent: 'myocyte', docks: [{ ...dock, from: 0, to: 1 }] })
  })

  it('refuses a cell, and a membrane inside what is docked', () => {
    expect(dockPiece(tissue, 'c', { on: 'a-membrane', side: 'top', face: 'outside' }, rectsOf(tissue)).error).toMatch(
      /^Only a compartment can be docked/,
    )
    const inPool = valid([
      ...JSON.parse(JSON.stringify(tissue)).filter((piece) => !['c', 'c-membrane'].includes(piece.id)),
      { id: 'c', kind: 'compartment', label: 'C', parent: 'pool' },
      { id: 'c-membrane', kind: 'membrane', label: 'C membrane', parent: 'pool', encloses: ['c'] },
    ])
    expect(dockPiece(inPool, 'pool', { on: 'c-membrane', side: 'top', face: 'outside' }, rectsOf(inPool)).error).toBe(
      'Pool can’t be docked to what is inside it.',
    )
  })
})

describe('moveOut', () => {
  it('stands an organelle beside the cell it was in', () => {
    expect(outOf(cardiomyocyte, 'sr')).toEqual({
      id: 'myocyte',
      label: 'Cardiomyocyte',
      drawn: 'sarcolemma',
      parent: null,
    })
    expect(standingIn(cardiomyocyte, 'cleft')).toBe('myocyte')
    const rects = rectsOf(cardiomyocyte)
    const cell = rects.get('sarcolemma')
    const moved = valid(moveOut(cardiomyocyte, 'sr', rects).pieces)
    expect(byId(moved, 'sr-membrane').parent).toBeUndefined()
    expect(rectsOf(moved).get('sr-membrane')).toMatchObject({ x: cell.x + cell.width + 40, y: cell.y })
  })

  it('offers nothing for a piece on the view, or a process zone', () => {
    expect(outOf(cardiomyocyte, 'sarcolemma')).toBeNull()
    expect(outOf(cardiomyocyte, 'mitochondria')).toBeNull()
    expect(moveOut(tissue, 'c', rectsOf(tissue)).error).toBe('It stands in no compartment to move out of.')
  })
})

describe('resolveCarry', () => {
  it('docks a narrow compartment along no less than an empty span, so the cell keeps its size', () => {
    const narrow = valid(
      tissue.map((piece) => (piece.id === 'pool' ? { ...piece, frame: { ...piece.frame, width: 30 } } : piece)),
    )
    const scene = dropScene(narrow)
    const c = scene.rects.get('c-membrane')
    const point = { x: c.x + c.width * 0.3, y: c.y + c.height + 10 }
    const { pieces } = previewDrop(scene, resolveCarry(scene, 'pool', point, { x: 0, y: 0 }))
    const [dock] = byId(pieces, 'pool').docks
    expect((dock.to - dock.from) * c.width).toBeGreaterThanOrEqual(EMPTY_SPAN - 1)
    expect(layoutPieces(pieces).rects.get('c-membrane').width).toBe(c.width)
  })

  it('docks a carried compartment to the membrane side it is by, along as much as it is long', () => {
    const scene = dropScene(tissue)
    const c = scene.rects.get('c-membrane')
    const pool = scene.rects.get('pool')
    const point = { x: c.x + c.width / 2, y: c.y + c.height + 10 }
    const drop = resolveCarry(scene, 'pool', point, { x: 0, y: 0 })
    expect(drop.label).toBe('Docks Pool against C membrane’s bottom, outside')
    const { pieces, ghosts, errors } = previewDrop(scene, drop)
    expect(errors).toEqual([])
    const [dock] = byId(pieces, 'pool').docks
    expect(dock).toMatchObject({ on: 'c-membrane', side: 'bottom', face: 'outside' })
    expect((dock.to - dock.from) * c.width).toBeCloseTo(pool.width, 0)
    // Drawn where it would go, and only it: what is in it follows.
    expect(ghosts.filter((ghost) => ghost.type === 'rect')).toEqual([
      { type: 'rect', kind: 'region', rect: layoutPieces(pieces).rects.get('pool') },
    ])
  })

  it('stands a carried cell in the compartment under the pointer, or out on the view', () => {
    const scene = dropScene(tissue)
    const fluid = scene.rects.get('fluid')
    const into = resolveCarry(scene, 'c-membrane', { x: fluid.x + 600, y: fluid.y + 300 }, { x: -400, y: 500 })
    expect(into.label).toBe('Moves C into Fluid')
    expect(into.highlights).toEqual([{ type: 'rect', rect: fluid }])
    expect(byId(previewDrop(scene, into).pieces, 'c-membrane').parent).toBe('fluid')

    const out = resolveCarry(scene, 'pool', { x: 2000, y: 100 }, { x: 1800, y: -400 })
    expect(out.label).toBe('Moves Pool out, onto the view')
    expect(byId(previewDrop(scene, out).pieces, 'pool').parent).toBeUndefined()
  })

  it('says a docked compartment let go of where it stands is detached, and never targets what is carried', () => {
    const scene = dropScene(cardiomyocyte)
    const fluid = scene.rects.get('extracellular')
    const away = resolveCarry(scene, 'extracellular', { x: fluid.x + 20, y: fluid.y - 300 }, { x: 0, y: -300 })
    expect(away.label).toBe('Detaches Extracellular space, to stand on its own')
    // Over the cell's own inside, the cell is not somewhere it can go.
    const cell = scene.rects.get('sarcolemma')
    const over = resolveCarry(scene, 'sarcolemma', { x: cell.x + cell.width / 2, y: cell.y + 60 }, { x: 5, y: 5 })
    expect(over.label).toBe('Moves Cardiomyocyte')
  })

  it('says why a compartment of a split cell stays, and that a zone needs a compartment', () => {
    const scene = dropScene(rod)
    expect(resolveCarry(scene, 'outer-segment', { x: -500, y: -500 }, { x: 0, y: 0 }).invalid).toMatch(
      /^Outer segment is part of the inside/,
    )
    const heart = dropScene(cardiomyocyte)
    expect(resolveCarry(heart, 'mitochondria', { x: -900, y: -900 }, { x: 0, y: 0 }).invalid).toBe(
      'Drop it in a compartment.',
    )
  })
})
