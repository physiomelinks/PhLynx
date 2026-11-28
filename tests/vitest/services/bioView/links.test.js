import { describe, expect, it } from 'vitest'

import { getBuiltInPieceTemplate } from '../../../../src/services/bioView/pieces/builtInTemplates.js'
import { topologyOf } from '../../../../src/services/bioView/pieces/topology.js'
import {
  dropLabel,
  fillPlacementCouplings,
  isPlacementEdge,
  linkCouplings,
  siteLabel,
  siteLinks,
  staleLinks,
} from '../../../../src/services/bioView/links.js'

const port = (portType, label, variables) => ({ portType, label, variables, multiportType: 'None' })
/** A vessel-like module: one inlet and one outlet, each a single connection. */
const io = (id) => ({
  id,
  ports: [port('entrance_ports', 'vessel_port', ['v_in', 'u']), port('exit_ports', 'vessel_port', ['v', 'u_out'])],
})
const bare = (id) => ({ id, ports: [] })

/** The sites of a template's pieces, and the sites next to each (see topologyOf). */
const topologyOfTemplate = (templateId) => topologyOf(getBuiltInPieceTemplate(templateId).pieces)

/**
 * Drops modules on the sites of a template's pieces in turn, linking each to the ones already on the sites next to it
 * and coupling each link as the drop does.
 *
 * @returns {Array<Object>} The edges made, each { source, target, kind, couplings }.
 */
function dropAll(templateId, drops) {
  const topology = topologyOfTemplate(templateId)
  const roles = new Map(topology.sites.map((site) => [site.path, site.role]))
  const placed = new Map()
  const edges = []
  for (const [path, node] of drops) {
    expect(roles.has(path), path).toBe(true)
    const neighbours = topology
      .neighbours(path)
      .flatMap(({ path: other, relation }) => (placed.has(other) ? [{ id: placed.get(other).id, relation }] : []))
    const byId = new Map([...placed.values(), node].map((n) => [n.id, n]))
    for (const { from, to, kind } of siteLinks(node.id, roles.get(path), neighbours)) {
      const couplings = linkCouplings(byId.get(from), byId.get(to), kind, edges)
      edges.push({ id: `${from}--${to}`, source: from, target: to, kind, data: { couplings, placement: kind } })
    }
    placed.set(path, node)
  }
  return edges
}

/** Each edge as 'source → target kind: sourceVars>targetVars, …'. */
const summary = (edges) =>
  edges.map(
    (e) =>
      `${e.source} → ${e.target} ${e.kind}: ` +
      e.data.couplings.map((c) => `${c.sourcePort.variables[0]}>${c.targetPort.variables[0]}`).join(', '),
  )

describe('siteLinks', () => {
  it('runs a membrane protein from outside to inside, and exchanges with its membrane', () => {
    const links = siteLinks('p', 'membraneProtein', [
      { id: 'lumen', relation: 'outside' },
      { id: 'cell', relation: 'inside' },
      { id: 'mem', relation: 'membrane' },
    ])
    expect(links).toEqual([
      { from: 'lumen', to: 'p', kind: 'across' },
      { from: 'p', to: 'cell', kind: 'across' },
      { from: 'p', to: 'mem', kind: 'exchange' },
    ])
  })

  it('gives the same direction whichever end is dropped last', () => {
    expect(siteLinks('cell', 'cytosol', [{ id: 'p', relation: 'protein' }])).toEqual([
      { from: 'p', to: 'cell', kind: 'across' },
    ])
    expect(siteLinks('lumen', 'region', [{ id: 'p', relation: 'protein' }])).toEqual([
      { from: 'lumen', to: 'p', kind: 'across' },
    ])
  })

  it('runs conduits upstream to downstream', () => {
    expect(
      siteLinks('c', 'region', [
        { id: 'up', relation: 'upstream' },
        { id: 'down', relation: 'downstream' },
      ]),
    ).toEqual([
      { from: 'up', to: 'c', kind: 'flow' },
      { from: 'c', to: 'down', kind: 'flow' },
    ])
  })
})

describe('linkCouplings', () => {
  it('couples an exit to an entrance along a directed link, never the other way', () => {
    const couplings = linkCouplings(io('a'), io('b'), 'across')
    expect(summary([{ source: 'a', target: 'b', kind: 'across', data: { couplings } }])).toEqual([
      'a → b across: v>v_in',
    ])
  })

  it('couples only general ports on an exchange', () => {
    expect(linkCouplings(io('a'), io('b'), 'exchange')).toEqual([])
    const general = (id) => ({ id, ports: [port('general_ports', 'potential', ['V'])] })
    expect(linkCouplings(general('a'), general('b'), 'exchange')).toHaveLength(1)
  })

  it('never couples a single-connection outlet a second time', () => {
    const first = { source: 'a', target: 'b', data: { couplings: linkCouplings(io('a'), io('b'), 'across') } }
    expect(linkCouplings(io('a'), io('c'), 'across', [first])).toEqual([])
  })

  it('couples nothing with a module that has no ports', () => {
    expect(linkCouplings(bare('a'), io('b'), 'across')).toEqual([])
    expect(linkCouplings(io('a'), bare('b'), 'across')).toEqual([])
  })
})

describe('drop coupling on a template’s pieces', () => {
  it('epithelial cell: lumen → apical protein → cell', () => {
    const edges = dropAll('epithelial-cell', [
      ['apical-fluid', io('lumen')],
      ['cell', io('cell')],
      ['plasma-membrane.apical', io('p')],
    ])
    expect(summary(edges)).toEqual(['p → cell across: v>v_in', 'lumen → p across: v>v_in'])
  })

  it('epithelial cell: modules with no ports are still joined, uncoupled', () => {
    const edges = dropAll('epithelial-cell', [
      ['apical-fluid', bare('lumen')],
      ['plasma-membrane.apical', bare('p')],
    ])
    expect(summary(edges)).toEqual(['lumen → p across: '])
  })

  it('two-cell epithelium: a lateral protein takes the paracellular space in and lets cell A out', () => {
    const edges = dropAll('two-cell-epithelium', [
      ['a', io('A')],
      ['paracellular', io('para')],
      ['a-membrane.lateral-right', io('latA')],
    ])
    // Its one outlet goes to cell A only; its inlet takes the paracellular space's outlet.
    expect(summary(edges)).toEqual(['latA → A across: v>v_in', 'para → latA across: v>v_in'])
  })

  it('two-cell epithelium: the paracellular outlet couples one lateral protein, not both', () => {
    const edges = dropAll('two-cell-epithelium', [
      ['paracellular', io('para')],
      ['a-membrane.lateral-right', io('latA')],
      ['b-membrane.lateral-left', io('latB')],
    ])
    expect(summary(edges)).toEqual(['para → latA across: v>v_in', 'para → latB across: '])
  })

  it('two-cell epithelium: no ports on the protein leaves both edges uncoupled', () => {
    const edges = dropAll('two-cell-epithelium', [
      ['a', io('A')],
      ['paracellular', io('para')],
      ['a-membrane.lateral-right', bare('latA')],
    ])
    expect(summary(edges)).toEqual(['latA → A across: ', 'para → latA across: '])
  })

  it('chemical synapse: cleft → receptor → postsynaptic cell, and the receptor exchanges with its membrane', () => {
    const edges = dropAll('chemical-synapse', [
      ['cleft', io('cleft')],
      ['post', io('post')],
      ['post-membrane', io('postMem')],
      ['post-membrane.psd', io('receptor')],
    ])
    expect(summary(edges)).toEqual([
      'postMem → post exchange: ',
      'receptor → post across: v>v_in',
      'receptor → postMem exchange: ',
      'cleft → receptor across: v>v_in',
    ])
  })

  it('chemical synapse: no ports anywhere still joins every neighbour', () => {
    const edges = dropAll('chemical-synapse', [
      ['cleft', bare('cleft')],
      ['pre', bare('pre')],
      ['pre-membrane.active-zone', bare('release')],
    ])
    expect(summary(edges)).toEqual(['release → pre across: ', 'cleft → release across: '])
  })
})

describe('dropLabel', () => {
  const lumen = { label: 'Apical fluid', name: 'vp', hasPorts: true }
  it('names the neighbours a module with ports couples to', () => {
    expect(dropLabel('Apical membrane', { name: 'pp', hasPorts: true }, [lumen])).toBe(
      'Apical membrane · connects to Apical fluid (vp)',
    )
  })

  it('says a module with no ports is placed but not coupled', () => {
    expect(dropLabel('Apical membrane', { name: 'pp', hasPorts: false }, [lumen])).toBe(
      'Apical membrane · Placed — not coupled (pp has no ports)',
    )
  })

  it('names neighbours with no ports apart', () => {
    const cell = { label: 'Cell', name: 'c', hasPorts: false }
    expect(dropLabel('Apical membrane', { name: 'pp', hasPorts: true }, [lumen, cell])).toBe(
      'Apical membrane · connects to Apical fluid (vp) · Placed — not coupled (c has no ports)',
    )
  })

  it('is just the site with no neighbours', () => {
    expect(dropLabel('Apical membrane', { name: 'pp', hasPorts: false }, [])).toBe('Apical membrane')
  })
})

describe('siteLabel', () => {
  it('says what a drop makes: the cell’s inside, its membrane, or a protein or process new or before another', () => {
    expect(siteLabel({ type: 'area', area: 'cell', label: 'Epithelial cell' })).toBe(
      'Epithelial cell (intracellular space)',
    )
    expect(siteLabel({ type: 'area', area: 'membrane', label: 'Plasma membrane' })).toBe('Plasma membrane (membrane)')
    expect(siteLabel({ type: 'area', area: 'compartment', label: 'Apical fluid' })).toBe('Apical fluid')
    const apical = { type: 'slot', role: 'membraneProtein', label: 'Apical membrane' }
    expect(siteLabel({ ...apical, occupant: null })).toBe('Apical membrane (new protein)')
    expect(siteLabel({ ...apical, occupant: 'p' }, () => 'NHE3')).toBe('Apical membrane (protein, before NHE3)')
    expect(siteLabel({ type: 'slot', role: 'cytosolic', label: 'Metabolism', occupant: null })).toBe(
      'Metabolism (new process)',
    )
  })
})

describe('isPlacementEdge', () => {
  const annotated = (label) => ({ ...port('general_ports', label, ['q']), annotation: { subject: `#${label}` } })
  const manual = port('general_ports', 'q', ['q'])

  it('follows the mark a drop or a hand edit leaves', () => {
    expect(isPlacementEdge({ data: { couplings: [], placement: 'across' } })).toBe(true)
    const byHand = { sourcePort: manual, targetPort: manual }
    expect(isPlacementEdge({ data: { couplings: [byHand], placement: 'across' } })).toBe(true)
    expect(isPlacementEdge({ data: { couplings: [], placement: false } })).toBe(false)
  })

  // Workspaces saved before edges were marked: a drop between annotated modules couples only through annotated
  // ports, and hand-made couplings go through manual ones.
  it('counts an unmarked edge with only annotation-driven couplings, or none, as placement-made', () => {
    expect(isPlacementEdge({ data: { couplings: [] } })).toBe(true)
    expect(isPlacementEdge({})).toBe(true)
    expect(isPlacementEdge({ data: { couplings: [{ sourcePort: annotated('a'), targetPort: annotated('b') }] } })).toBe(
      true,
    )
  })

  it('never counts an unmarked edge with manual couplings, used or set aside', () => {
    expect(isPlacementEdge({ data: { couplings: [{ sourcePort: manual, targetPort: manual }] } })).toBe(false)
    const setAside = { sourcePort: manual, targetPort: manual }
    expect(isPlacementEdge({ data: { couplings: [], manualCouplings: [setAside] } })).toBe(false)
  })
})

describe('staleLinks', () => {
  /** The nodes on the sites next to a site of a template, from where each module was dropped. */
  const neighboursOf = (templateId, placed, path) =>
    topologyOfTemplate(templateId)
      .neighbours(path)
      .flatMap(({ path: other }) => (placed.has(other) ? [placed.get(other).id] : []))

  it('takes away a moved protein’s edge to the fluid it left, and keeps the one to its cell', () => {
    const drops = [
      ['apical-fluid', io('lumen')],
      ['basolateral-fluid', io('blood')],
      ['cell', io('cell')],
      ['plasma-membrane.apical', io('p')],
    ]
    const edges = dropAll('epithelial-cell', drops)
    const placed = new Map(drops)
    expect(edges.map((e) => e.id)).toEqual(['p--cell', 'lumen--p'])

    // From the apical membrane to the basolateral one.
    const before = neighboursOf('epithelial-cell', placed, 'plasma-membrane.apical')
    placed.delete('plasma-membrane.apical')
    const after = neighboursOf('epithelial-cell', placed, 'plasma-membrane.basolateral')
    expect(before).toEqual(expect.arrayContaining(['lumen', 'cell']))
    expect(after).toEqual(expect.arrayContaining(['blood', 'cell']))
    const { remove, keep } = staleLinks('p', before, after, edges)
    expect(remove.map((e) => e.id)).toEqual(['lumen--p'])
    expect(keep).toEqual([])
  })

  it('keeps an edge to a former neighbour drawn or edited by hand, apart', () => {
    const edges = [
      { id: 'p--lumen', source: 'p', target: 'lumen', data: { couplings: [], placement: false } },
      { id: 'p--gut', source: 'gut', target: 'p', data: { couplings: [], placement: 'across' } },
      { id: 'x--lumen', source: 'x', target: 'lumen', data: { couplings: [], placement: 'across' } },
    ]
    const { remove, keep } = staleLinks('p', ['lumen', 'gut', 'cell'], ['cell'], edges)
    expect(remove.map((e) => e.id)).toEqual(['p--gut'])
    expect(keep.map((e) => e.id)).toEqual(['p--lumen'])
  })

  it('leaves everything when the neighbours are the same, and takes all placement edges to the tray', () => {
    const edges = [{ id: 'p--cell', source: 'p', target: 'cell', data: { couplings: [], placement: 'across' } }]
    expect(staleLinks('p', ['cell'], ['cell'], edges).remove).toEqual([])
    expect(staleLinks('p', ['cell'], [], edges).remove.map((e) => e.id)).toEqual(['p--cell'])
  })
})

describe('fillPlacementCouplings', () => {
  const node = ({ id, ports }) => ({ id, data: { ports } })
  const edge = (source, target, data) => ({ id: `${source}--${target}`, source, target, data })

  it('couples a placement edge left empty once a new module has ports', () => {
    const nodes = [node(io('a')), node(io('b'))]
    const edges = [edge('a', 'b', { couplings: [], placement: 'across' })]
    const filled = fillPlacementCouplings({ nodes, edges, nodeIds: ['b'] })
    expect(summary([{ ...edges[0], kind: 'across', data: { couplings: filled.get('a--b') } }])).toEqual([
      'a → b across: v>v_in',
    ])
  })

  it('leaves an edge alone that couples already, was edited by hand, or does not touch the saved nodes', () => {
    const nodes = [node(io('a')), node(io('b')), node(io('c'))]
    const coupled = linkCouplings(io('a'), io('b'), 'across')
    const edges = [
      edge('a', 'b', { couplings: coupled, placement: 'across' }),
      edge('b', 'c', { couplings: [], placement: false }),
      edge('a', 'c', { couplings: [], placement: 'across' }),
    ]
    expect(fillPlacementCouplings({ nodes, edges, nodeIds: ['b'] }).size).toBe(0)
  })

  it('leaves edges between two annotated nodes to the annotation matcher', () => {
    const nodes = [node(io('a')), node(io('b'))]
    const edges = [edge('a', 'b', { couplings: [], placement: 'across' })]
    expect(fillPlacementCouplings({ nodes, edges, nodeIds: ['b'], isAnnotated: () => true }).size).toBe(0)
  })

  it('never couples a single-connection outlet twice across the edges it fills', () => {
    const nodes = [node(io('a')), node(io('b')), node(io('c'))]
    const edges = [
      edge('a', 'b', { couplings: [], placement: 'across' }),
      edge('a', 'c', { couplings: [], placement: 'across' }),
    ]
    const filled = fillPlacementCouplings({ nodes, edges, nodeIds: ['a'] })
    expect([...filled.keys()]).toEqual(['a--b'])
  })

  it('couples nothing while the module still has no ports', () => {
    const nodes = [node(io('a')), node(bare('b'))]
    const edges = [edge('a', 'b', { couplings: [], placement: 'across' })]
    expect(fillPlacementCouplings({ nodes, edges, nodeIds: ['b'] }).size).toBe(0)
  })
})
