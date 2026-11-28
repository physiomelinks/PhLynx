import { describe, expect, it } from 'vitest'

import { getBuiltInPieceTemplate } from '../../../../../src/services/bioView/pieces/builtInTemplates.js'
import { layoutPieces } from '../../../../../src/services/bioView/pieces/layout.js'
import { validatePieces } from '../../../../../src/services/bioView/pieces/model.js'
import {
  compartmentsFor,
  isPieceModule,
  modulesOf,
  modulesOwed,
  owedSites,
  pieceNameOf,
  piecesByModuleName,
  piecesOrphanedBy,
  piecesOwed,
} from '../../../../../src/services/bioView/pieces/pairing.js'

const node = (id, site) => ({ id, data: { name: id, bioView: { site } } })

const cardiomyocyte = getBuiltInPieceTemplate('cardiomyocyte').pieces

/** A free compartment, a cell (membrane round a compartment) and a tube between the two. */
function scene() {
  const { pieces, errors } = validatePieces([
    { id: 'bath', kind: 'compartment', label: 'Bath', frame: { x: 0, y: 0, width: 200, height: 120 } },
    { id: 'cell', kind: 'compartment', label: 'Cell', frame: { x: 400, y: 0, width: 200, height: 120 } },
    {
      id: 'pm',
      kind: 'membrane',
      label: 'Plasma membrane',
      encloses: ['cell'],
      sides: { top: [{ id: 'apical', label: 'Apical' }] },
    },
    { id: 'link', kind: 'tube', label: 'Link', ends: ['bath', 'cell'] },
  ])
  expect(errors).toEqual([])
  return pieces
}

describe('isPieceModule', () => {
  it('holds for one-module sites only', () => {
    expect(isPieceModule({ kind: 'single' })).toBe(true)
    expect(isPieceModule({ kind: 'slots' })).toBe(false)
    expect(isPieceModule(null)).toBe(false)
  })
})

describe('modulesOwed', () => {
  it('lists every compartment, membrane and tube with no module, and never a span', () => {
    expect(modulesOwed(scene(), [])).toEqual(['bath', 'cell', 'pm', 'link'])
  })

  it('leaves out those with a module on them, whatever is on the spans', () => {
    const nodes = [node('saline', 'pieces/bath'), node('pump', 'pieces/pm.apical'), node('wall', 'pieces/pm')]
    expect(modulesOwed(scene(), nodes)).toEqual(['cell', 'link'])
  })

  it('gives each site’s role and label, to name what goes there', () => {
    expect(owedSites(scene(), [node('saline', 'pieces/bath')])).toEqual([
      { path: 'cell', role: 'cytosol', label: 'Cell', piece: 'cell' },
      { path: 'pm', role: 'membrane', label: 'Plasma membrane', piece: 'pm' },
      { path: 'link', role: 'cytosolic', label: 'Link', piece: 'link' },
    ])
  })

  it('owes nothing with no pieces, and keeps to the one-module sites of a built-in template', () => {
    expect(modulesOwed([], [node('a', 'pieces/x')])).toEqual([])
    const owed = owedSites(cardiomyocyte, [])
    expect(owed.length).toBeGreaterThan(0)
    expect(owed.every((site) => ['cytosol', 'membrane', 'region', 'cytosolic'].includes(site.role))).toBe(true)
    expect(owed.some((site) => site.path.includes('.'))).toBe(false)
  })
})

describe('piecesOrphanedBy', () => {
  const nodes = [
    node('saline', 'pieces/bath'),
    node('cytosol', 'pieces/cell'),
    node('wall', 'pieces/pm'),
    node('pump', 'pieces/pm.apical'),
    node('conduit', 'pieces/link'),
    node('loose', undefined),
  ]

  it('gives the pieces whose module goes', () => {
    expect(piecesOrphanedBy(scene(), nodes, ['wall', 'saline'])).toEqual(['bath', 'pm'])
    expect(piecesOrphanedBy(scene(), nodes, ['conduit'])).toEqual(['link'])
  })

  it('gives none for a protein, a loose module or nothing', () => {
    expect(piecesOrphanedBy(scene(), nodes, ['pump', 'loose'])).toEqual([])
    expect(piecesOrphanedBy(scene(), nodes, [])).toEqual([])
  })

  it('ignores a second module on a one-module site, which holds nothing', () => {
    // The first by name holds the site: 'saline' before 'zz-second', but 'a-first' before 'saline'.
    expect(piecesOrphanedBy(scene(), [...nodes, node('zz-second', 'pieces/bath')], ['saline'])).toEqual(['bath'])
    expect(piecesOrphanedBy(scene(), [...nodes, node('a-first', 'pieces/bath')], ['saline'])).toEqual([])
  })
})

describe('modulesOf', () => {
  it('gives the modules that are the pieces, not those on their spans', () => {
    const nodes = [node('saline', 'pieces/bath'), node('wall', 'pieces/pm'), node('pump', 'pieces/pm.apical')]
    expect([...modulesOf(scene(), nodes, ['pm', 'bath'])].sort()).toEqual(['saline', 'wall'])
    expect([...modulesOf(scene(), nodes, ['cell'])]).toEqual([])
  })
})

describe('piecesByModuleName', () => {
  it('labels a piece by its module’s name where the module was renamed, else leaves it', () => {
    const named = (id, site, name) => ({ id, data: { name, bioView: { site } } })
    const nodes = [
      named('n1', 'pieces/bath', 'Sinusoid_bed'),
      named('n2', 'pieces/cell', 'Cell_2'),
      named('n3', 'pieces/pm', 'Plasma_membrane'),
      named('n4', 'pieces/pm.apical', 'Pump'),
    ]
    const labels = Object.fromEntries(piecesByModuleName(scene(), nodes).map((piece) => [piece.id, piece.label]))
    expect(labels).toEqual({ bath: 'Sinusoid bed', cell: 'Cell', pm: 'Plasma membrane', link: 'Link' })
  })
})

describe('piecesOwed', () => {
  const kindOf = (node) => node.data.kind ?? null
  const loose = (id, kind, extra = {}) => ({ id, data: { name: id, kind, ...extra } })

  it('gives the compartments’ modules that are on no piece', () => {
    const nodes = [
      loose('lumen', 'compartment'),
      loose('wall', 'membrane'),
      loose('pump', 'transporter'),
      loose('plain', null),
      {
        ...node('saline', 'pieces/bath'),
        data: { name: 'saline', kind: 'compartment', bioView: { site: 'pieces/bath' } },
      },
      loose('lost', 'compartment', { bioView: { site: 'pieces/nowhere' } }),
    ]
    expect(piecesOwed(scene(), nodes, kindOf)).toEqual(['lumen', 'lost'])
    expect(piecesOwed([], [loose('lumen', 'compartment')], kindOf)).toEqual(['lumen'])
  })

  it('leaves a module on a piece where it is, whatever its annotations say', () => {
    const wall = { id: 'wall', data: { name: 'wall', kind: 'compartment', bioView: { site: 'pieces/pm' } } }
    expect(piecesOwed(scene(), [wall], kindOf)).toEqual([])
  })
})

describe('compartmentsFor', () => {
  it('adds a compartment for each, named for it, where its card was put or in a row right of the pieces', () => {
    const nodes = [
      { id: 'a', data: { name: 'Lumen', bioView: { position: { x: -500, y: 40 } } } },
      { id: 'b', data: { name: 'Blood' } },
      { id: 'c', data: { name: 'Bile' } },
    ]
    const { pieces: raw, sites } = compartmentsFor(scene(), nodes)
    const { pieces, errors } = validatePieces(raw)
    expect(errors).toEqual([])
    const added = pieces.slice(scene().length)
    expect(added.map((piece) => piece.label)).toEqual(['Lumen', 'Blood', 'Bile'])
    expect(added[0].frame).toMatchObject({ x: -500, y: 40 })
    const right = Math.max(...[...layoutPieces(scene()).rects.values()].map((rect) => rect.x + rect.width))
    expect(added[1].frame.x).toBeGreaterThan(right)
    expect(added[2].frame.x).toBeGreaterThan(added[1].frame.x + added[1].frame.width)
    expect(sites.get('b')).toBe(`pieces/${added[1].id}`)
    // Each is then owed nothing more: its module is the node bound to it.
    const bound = nodes.map((n) => ({ ...n, data: { ...n.data, bioView: { site: sites.get(n.id) } } }))
    expect(modulesOwed(pieces, bound).filter((path) => added.some((piece) => piece.id === path))).toEqual([])
  })

  it('starts at the origin with no pieces', () => {
    const { pieces: raw } = compartmentsFor([], [{ id: 'a', data: { name: 'Lumen' } }])
    expect(raw[0].frame).toMatchObject({ x: 0, y: 0 })
  })
})

describe('pieceNameOf', () => {
  it('names a compartment, membrane or tube by its module, and any other piece by its label', () => {
    const nodes = [node('Saline', 'pieces/bath')]
    expect(pieceNameOf(scene(), nodes, 'bath')).toBe('Saline')
    expect(pieceNameOf(scene(), nodes, 'cell')).toBe('Cell')
    expect(pieceNameOf(scene(), nodes, 'nowhere')).toBe('nowhere')
  })
})
