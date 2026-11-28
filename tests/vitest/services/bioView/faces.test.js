import { Position } from '@vue-flow/core'
import { describe, expect, it } from 'vitest'

import { focusCouplings } from '../../../../src/composables/useBioNodes.js'
import { GO } from '../../../../src/services/annotations/iris.js'
import { facePoint, handleFace } from '../../../../src/services/bioView/faces.js'
import { SYMBOL_HEIGHT, SYMBOL_WIDTH } from '../../../../src/services/bioView/geometry.js'
import { layoutPhysiology } from '../../../../src/services/bioView/layout.js'
import { getBuiltInPieceTemplate } from '../../../../src/services/bioView/pieces/builtInTemplates.js'
import { boundToPieces, layoutPieces } from '../../../../src/services/bioView/pieces/layout.js'
import { bioFlowNodes } from '../../../../src/composables/useBioNodes.js'

const port = (variable, location) => ({ variables: [variable], ...(location && { annotation: { location } }) })
const edge = (id, source, sourceHandle, target, targetHandle, couplings) => ({
  id,
  source,
  sourceHandle,
  target,
  targetHandle,
  data: { couplings },
})

describe('which face of a protein a handle belongs on', () => {
  const handle = { uid: 'h1' }

  it('reads the places of the quantities coupled at the handle', () => {
    const edges = [
      edge('e1', 'p', 'handle_h1', 'lumen', 'handle_x', [
        { sourcePort: port('c_Na_o', GO.extracellularRegion), targetPort: port('c_Na') },
      ]),
      edge('e2', 'cell', 'handle_y', 'p', 'handle_h1', [
        { sourcePort: port('c_Na'), targetPort: port('c_Na_o', GO.extracellularRegion) },
      ]),
    ]
    expect(handleFace('p', handle, edges, null)).toBe('outside')
  })

  it('falls back to the sidecar for a port without its own annotation', () => {
    const sidecar = { variables: [{ variable: 'c_K_i', location: GO.cytoplasm }] }
    const edges = [
      edge('e', 'p', 'handle_h1', 'cell', 'handle_c', [{ sourcePort: port('c_K_i'), targetPort: port('c_K') }]),
    ]
    expect(handleFace('p', handle, edges, sidecar)).toBe('inside')
  })

  it('gives one edge’s face when asked about it alone, though the handle is shared', () => {
    const shared = [
      edge('a', 'p', 'handle_h1', 'lumen', 'x', [
        { sourcePort: port('c_o', GO.extracellularRegion), targetPort: port('c') },
      ]),
      edge('b', 'p', 'handle_h1', 'cell', 'y', [{ sourcePort: port('c_i', GO.cytoplasm), targetPort: port('c') }]),
    ]
    expect(handleFace('p', handle, shared, null)).toBeNull()
    expect(handleFace('p', handle, [shared[0]], null)).toBe('outside')
    expect(handleFace('p', handle, [shared[1]], null)).toBe('inside')
  })

  it('reads the membrane, and gives nothing for no data or a tie', () => {
    const at = (...locations) => [
      edge(
        'e',
        'p',
        'handle_h1',
        'm',
        'handle_m',
        locations.map((location, i) => ({ sourcePort: port(`v${i}`, location), targetPort: port('x') })),
      ),
    ]
    expect(handleFace('p', handle, at(GO.plasmaMembrane), null)).toBe('membrane')
    expect(handleFace('p', handle, at(`self+${GO.cytoplasm}`), null)).toBe('inside')
    expect(handleFace('p', handle, at(GO.cytoplasm, GO.extracellularRegion), null)).toBeNull()
    expect(handleFace('p', handle, [], null)).toBeNull()
  })

  it('starts a face’s couplings on the cartoon’s edge, however it is turned', () => {
    const size = { width: SYMBOL_WIDTH, height: SYMBOL_HEIGHT }
    // Apical: outside up. Its outer and inner edges are half its height from its centre.
    expect(facePoint({ x: 100, y: 0, outward: Position.Top }, 'outside', size)).toEqual({
      point: { x: 100, y: -24 },
      direction: { x: 0, y: -1 },
    })
    expect(facePoint({ x: 100, y: 0, outward: Position.Top }, 'inside', size).point).toEqual({ x: 100, y: 24 })
    // On a cell's left side, turned a quarter: still half its height out, not half its box's width.
    expect(facePoint({ x: 0, y: 50, outward: Position.Left }, 'outside', size).point).toEqual({ x: -24, y: 50 })
    // A membrane coupling leaves from the side, half its width along the membrane.
    expect(facePoint({ x: 100, y: 0, outward: Position.Top }, 'membrane', size).point).toEqual({ x: 132, y: 0 })
  })

  it('starts a face at the glyph’s own anchor, turned with the protein', () => {
    // A receptor's cleft, 15 down from its outside edge, in the middle.
    const size = { width: SYMBOL_WIDTH, height: SYMBOL_HEIGHT }
    const anchors = { outside: { x: 32, y: 15 } }
    const at = (outward) => facePoint({ x: 100, y: 100, outward }, 'outside', size, anchors)
    expect(at(Position.Top)).toEqual({ point: { x: 100, y: 91 }, direction: { x: 0, y: -1 } })
    expect(at(Position.Bottom).point).toEqual({ x: 100, y: 109 })
    expect(at(Position.Left).point).toEqual({ x: 91, y: 100 })
    expect(at(Position.Right).point).toEqual({ x: 109, y: 100 })
    // Off-centre across, turned a quarter onto the cell's right side: across runs down.
    const side = { outside: { x: 42, y: 0 } }
    expect(facePoint({ x: 0, y: 0, outward: Position.Right }, 'outside', size, side).point).toEqual({ x: 24, y: 10 })
    // Faces it doesn't anchor stay at the box's edges.
    expect(facePoint({ x: 100, y: 0, outward: Position.Top }, 'inside', size, anchors).point).toEqual({ x: 100, y: 24 })
  })

  it('moves a face’s point along it as the cartoon’s own x runs, however it is turned', () => {
    const size = { width: SYMBOL_WIDTH, height: SYMBOL_HEIGHT }
    const at = (outward, face) => facePoint({ x: 100, y: 100, outward }, face, size, undefined, -10).point
    // Upright, left of the middle on both faces; upside down, to the right; on a side, along the cell's edge.
    expect(at(Position.Top, 'outside')).toEqual({ x: 90, y: 76 })
    expect(at(Position.Top, 'inside')).toEqual({ x: 90, y: 124 })
    expect(at(Position.Bottom, 'outside')).toEqual({ x: 110, y: 124 })
    expect(at(Position.Left, 'inside')).toEqual({ x: 124, y: 110 })
    expect(at(Position.Right, 'outside')).toEqual({ x: 124, y: 90 })
    // From a glyph's own anchor too.
    const anchored = facePoint(
      { x: 100, y: 100, outward: Position.Top },
      'outside',
      size,
      { outside: { x: 32, y: 15 } },
      5,
    )
    expect(anchored.point).toEqual({ x: 105, y: 91 })
  })
})

describe('the couplings of what is selected', () => {
  // An epithelial cell, its membrane, a protein on its apical membrane and the apical fluid outside it.
  const on = (id, site, extra = {}) => ({ id, data: { name: id, bioView: { site: `pieces/${site}` }, ...extra } })
  const nodes = [
    on('cell', 'cell'),
    on('wall', 'plasma-membrane'),
    on('p', 'plasma-membrane.apical', { handles: [{ uid: 'po' }, { uid: 'shared' }] }),
    on('lumen', 'apical-fluid'),
  ]
  const layout = layoutPieces(getBuiltInPieceTemplate('epithelial-cell').pieces, { nodes }).places
  // One diagram handle on p carries a coupling to each side of the membrane.
  const edges = [
    edge('out', 'lumen', 'handle_l', 'p', 'handle_shared', [
      { sourcePort: port('c'), targetPort: port('c_o', GO.extracellularRegion) },
    ]),
    edge('in', 'p', 'handle_shared', 'cell', 'handle_c', [
      { sourcePort: port('c_i', GO.cytoplasm), targetPort: port('c') },
    ]),
    edge('mem', 'p', 'handle_po', 'wall', 'handle_w', [
      { sourcePort: port('u', GO.plasmaMembrane), targetPort: port('u') },
    ]),
  ]
  const focus = (...ids) => focusCouplings(nodes, edges, layout, new Set(ids), () => null)

  it('draws nothing when nothing is selected', () => {
    expect(focus()).toEqual({ edges: [], handles: new Map(), partners: new Set() })
  })

  it('draws a selected protein’s couplings from the face each is on, a little way into the space', () => {
    const { edges: drawn, handles } = focus('p')
    expect(drawn.map((e) => e.id)).toEqual(['out', 'in', 'mem'])
    const p = layout.get('p')
    const at = (nodeId, id) => {
      const handle = handles.get(nodeId).find((h) => h.id === id)
      const box = nodeId === 'p' ? { x: p.x - SYMBOL_WIDTH / 2, y: p.y - SYMBOL_HEIGHT / 2 } : layout.get(nodeId).rect
      return { x: box.x + handle.x, y: box.y + handle.y }
    }
    // The shared diagram handle is drawn from both faces.
    expect(at('p', 'out:t')).toEqual({ x: p.x, y: p.y - SYMBOL_HEIGHT / 2 })
    expect(at('p', 'in:s')).toEqual({ x: p.x, y: p.y + SYMBOL_HEIGHT / 2 })
    // Each space's end lies straight on from the face, not in the space's middle.
    expect(at('lumen', 'out:s').x).toBe(p.x)
    expect(at('lumen', 'out:s').y).toBeLessThan(p.y - SYMBOL_HEIGHT / 2)
    expect(at('cell', 'in:t').x).toBe(p.x)
    expect(at('cell', 'in:t').y).toBeGreaterThan(p.y + SYMBOL_HEIGHT / 2)
    expect(drawn.every((e) => e.zIndex === -5 && e.selectable === false)).toBe(true)
  })

  it('draws a protein’s couplings with its membrane along the bilayer, from the membrane or the protein', () => {
    for (const selected of ['wall', 'p']) {
      const { edges: drawn, handles } = focus(selected)
      expect(drawn.map((e) => e.id)).toContain('mem')
      const p = layout.get('p')
      const cell = layout.get('cell').rect
      const face = handles.get('p').find((h) => h.id === 'mem:s')
      const end = handles.get('wall').find((h) => h.id === 'mem:t')
      // From the protein's side, along the membrane, to a point on the cell's outline box beside it.
      expect(face.y).toBe(SYMBOL_HEIGHT / 2)
      expect(cell.y + end.y).toBeCloseTo(p.y, 0)
      expect(cell.x + end.x).not.toBe(p.x)
    }
  })

  it('draws a line nothing couples from the protein’s centre to its partner’s', () => {
    const uncoupled = [edge('none', 'p', 'handle_po', 'lumen', 'handle_l', [])]
    const { edges: drawn, handles } = focusCouplings(nodes, uncoupled, layout, new Set(['p']), () => null)
    expect(drawn.map((e) => [e.id, e.data.uncoupled])).toEqual([['none', true]])
    const lumen = layout.get('lumen').rect
    expect(handles.get('p')).toEqual([{ id: 'none:s', x: SYMBOL_WIDTH / 2, y: SYMBOL_HEIGHT / 2 }])
    expect(handles.get('lumen')).toEqual([{ id: 'none:t', x: lumen.width / 2, y: lumen.height / 2 }])
  })

  it('draws a line to a module in a link’s joint from the middle of the joint it is drawn as', () => {
    const zone = { x: 90, y: 80, width: 40, height: 100 }
    const places = new Map([
      ['gj', { kind: 'card', joint: 'junction', x: 60, y: 110, link: 'piece:L' }],
      ['piece:L', { kind: 'link', joint: 'junction', rect: zone, zone }],
      ['cell', { kind: 'cell', rect: { x: 0, y: 0, width: 100, height: 200 } }],
    ])
    const joined = [edge('j', 'gj', 'handle_g', 'cell', 'handle_c', [])]
    const { handles } = focusCouplings([], joined, places, new Set(['gj']), () => null)
    expect(handles.get('gj')).toEqual([{ id: 'j:s', x: zone.width / 2, y: zone.height / 2 }])
  })

  it('marks what the selection is coupled to, so a membrane’s proteins and a protein’s membrane light up', () => {
    expect([...focus('wall').partners]).toEqual(['p'])
    expect(focus('p').partners).toEqual(new Set(['lumen', 'cell', 'wall']))
  })

  it('names what each line couples, for hover', () => {
    expect(focus('cell').edges.map((e) => e.data.names)).toEqual([['p.c_i ↔ cell.c']])
  })
})

describe('the couplings of a protein on a stretch of membrane with no annotation', () => {
  const pieces = getBuiltInPieceTemplate('chemical-synapse').pieces
  const bound = (id, site, extra = {}) => ({ id, data: { name: id, bioView: { site }, ...extra } })
  const nodes = [
    bound('pre', 'pieces/pre'),
    bound('cleft', 'pieces/cleft'),
    bound('vgcc', 'pieces/pre-membrane.active-zone', { handles: [{ uid: 'h' }] }),
    bound('ampa', 'pieces/post-membrane.psd'),
  ]
  const protein = (site) => ({ role: 'membraneProtein', skin: 'channel', site })
  const roles = new Map([
    ['pre', { role: 'cytosol', site: 'pieces/pre' }],
    ['cleft', { role: 'region', site: 'pieces/cleft' }],
    ['vgcc', protein('pieces/pre-membrane.active-zone')],
    ['ampa', protein('pieces/post-membrane.psd')],
  ])
  // As useBioNodes lays the view out: the pieces with the nodes bound to them, and the rest beside them.
  const placedElsewhere = new Set(boundToPieces(pieces, nodes).bound.keys())
  const places = new Map([
    ...layoutPhysiology(nodes, roles, { placedElsewhere }).places,
    ...layoutPieces(pieces, { nodes }).places,
  ])

  it('turns each protein by its facet’s edge', () => {
    const bio = bioFlowNodes(nodes, roles, places)
    expect(bio.find((n) => n.id === 'vgcc').data).toMatchObject({
      facet: 'active-zone',
      rotation: 180,
      outward: Position.Bottom,
    })
    expect(bio.find((n) => n.id === 'ampa').data).toMatchObject({ facet: 'psd', rotation: 0, outward: Position.Top })
  })

  it('draws an outside coupling from the face towards the cleft, below the active zone', () => {
    const edges = [
      edge('out', 'cleft', 'handle_c', 'vgcc', 'handle_h', [
        { sourcePort: port('Ca'), targetPort: port('Ca_o', GO.extracellularRegion) },
      ]),
    ]
    const { edges: drawn, handles } = focusCouplings(nodes, edges, places, new Set(['vgcc']), () => null)
    expect(drawn.map((e) => e.id)).toEqual(['out'])
    const p = places.get('vgcc')
    const face = handles.get('vgcc').find((h) => h.id === 'out:t')
    expect(face).toMatchObject({ x: SYMBOL_WIDTH / 2, y: SYMBOL_HEIGHT })
    const cleft = places.get('cleft').rect
    const end = handles.get('cleft').find((h) => h.id === 'out:s')
    expect(cleft.y + end.y).toBeGreaterThan(p.y)
  })
})
