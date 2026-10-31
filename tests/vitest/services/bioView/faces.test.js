import { Position } from '@vue-flow/core'
import { describe, expect, it } from 'vitest'

import { focusCouplings } from '../../../../src/composables/useBioNodes.js'
import { GO } from '../../../../src/services/annotations/iris.js'
import { facePoint, handleFace } from '../../../../src/services/bioView/faces.js'
import { GLYPH_HEIGHT, GLYPH_WIDTH } from '../../../../src/services/bioView/geometry.js'
import { layoutBioView, layoutPhysiology } from '../../../../src/services/bioView/layout.js'
import { BUILT_IN_TEMPLATES } from '../../../../src/services/bioView/builtInTemplates.js'
import { bioFlowNodes } from '../../../../src/composables/useBioNodes.js'

const port = (variable, location) => ({ variables: [variable], ...(location && { annotation: { location } }) })
const edge = (id, source, sourceHandle, target, targetHandle, couplings) => ({ id, source, sourceHandle, target, targetHandle, data: { couplings } })

describe('which face of a protein a handle belongs on', () => {
  const handle = { uid: 'h1' }

  it('reads the places of the quantities coupled at the handle', () => {
    const edges = [
      edge('e1', 'p', 'handle_h1', 'lumen', 'handle_x', [{ sourcePort: port('c_Na_o', GO.extracellularRegion), targetPort: port('c_Na') }]),
      edge('e2', 'cell', 'handle_y', 'p', 'handle_h1', [{ sourcePort: port('c_Na'), targetPort: port('c_Na_o', GO.extracellularRegion) }]),
    ]
    expect(handleFace('p', handle, edges, null)).toBe('outside')
  })

  it('falls back to the sidecar for a port without its own annotation', () => {
    const sidecar = { variables: [{ variable: 'c_K_i', location: GO.cytoplasm }] }
    const edges = [edge('e', 'p', 'handle_h1', 'cell', 'handle_c', [{ sourcePort: port('c_K_i'), targetPort: port('c_K') }])]
    expect(handleFace('p', handle, edges, sidecar)).toBe('inside')
  })

  it('gives one edge’s face when asked about it alone, though the handle is shared', () => {
    const shared = [
      edge('a', 'p', 'handle_h1', 'lumen', 'x', [{ sourcePort: port('c_o', GO.extracellularRegion), targetPort: port('c') }]),
      edge('b', 'p', 'handle_h1', 'cell', 'y', [{ sourcePort: port('c_i', GO.cytoplasm), targetPort: port('c') }]),
    ]
    expect(handleFace('p', handle, shared, null)).toBeNull()
    expect(handleFace('p', handle, [shared[0]], null)).toBe('outside')
    expect(handleFace('p', handle, [shared[1]], null)).toBe('inside')
  })

  it('reads the membrane, and gives nothing for no data or a tie', () => {
    const at = (...locations) => [
      edge('e', 'p', 'handle_h1', 'm', 'handle_m', locations.map((location, i) => ({ sourcePort: port(`v${i}`, location), targetPort: port('x') }))),
    ]
    expect(handleFace('p', handle, at(GO.plasmaMembrane), null)).toBe('membrane')
    expect(handleFace('p', handle, at(`self+${GO.cytoplasm}`), null)).toBe('inside')
    expect(handleFace('p', handle, at(GO.cytoplasm, GO.extracellularRegion), null)).toBeNull()
    expect(handleFace('p', handle, [], null)).toBeNull()
  })

  it('starts a face’s couplings on the cartoon’s edge, however it is turned', () => {
    const size = { width: GLYPH_WIDTH, height: GLYPH_HEIGHT }
    // Apical: outside up. Its outer and inner edges are half its height from its centre.
    expect(facePoint({ x: 100, y: 0, outward: Position.Top }, 'outside', size)).toEqual({ point: { x: 100, y: -24 }, direction: { x: 0, y: -1 } })
    expect(facePoint({ x: 100, y: 0, outward: Position.Top }, 'inside', size).point).toEqual({ x: 100, y: 24 })
    // On a cell's left side, turned a quarter: still half its height out, not half its box's width.
    expect(facePoint({ x: 0, y: 50, outward: Position.Left }, 'outside', size).point).toEqual({ x: -24, y: 50 })
    // A membrane coupling leaves from the side, half its width along the membrane.
    expect(facePoint({ x: 100, y: 0, outward: Position.Top }, 'membrane', size).point).toEqual({ x: 132, y: 0 })
  })
})

describe('the couplings of what is selected', () => {
  const role = (role, extra = {}) => ({ role, facet: null, cell: null, side: null, glyph: null, ...extra })
  const nodes = [
    { id: 'cell', data: { name: 'cell' } },
    { id: 'wall', data: { name: 'wall' } },
    { id: 'p', data: { name: 'p', handles: [{ uid: 'po' }, { uid: 'shared' }] } },
    { id: 'lumen', data: { name: 'lumen' } },
  ]
  const roles = new Map([
    ['cell', role('cytosol')],
    ['wall', role('membrane', { cell: 'cell' })],
    ['p', role('membraneProtein', { cell: 'cell', facet: 'apical' })],
    ['lumen', role('region', { side: 'apical' })],
  ])
  const layout = layoutBioView(nodes, roles)
  // One diagram handle on p carries a coupling to each side of the membrane.
  const edges = [
    edge('out', 'lumen', 'handle_l', 'p', 'handle_shared', [{ sourcePort: port('c'), targetPort: port('c_o', GO.extracellularRegion) }]),
    edge('in', 'p', 'handle_shared', 'cell', 'handle_c', [{ sourcePort: port('c_i', GO.cytoplasm), targetPort: port('c') }]),
    edge('mem', 'p', 'handle_po', 'wall', 'handle_w', [{ sourcePort: port('u', GO.plasmaMembrane), targetPort: port('u') }]),
  ]
  const focus = (...ids) => focusCouplings(nodes, edges, layout, new Set(ids), () => null)

  it('draws nothing when nothing is selected', () => {
    expect(focus()).toEqual({ edges: [], handles: new Map() })
  })

  it('draws a selected protein’s couplings from the face each is on, a little way into the space, and none with its membrane', () => {
    const { edges: drawn, handles } = focus('p')
    expect(drawn.map((e) => e.id)).toEqual(['out', 'in'])
    const p = layout.get('p')
    const at = (nodeId, id) => {
      const handle = handles.get(nodeId).find((h) => h.id === id)
      const box = nodeId === 'p' ? { x: p.x - GLYPH_WIDTH / 2, y: p.y - GLYPH_HEIGHT / 2 } : layout.get(nodeId).rect
      return { x: box.x + handle.x, y: box.y + handle.y }
    }
    // The shared diagram handle is drawn from both faces.
    expect(at('p', 'out:t')).toEqual({ x: p.x, y: p.y - GLYPH_HEIGHT / 2 })
    expect(at('p', 'in:s')).toEqual({ x: p.x, y: p.y + GLYPH_HEIGHT / 2 })
    // Each space's end lies straight on from the face, not in the space's middle.
    expect(at('lumen', 'out:s').x).toBe(p.x)
    expect(at('lumen', 'out:s').y).toBeLessThan(p.y - GLYPH_HEIGHT / 2)
    expect(at('cell', 'in:t').x).toBe(p.x)
    expect(at('cell', 'in:t').y).toBeGreaterThan(p.y + GLYPH_HEIGHT / 2)
    expect(drawn.every((e) => e.zIndex === -5 && e.selectable === false)).toBe(true)
  })

  it('names what each line couples, for hover', () => {
    expect(focus('cell').edges.map((e) => e.data.names)).toEqual([['p.c_i ↔ cell.c']])
  })
})

describe('the couplings of a protein on a template facet with no annotation', () => {
  const definitions = new Map(BUILT_IN_TEMPLATES.map((template) => [template.id, template]))
  const instances = [{ id: 'bt-1', template: 'chemical-synapse', at: { x: 0, y: 0 } }]
  const bound = (id, site, extra = {}) => ({ id, data: { name: id, bioView: { site }, ...extra } })
  const nodes = [
    bound('pre', 'bt-1/pre'),
    bound('cleft', 'bt-1/cleft'),
    bound('vgcc', 'bt-1/pre.active-zone', { handles: [{ uid: 'h' }] }),
    bound('ampa', 'bt-1/post.psd'),
  ]
  const roles = new Map([
    ['pre', { role: 'cytosol', site: 'bt-1/pre' }],
    ['cleft', { role: 'region', site: 'bt-1/cleft' }],
    ['vgcc', { role: 'membraneProtein', facet: null, glyph: 'channel', annotatedFacet: null, site: 'bt-1/pre.active-zone' }],
    ['ampa', { role: 'membraneProtein', facet: null, glyph: 'channel', annotatedFacet: null, site: 'bt-1/post.psd' }],
  ])
  const { places } = layoutPhysiology(nodes, roles, { instances, definitions })

  it('turns each protein by its facet’s edge, with no moved badge', () => {
    const bio = bioFlowNodes(nodes, roles, places)
    expect(bio.find((n) => n.id === 'vgcc').data).toMatchObject({ facet: 'active-zone', rotation: 180, outward: Position.Bottom, annotatedFacet: null })
    expect(bio.find((n) => n.id === 'ampa').data).toMatchObject({ facet: 'psd', rotation: 0, outward: Position.Top })
  })

  it('draws an outside coupling from the face towards the cleft, below the active zone', () => {
    const edges = [
      edge('out', 'cleft', 'handle_c', 'vgcc', 'handle_h', [{ sourcePort: port('Ca'), targetPort: port('Ca_o', GO.extracellularRegion) }]),
    ]
    const { edges: drawn, handles } = focusCouplings(nodes, edges, places, new Set(['vgcc']), () => null)
    expect(drawn.map((e) => e.id)).toEqual(['out'])
    const p = places.get('vgcc')
    const face = handles.get('vgcc').find((h) => h.id === 'out:t')
    expect(face).toMatchObject({ x: GLYPH_WIDTH / 2, y: GLYPH_HEIGHT })
    const cleft = places.get('cleft').rect
    const end = handles.get('cleft').find((h) => h.id === 'out:s')
    expect(cleft.y + end.y).toBeGreaterThan(p.y)
  })
})
