import { describe, expect, it } from 'vitest'

import { ownedNeighbours } from '../../../../src/services/bioView/drop.js'
import { layoutBioView } from '../../../../src/services/bioView/layout.js'
import { siteLinks } from '../../../../src/services/bioView/links.js'

const node = (id) => ({ id, data: { name: id } })
const role = (role, extra = {}) => ({ role, facet: null, cell: null, side: null, glyph: null, ...extra })

/** The roles of a node-owned cell with a membrane, two apical proteins, one basolateral, a process and a lumen. */
const ALL = {
  cell: role('cytosol'),
  wall: role('membrane', { cell: 'cell' }),
  p1: role('membraneProtein', { cell: 'cell', facet: 'apical' }),
  p2: role('membraneProtein', { cell: 'cell', facet: 'apical' }),
  q: role('membraneProtein', { cell: 'cell', facet: 'basolateral' }),
  work: role('cytosolic', { cell: 'cell' }),
  lumen: role('region', { adjacent: [{ cell: 'cell', facet: 'apical' }] }),
  other: role('membraneProtein'),
}

/** The layout with only some of ALL placed, as when they are dropped one by one. */
function layoutOf(ids) {
  return layoutBioView(ids.map(node), new Map(ids.map((id) => [id, ALL[id]])))
}

const pairs = (links) => links.map(({ from, to, kind }) => `${from}>${to}:${kind}`).sort()

describe('ownedNeighbours', () => {
  const layout = layoutOf(Object.keys(ALL))
  const of = (id, edges) => ownedNeighbours(layout, id, { edges })

  it('gives each role on a node-owned cell its neighbours, by how they lie to it', () => {
    expect(of('wall')).toEqual({
      role: 'membrane',
      neighbours: [
        { id: 'cell', relation: 'inside' },
        { id: 'p1', relation: 'protein' },
        { id: 'p2', relation: 'protein' },
        { id: 'q', relation: 'protein' },
      ],
    })
    expect(of('p1')).toEqual({
      role: 'membraneProtein',
      neighbours: [
        { id: 'cell', relation: 'inside' },
        { id: 'wall', relation: 'membrane' },
        { id: 'lumen', relation: 'outside' },
      ],
    })
    // Only the proteins on the part a compartment lies against.
    expect(of('q').neighbours.map(({ id }) => id)).toEqual(['cell', 'wall'])
    expect(of('cell').neighbours).toEqual([
      { id: 'wall', relation: 'membrane' },
      { id: 'p1', relation: 'protein' },
      { id: 'p2', relation: 'protein' },
      { id: 'q', relation: 'protein' },
      { id: 'work', relation: 'process' },
    ])
    expect(of('work').neighbours).toEqual([{ id: 'cell', relation: 'inside' }])
    expect(of('lumen').neighbours).toEqual([
      { id: 'p1', relation: 'protein' },
      { id: 'p2', relation: 'protein' },
    ])
  })

  it('leaves out pairs already joined either way, and nodes on no cell', () => {
    const edges = [
      { source: 'wall', target: 'p1' },
      { source: 'p2', target: 'wall' },
    ]
    expect(of('wall', edges).neighbours.map(({ id }) => id)).toEqual(['cell', 'q'])
    expect(of('other')).toEqual({ role: null, neighbours: [] })
    expect(of('missing')).toEqual({ role: null, neighbours: [] })
  })

  it("ignores a template's pieces", () => {
    const templated = new Map([
      ['cell', { kind: 'cell', instance: 'i', membrane: 'wall' }],
      ['wall', { kind: 'membrane', cell: 'cell', instance: 'i' }],
      ['p1', { kind: 'protein', cell: 'cell', part: 'apical', instance: 'i' }],
    ])
    expect(ownedNeighbours(templated, 'wall')).toEqual({ role: null, neighbours: [] })
    expect(ownedNeighbours(templated, 'p1')).toEqual({ role: null, neighbours: [] })
  })
})

describe('connecting a membrane and the proteins on its cell', () => {
  /** The links dropping the last of ids makes, with the others already there and joined as they came. */
  function linksAfter(ids) {
    const edges = []
    for (let n = 1; n <= ids.length; n++) {
      const id = ids[n - 1]
      const { role: dropped, neighbours } = ownedNeighbours(layoutOf(ids.slice(0, n)), id, { edges })
      for (const { from, to, kind } of siteLinks(id, dropped, neighbours)) edges.push({ source: from, target: to, kind })
    }
    return edges.map(({ source, target, kind }) => ({ from: source, to: target, kind }))
  }
  const membraneProteinPairs = (links) =>
    pairs(links.filter(({ from, to }) => [from, to].includes('wall') && [from, to].some((id) => id.startsWith('p'))))
      .map((pair) => pair.replace(/^(\w+)>(\w+)/, (_, a, b) => [a, b].sort().join('~')))

  it('connects the membrane to every protein already on the cell when it comes last', () => {
    const links = linksAfter(['cell', 'p1', 'p2', 'wall'])
    expect(pairs(links)).toEqual(
      pairs([
        { from: 'p1', to: 'cell', kind: 'across' },
        { from: 'p2', to: 'cell', kind: 'across' },
        { from: 'wall', to: 'cell', kind: 'exchange' },
        { from: 'wall', to: 'p1', kind: 'exchange' },
        { from: 'wall', to: 'p2', kind: 'exchange' },
      ])
    )
  })

  it('connects each protein to the membrane when the membrane comes first', () => {
    const links = linksAfter(['cell', 'wall', 'p1', 'p2'])
    expect(pairs(links)).toEqual(
      pairs([
        { from: 'wall', to: 'cell', kind: 'exchange' },
        { from: 'p1', to: 'cell', kind: 'across' },
        { from: 'p1', to: 'wall', kind: 'exchange' },
        { from: 'p2', to: 'cell', kind: 'across' },
        { from: 'p2', to: 'wall', kind: 'exchange' },
      ])
    )
  })

  it('joins the same membrane and protein pairs, by the same kind, in either order', () => {
    expect(membraneProteinPairs(linksAfter(['cell', 'p1', 'p2', 'wall']))).toEqual(
      membraneProteinPairs(linksAfter(['cell', 'wall', 'p1', 'p2']))
    )
  })

  it('runs across links outside → protein → inside with a compartment against the facet', () => {
    const links = linksAfter(['cell', 'lumen', 'p1'])
    expect(pairs(links)).toEqual(
      pairs([
        { from: 'lumen', to: 'p1', kind: 'across' },
        { from: 'p1', to: 'cell', kind: 'across' },
      ])
    )
  })
})
