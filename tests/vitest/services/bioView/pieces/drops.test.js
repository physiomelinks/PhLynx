import { describe, expect, it } from 'vitest'

import { getBuiltInPieceTemplate } from '../../../../../src/services/bioView/pieces/builtInTemplates.js'
import {
  dropScene,
  previewDrop,
  resolveDrop,
  resolveTubeEnd,
} from '../../../../../src/services/bioView/pieces/drops.js'
import { encloseCompartment, splitSpans } from '../../../../../src/services/bioView/pieces/edits.js'
import { validatePieces } from '../../../../../src/services/bioView/pieces/model.js'
import { topologyOf } from '../../../../../src/services/bioView/pieces/topology.js'

const valid = (raw) => {
  const { pieces, errors } = validatePieces(raw)
  expect(errors).toEqual([])
  return pieces
}

/** The pieces a drop of a kind at a point leaves, failing on anything but a clean drop. */
function dropped(pieces, kind, point) {
  const scene = dropScene(pieces)
  const drop = resolveDrop(kind, point, scene)
  expect(drop.invalid).toBeUndefined()
  const preview = previewDrop(scene, drop)
  expect(preview.errors).toEqual([])
  return { ...preview, drop, scene }
}

const cell = () => valid(getBuiltInPieceTemplate('cell').pieces)
const cellRect = (pieces) => dropScene(pieces).rects.get('plasma-membrane')

describe('dropping a compartment', () => {
  it('stands freely on the view, centred where it is dropped', () => {
    const { pieces, id, drop, ghosts } = dropped(cell(), 'compartment', { x: 1000, y: 600 })
    expect(drop.label).toBe('A compartment')
    expect(pieces.find((piece) => piece.id === id).frame).toEqual({ x: 840, y: 530, width: 320, height: 140 })
    expect(ghosts).toEqual([{ type: 'rect', kind: 'region', rect: { x: 840, y: 530, width: 320, height: 140 } }])
  })

  it('stands in a compartment it is dropped in, from its corner', () => {
    const rect = cellRect(cell())
    const { pieces, id, drop } = dropped(cell(), 'compartment', {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
    })
    expect(drop.label).toBe('A compartment in Cell')
    expect(pieces.find((piece) => piece.id === id).parent).toBe('cell')
  })

  it('docks outside a membrane’s side it is dropped by, its stretch a protein site of its own', () => {
    const rect = cellRect(cell())
    const { pieces, id, drop } = dropped(cell(), 'compartment', { x: rect.x + rect.width / 2, y: rect.y - 10 })
    expect(drop.label).toBe('Against Plasma membrane’s top, outside')
    expect(pieces.find((piece) => piece.id === id).docks).toEqual([
      { on: 'plasma-membrane', side: 'top', face: 'outside', from: 0, to: 1 },
    ])
    // The whole side was one span already, so it stays as it was.
    expect(pieces.find((piece) => piece.id === 'plasma-membrane').sides.top.map((span) => span.id)).toEqual(['top'])
    expect(topologyOf(pieces).outsideOf('plasma-membrane.top')).toEqual([id])
  })

  it('docks inside, in the membrane’s bulk, as a microdomain', () => {
    const rect = cellRect(cell())
    const { pieces, id, drop } = dropped(cell(), 'compartment', { x: rect.x + rect.width / 2, y: rect.y + 10 })
    expect(drop.label).toBe('Inside Plasma membrane, along its top')
    expect(pieces.find((piece) => piece.id === id)).toMatchObject({ parent: 'cell', label: 'Microdomain' })
    expect(topologyOf(pieces).insideOf('plasma-membrane.top')).toBe(id)
  })

  it('takes only the free stretch of a side, splitting its span', () => {
    // The rod's top meets its outer segment along its first half and its inner segment along the rest: outside,
    // the extracellular space has all of it.
    const rod = valid(getBuiltInPieceTemplate('rod-photoreceptor').pieces)
    const rect = dropScene(rod).rects.get('plasma-membrane')
    const drop = resolveDrop('compartment', { x: rect.x + rect.width / 4, y: rect.y - 10 }, dropScene(rod))
    expect(drop.invalid).toMatch(/already against that stretch/)
  })

  it('splits a span round the free stretch it takes', () => {
    const spans = [{ id: 'top', label: 'Top', from: 0, to: 1 }]
    expect(splitSpans(spans, 0.25, 0.5, { id: 'mid', label: 'Middle' }, new Set(['top']))).toEqual([
      { id: 'top', label: 'Top', from: 0, to: 0.25 },
      { id: 'mid', label: 'Middle', from: 0.25, to: 0.5 },
      { id: 'top-2', label: 'Top', from: 0.5, to: 1 },
    ])
    expect(splitSpans(spans, 0, 0.5, { id: 'mid', label: 'Middle' }, new Set(['top']))).toEqual([
      { id: 'mid', label: 'Middle', from: 0, to: 0.5 },
      { id: 'top', label: 'Top', from: 0.5, to: 1 },
    ])
  })
})

describe('dropping a membrane', () => {
  it('goes nowhere but on a compartment', () => {
    expect(resolveDrop('membrane', { x: 200, y: 200 }, dropScene([])).invalid).toMatch(/Drop it on a compartment/)
    const start = valid([{ id: 'a', kind: 'compartment', label: 'A', frame: { x: 0, y: 0, width: 200, height: 160 } }])
    expect(resolveDrop('membrane', { x: 600, y: 600 }, dropScene(start)).invalid).toMatch(/Drop it on a compartment/)
  })

  it('anywhere on a compartment standing freely makes it a cell', () => {
    const start = valid([{ id: 'a', kind: 'compartment', label: 'A', frame: { x: 0, y: 0, width: 320, height: 240 } }])
    const { pieces, id, drop, ghosts } = dropped(start, 'membrane', { x: 160, y: 120 })
    expect(drop.label).toBe('Encloses A')
    expect(topologyOf(pieces).bulkOf(id)).toBe('a')
    expect(ghosts.map((ghost) => ghost.kind)).toEqual(['cell'])
  })

  it('won’t go in a cell’s cytoplasm, which has a membrane already', () => {
    const rect = cellRect(cell())
    const drop = resolveDrop('membrane', { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, dropScene(cell()))
    expect(drop.invalid).toMatch(/Cell has a membrane already/)
  })

  it('on a compartment inside a cell makes it an organelle', () => {
    const inCell = dropped(cell(), 'compartment', { x: 200, y: 160 })
    const inner = inCell.pieces.find((piece) => piece.id === inCell.id)
    const rect = dropScene(inCell.pieces).rects.get(inner.id)
    const { pieces, id, drop } = dropped(inCell.pieces, 'membrane', {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
    })
    expect(drop.label).toBe(`Encloses ${inner.label}`)
    expect(pieces.find((piece) => piece.id === id).parent).toBe('cell')
    expect(topologyOf(pieces).bulkOf(id)).toBe(inner.id)
  })

  it('won’t enclose a compartment docked against a membrane', () => {
    const rect = cellRect(cell())
    const docked = dropped(cell(), 'compartment', { x: rect.x + rect.width / 2, y: rect.y - 10 })
    const dockedRect = dropScene(docked.pieces).rects.get(docked.id)
    const drop = resolveDrop(
      'membrane',
      { x: dockedRect.x + dockedRect.width / 2, y: dockedRect.y + dockedRect.height / 2 },
      dropScene(docked.pieces),
    )
    expect(drop.invalid).toMatch(/against a membrane/)
  })

  it('on a compartment’s edge encloses it, and every compartment tubes join to it', () => {
    const start = valid([
      { id: 'a', kind: 'compartment', label: 'A', frame: { x: 0, y: 0, width: 200, height: 160 } },
      { id: 'b', kind: 'compartment', label: 'B', frame: { x: 300, y: 0, width: 200, height: 160 } },
      { id: 't', kind: 'tube', label: 'T', ends: ['a', 'b'] },
    ])
    const { pieces, id, drop } = dropped(start, 'membrane', { x: 2, y: 80 })
    expect(drop.label).toBe('Encloses A and B')
    const topology = topologyOf(pieces)
    expect(pieces.find((piece) => piece.id === id)).toMatchObject({
      encloses: ['a', 'b'],
      frame: { x: 0, y: 0, width: 500, height: 160 },
    })
    // Each docked along the stretches it meets, the gap between them on top and bottom shared at its middle, so every
    // stretch meets one of them.
    const inside = (side) =>
      topology
        .spansOf(id)
        .filter((span) => span.side === side)
        .map((span) => [topology.insideOf(span.path), span.from, span.to])
    expect(inside('left')).toEqual([['a', 0, 1]])
    expect(inside('right')).toEqual([['b', 0, 1]])
    expect(inside('top')).toEqual([
      ['a', 0, 0.5],
      ['b', 0.5, 1],
    ])
  })

  it('turns a flow tube between those it encloses into an open channel, renamed unless someone named it', () => {
    const start = valid([
      { id: 'a', kind: 'compartment', label: 'A', frame: { x: 0, y: 0, width: 200, height: 160 } },
      { id: 'b', kind: 'compartment', label: 'B', frame: { x: 300, y: 0, width: 200, height: 160 } },
      { id: 't', kind: 'tube', label: 'Tube', ends: ['a', 'b'], flux: 'flow', bends: [{ x: 250, y: 120 }] },
    ])
    const { pieces } = dropped(start, 'membrane', { x: 2, y: 80 })
    expect(pieces.find((piece) => piece.id === 't')).toMatchObject({
      flux: 'bridge',
      label: 'Bridge',
      bends: [{ x: 250, y: 120 }],
    })
  })

  it('round one compartment makes it the membrane’s bulk', () => {
    const start = valid([{ id: 'a', kind: 'compartment', label: 'A', frame: { x: 0, y: 0, width: 320, height: 240 } }])
    const { pieces, id } = dropped(start, 'membrane', { x: 2, y: 100 })
    expect(topologyOf(pieces).bulkOf(id)).toBe('a')
    expect(pieces.find((piece) => piece.id === 'a').frame).toBeUndefined()
  })

  it('won’t enclose compartments laid out so two meet none of the box’s sides', () => {
    const start = valid([
      { id: 'a', kind: 'compartment', label: 'A', frame: { x: 0, y: 0, width: 600, height: 600 } },
      { id: 'b', kind: 'compartment', label: 'B', frame: { x: 200, y: 200, width: 50, height: 50 } },
      { id: 'c', kind: 'compartment', label: 'C', frame: { x: 300, y: 300, width: 50, height: 50 } },
      { id: 'ab', kind: 'tube', label: 'AB', ends: ['a', 'b'] },
      { id: 'ac', kind: 'tube', label: 'AC', ends: ['a', 'c'] },
    ])
    expect(encloseCompartment(start, 'a', dropScene(start).rects).error).toMatch(/Only one of them may meet none/)
  })
})

describe('dropping a tube, fold or zone', () => {
  it('joins the compartment it is dropped on to the nearest other', () => {
    const start = valid([
      { id: 'a', kind: 'compartment', label: 'A', frame: { x: 0, y: 0, width: 200, height: 100 } },
      { id: 'b', kind: 'compartment', label: 'B', frame: { x: 400, y: 0, width: 200, height: 100 } },
    ])
    const { pieces, drop, ghosts } = dropped(start, 'tube', { x: 50, y: 50 })
    expect(drop.label).toBe('Joins A to B')
    expect(pieces.find((piece) => piece.kind === 'tube')).toMatchObject({ ends: ['a', 'b'], flux: 'flow' })
    // Previewed as the vessel it is drawn as, along its way, with no card's room beside it.
    expect(ghosts.filter((ghost) => ghost.type === 'conduit')).toHaveLength(1)
    expect(ghosts.some((ghost) => ghost.type === 'rect' && ghost.kind === 'link')).toBe(false)
  })

  // The two cells alone, without the fluids round them, which are nearer; moved together, B against A's right side.
  const twoCells = (touching) =>
    valid(
      getBuiltInPieceTemplate('two-cell-epithelium')
        .pieces.filter((piece) => !piece.docks)
        .map((piece) =>
          touching && piece.id === 'b-membrane' ? { ...piece, frame: { ...piece.frame, x: 320 } } : piece,
        ),
    )
  const tubeDropIn = (pieces) => {
    const scene = dropScene(pieces)
    const a = scene.rects.get('a')
    const drop = resolveDrop('tube', { x: a.x + a.width / 2, y: a.y + a.height / 2 }, scene)
    return { drop, tubeOf: (choice) => previewDrop(scene, drop, choice).pieces.find((piece) => piece.kind === 'tube') }
  }

  it('between two touching cells, names them, as a gap junction unless the user makes it a bridge', () => {
    const { drop, tubeOf } = tubeDropIn(twoCells(true))
    expect(drop.cells).toEqual(['Epithelial cell A', 'Epithelial cell B'])
    expect(drop.label).toBe('Joins Epithelial cell A to Epithelial cell B')
    expect(tubeOf()).toMatchObject({ ends: ['a', 'b'], flux: 'junction', label: 'Gap junction' })
    expect(tubeOf({ flux: 'bridge' })).toMatchObject({ ends: ['a', 'b'], flux: 'bridge', label: 'Bridge' })
  })

  it('between two touching cells, is previewed as the joint it is drawn as, in its room', () => {
    const pieces = twoCells(true)
    const scene = dropScene(pieces)
    const { drop } = tubeDropIn(pieces)
    const ghost = previewDrop(scene, drop).ghosts.find((each) => each.type === 'joint')
    expect(ghost).toMatchObject({ joint: 'junction', rect: expect.objectContaining({ width: expect.any(Number) }) })
  })

  it('between two cells apart, is a bridge, asking nothing, a gap junction needing them to touch', () => {
    const { drop, tubeOf } = tubeDropIn(twoCells(false))
    expect(drop.cells).toBeUndefined()
    expect(drop.label).toBe('Bridges Epithelial cell A to Epithelial cell B')
    expect(tubeOf()).toMatchObject({ ends: ['a', 'b'], flux: 'bridge', label: 'Bridge' })
  })

  it('between two spaces of one cell, is an open channel, asking nothing', () => {
    const rod = valid(
      getBuiltInPieceTemplate('rod-photoreceptor').pieces.filter(
        (piece) => piece.kind !== 'tube' && piece.id !== 'extracellular',
      ),
    )
    const scene = dropScene(rod)
    const outer = scene.rects.get('outer-segment')
    const drop = resolveDrop('tube', { x: outer.x + outer.width / 2, y: outer.y + outer.height / 2 }, scene)
    expect(drop.cells).toBeUndefined()
    const tube = previewDrop(scene, drop).pieces.find((piece) => piece.kind === 'tube')
    expect(tube).toMatchObject({ ends: ['outer-segment', 'inner-segment'], flux: 'bridge', label: 'Bridge' })
  })

  // Two cells standing in a tissue compartment, B `gap` to the right of A, with a lone organelle in A when asked.
  const cellsInTissue = (gap, { organelle = false } = {}) =>
    valid([
      { id: 'tissue', kind: 'compartment', label: 'Tissue', frame: { x: 0, y: 0, width: 1200, height: 600 } },
      { id: 'a', kind: 'compartment', label: 'Cell A', parent: 'tissue' },
      {
        id: 'a-membrane',
        kind: 'membrane',
        label: 'Membrane A',
        parent: 'tissue',
        encloses: ['a'],
        frame: { x: 40, y: 40, width: 320, height: 260 },
      },
      { id: 'b', kind: 'compartment', label: 'Cell B', parent: 'tissue' },
      {
        id: 'b-membrane',
        kind: 'membrane',
        label: 'Membrane B',
        parent: 'tissue',
        encloses: ['b'],
        frame: { x: 360 + gap, y: 40, width: 320, height: 260 },
      },
      ...(organelle
        ? [
            {
              id: 'o',
              kind: 'compartment',
              label: 'Organelle',
              parent: 'a',
              frame: { x: 40, y: 60, width: 120, height: 80 },
            },
          ]
        : []),
    ])
  const tubeAt = (pieces, at) => {
    const scene = dropScene(pieces)
    const drop = resolveDrop('tube', at(scene.rects), scene)
    expect(drop.invalid).toBeUndefined()
    return drop
  }
  const middle = (rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })

  it('dropped on a cell in a compartment, joins it to the cell beside it, not the compartment it stands in', () => {
    const drop = tubeAt(cellsInTissue(120), (rects) => middle(rects.get('a')))
    expect(drop.key).toBe('tube|a|b')
    expect(drop.label).toBe('Bridges Cell A to Cell B')
  })

  it('dropped between two cells in a compartment, joins the two, not the compartment', () => {
    const drop = tubeAt(cellsInTissue(120), (rects) => {
      const a = rects.get('a')
      return { x: a.x + a.width + 40, y: a.y + a.height / 2 }
    })
    expect(drop.key).toBe('tube|a|b')
    const touching = tubeAt(cellsInTissue(0), (rects) => middle(rects.get('b')))
    expect(touching.key).toBe('tube|b|a')
    expect(touching.cells).toEqual(['Cell B', 'Cell A'])
  })

  it('still joins a compartment to the one it stands in, where nothing else is in reach', () => {
    const drop = tubeAt(cellsInTissue(1000, { organelle: true }), (rects) => middle(rects.get('o')))
    expect(drop.key).toBe('tube|o|a')
  })

  it('moving a tube’s end onto another cell carries what a tube dropped between them would', () => {
    const withTube = (gap) =>
      valid([...cellsInTissue(gap), { id: 't', kind: 'tube', label: 'Tube', ends: ['a', 'tissue'], flux: 'flow' }])
    const moved = (pieces, choice) => {
      const scene = dropScene(pieces)
      const end = resolveTubeEnd(scene, 't', 1, middle(scene.rects.get('b')))
      return { end, tube: valid(end.apply(pieces, choice)).find((piece) => piece.id === 't') }
    }
    const touching = moved(withTube(0), { flux: 'junction' })
    expect(touching.end.cells).toEqual(['Cell A', 'Cell B'])
    expect(touching.end.label).toBe('Joins its downstream end to Cell B')
    expect(touching.tube).toMatchObject({ ends: ['a', 'b'], flux: 'junction', label: 'Gap junction' })
    const apart = moved(withTube(120))
    expect(apart.end.cells).toBeUndefined()
    expect(apart.tube).toMatchObject({ ends: ['a', 'b'], flux: 'bridge', label: 'Bridge' })
    const scene = dropScene(withTube(0))
    // Onto its other end, it says why not; onto the one it joins already, it does nothing.
    expect(resolveTubeEnd(scene, 't', 1, middle(scene.rects.get('a'))).invalid).toMatch(/can’t join Cell A to itself/)
    expect(resolveTubeEnd(scene, 't', 0, middle(scene.rects.get('a')))).toBeNull()
  })

  it('needs two compartments for a tube', () => {
    expect(resolveDrop('tube', { x: 0, y: 0 }, dropScene([])).invalid).toMatch(/two compartments/)
  })

  it('says when nothing else is near enough to join', () => {
    const start = valid([
      { id: 'a', kind: 'compartment', label: 'A', frame: { x: 0, y: 0, width: 200, height: 100 } },
      { id: 'b', kind: 'compartment', label: 'B', frame: { x: 2000, y: 0, width: 200, height: 100 } },
    ])
    expect(resolveDrop('tube', { x: 50, y: 50 }, dropScene(start)).invalid).toBe(
      'Nothing else is near enough to A to join it to.'
    )
  })

  it('folds a membrane in from the side it is dropped on, where along it', () => {
    const rect = cellRect(cell())
    const { pieces, id, ghosts } = dropped(cell(), 'fold', { x: rect.x + rect.width / 2, y: rect.y + 20 })
    expect(pieces.find((piece) => piece.id === id)).toMatchObject({ membrane: 'plasma-membrane', side: 'top', at: 0.5 })
    // The cell grows deep enough to hold it, from the size it was, under the fold's own ghost.
    expect(ghosts).toEqual([
      expect.objectContaining({ type: 'grows', kind: 'cell', was: rect }),
      expect.objectContaining({ kind: 'fold' }),
    ])
    expect(resolveDrop('fold', { x: -500, y: -500 }, dropScene(cell())).invalid).toMatch(/side of a membrane/)
  })

  it('puts a process zone in the compartment it is dropped in', () => {
    const rect = cellRect(cell())
    const { pieces, id, drop } = dropped(cell(), 'zone', { x: rect.x + 100, y: rect.y + 100 })
    expect(drop.label).toBe('A process zone in Cell')
    expect(pieces.find((piece) => piece.id === id)).toMatchObject({
      kind: 'zone',
      compartment: 'cell',
      label: 'Process zone',
    })
    expect(resolveDrop('zone', { x: -500, y: -500 }, dropScene(cell())).invalid).toMatch(/in a compartment/)
  })

  it('keys a drop by its target, so a preview is worked out again only when that changes', () => {
    const scene = dropScene(cell())
    const rect = scene.rects.get('plasma-membrane')
    const a = resolveDrop('zone', { x: rect.x + 100, y: rect.y + 100 }, scene)
    const b = resolveDrop('zone', { x: rect.x + 140, y: rect.y + 120 }, scene)
    expect(a.key).toBe(b.key)
  })
})

describe('previewing a membrane round a compartment', () => {
  const free = (frame) => valid([{ id: 'c', kind: 'compartment', label: 'C', frame }])
  const ghostOf = (frame) => {
    const { ghosts } = dropped(free(frame), 'membrane', { x: frame.x + 20, y: frame.y + 20 })
    return ghosts.find((ghost) => ghost.kind === 'cell')
  }

  it('says what the compartment took, and that the cell is no bigger where it fits one', () => {
    const frame = { x: 100, y: 100, width: 320, height: 160 }
    expect(ghostOf(frame)).toEqual({ type: 'rect', kind: 'cell', rect: frame, was: frame, grows: false })
  })

  it('says the cell grows where the compartment is too small for one', () => {
    const frame = { x: 100, y: 100, width: 320, height: 100 }
    const ghost = ghostOf(frame)
    expect(ghost.was).toEqual(frame)
    expect(ghost.rect.height).toBeGreaterThan(frame.height)
    expect(ghost.grows).toBe(true)
  })
})

describe('previewing what a drop grows', () => {
  const free = (height) =>
    valid([{ id: 'c', kind: 'compartment', label: 'C', frame: { x: 100, y: 100, width: 320, height } }])
  const grownBy = (pieces, kind, point, options) => {
    const scene = dropScene(pieces, options)
    const preview = previewDrop(scene, resolveDrop(kind, point, scene))
    expect(preview.errors).toEqual([])
    return preview.ghosts.filter((ghost) => ghost.type === 'grows')
  }

  it('shows a compartment grown to fit a zone dropped in it, from the size it was, before what is added', () => {
    const scene = dropScene(free(140))
    const preview = previewDrop(scene, resolveDrop('zone', { x: 260, y: 170 }, scene))
    const [grown] = preview.ghosts
    expect(grown).toMatchObject({ type: 'grows', kind: 'region', label: 'C', was: scene.rects.get('c') })
    expect(grown.rect.height).toBeGreaterThan(140)
    expect(preview.ghosts.at(-1).kind).toBe('zone')
  })

  it('shows nothing grown where what is dropped fits', () => {
    expect(grownBy(free(400), 'zone', { x: 260, y: 170 })).toEqual([])
  })

  it('lays out the scene and the preview with the modules on the pieces, as the view does', () => {
    const cell = valid([
      { id: 'c', kind: 'compartment', label: 'C' },
      { id: 'pm', kind: 'membrane', label: 'PM', encloses: ['c'], frame: { x: 100, y: 100, width: 320, height: 144 } },
    ])
    const nodes = [{ id: 'p', data: { name: 'p', bioView: { site: 'pieces/pm.top' } } }]
    const [bare] = grownBy(cell, 'zone', { x: 260, y: 170 })
    const [withProtein] = grownBy(cell, 'zone', { x: 260, y: 170 }, { nodes })
    // A protein on its top side keeps the zone further down, past it and its name, so the cell grows more.
    expect(withProtein.rect.height).toBeGreaterThan(bare.rect.height)
  })
})

describe('previewing what a drop pushes', () => {
  it('shows a compartment pushed out of the way of one that grows', () => {
    const pieces = valid([
      { id: 'c', kind: 'compartment', label: 'C', frame: { x: 100, y: 100, width: 320, height: 140 } },
      { id: 'd', kind: 'compartment', label: 'D', frame: { x: 100, y: 260, width: 320, height: 140 } },
    ])
    const scene = dropScene(pieces)
    const { ghosts } = previewDrop(scene, resolveDrop('zone', { x: 260, y: 170 }, scene))
    const moved = ghosts.find((ghost) => ghost.type === 'moves')
    expect(moved).toMatchObject({ kind: 'region', label: 'D', was: scene.rects.get('d') })
    expect(moved.rect.y).toBeGreaterThan(260)
  })
})
