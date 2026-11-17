import { describe, expect, it } from 'vitest'

import { GO } from '../../../../src/services/annotations/iris.js'
import { dragCompanions, dropSites, nearestSite } from '../../../../src/services/bioView/drop.js'
import { JOINT, TUBE, layoutPhysiology, linkGeometry } from '../../../../src/services/bioView/layout.js'
import { siteLinks } from '../../../../src/services/bioView/links.js'
import { linkEndsAt } from '../../../../src/services/bioView/palette.js'
import { placementsOf } from '../../../../src/services/bioView/placement.js'
import {
  TEMPLATE_SCHEMA_VERSION_PLACED,
  addToEdits,
  editedTemplate,
  placeInEdits,
  removeFromEdits,
  siteNeighbours,
  sitesOf,
  validateTemplate,
} from '../../../../src/services/bioView/templates.js'

const facet = (id, edge) => ({ id, label: `${id} membrane`, edge })
const cell = (id, extra = {}) => ({ id, label: `Cell ${id}`, facets: [facet('top', 'top'), facet('right', 'right')], ...extra })
const tube = (id, x, extra = {}) => ({ id, label: `Segment ${id}`, shape: 'tube', at: { x, y: 0 }, ...extra })

/** Two stretches of vessel, the first flowing into the second. */
const VESSEL = {
  schemaVersion: 3,
  id: 'vessel',
  name: 'Vessel',
  compartments: [tube('a', 0), tube('b', 600)],
  links: [{ id: 'ab', label: 'Resistance', between: ['a', 'b'] }],
}

/** Two cells, each placed freely, joined by gap junctions. */
const SYNCYTIUM = {
  schemaVersion: 3,
  id: 'syncytium',
  name: 'Syncytium',
  cells: [cell('a', { at: { x: 0, y: 0 } }), cell('b', { at: { x: 700, y: 0 } })],
  compartments: [{ id: 'ecs', label: 'ECS', against: ['a.top'] }],
  links: [{ id: 'gap', label: 'Gap junction', between: ['a', 'b'], kind: 'junction' }],
}

const valid = (raw) => {
  const { template, errors } = validateTemplate(raw)
  expect(errors).toEqual([])
  return template
}
const errorsOf = (raw) => validateTemplate(raw).errors

describe('templates placed freely and linked', () => {
  it('reads a template of tubes alone, with a link between them, at version 3', () => {
    const template = valid(VESSEL)
    expect(template.schemaVersion).toBe(TEMPLATE_SCHEMA_VERSION_PLACED)
    expect(template.cells).toEqual([])
    expect(template.compartments[0]).toMatchObject({ shape: 'tube', at: { x: 0, y: 0 } })
    expect(template.links).toEqual([{ id: 'ab', label: 'Resistance', between: ['a', 'b'], kind: 'flow' }])
  })

  it('reads cells with places of their own', () => {
    const template = valid(SYNCYTIUM)
    expect(template.cells[0].at).toEqual({ x: 0, y: 0 })
    expect(template.cells[0].row).toBeUndefined()
  })

  it('leaves links out of a template without them', () => {
    expect(valid({ schemaVersion: 1, id: 'plain', name: 'Plain', cells: [cell('a')] }).links).toBeUndefined()
  })

  it.each([
    [{ ...VESSEL, schemaVersion: 2 }, 'needs "schemaVersion" 3'],
    [{ ...VESSEL, links: [{ id: 'ab', label: 'L', between: ['a', 'nowhere'] }] }, 'there is no cell or compartment "nowhere"'],
    [{ ...VESSEL, links: [{ id: 'ab', label: 'L', between: ['a', 'a'] }] }, '"between" must name two different spaces'],
    [{ ...VESSEL, links: [{ id: 'ab', label: 'L', between: ['a', 'b'], kind: 'pipe' }] }, '"kind" must be one of flow, junction, diffusion'],
    [{ ...VESSEL, links: [...VESSEL.links, { id: 'ba', label: 'Back', between: ['b', 'a'] }] }, 'are already linked'],
    [{ ...VESSEL, links: [{ id: 'a', label: 'L', between: ['a', 'b'] }] }, 'used by more than one cell, compartment or link'],
    [{ ...VESSEL, compartments: [tube('a', 0, { shape: 'pipe' }), tube('b', 600)] }, '"shape" must be one of tube'],
    [{ ...SYNCYTIUM, cells: [cell('a', { at: { x: 0, y: 0 }, row: 1 }), SYNCYTIUM.cells[1]] }, 'not both'],
    [{ ...SYNCYTIUM, compartments: [{ id: 'gap-space', label: 'Gap', against: ['a.right', 'b.top'] }] }, 'shares no compartment with another cell'],
    [{ ...SYNCYTIUM, compartments: [{ id: 'ecs', label: 'ECS', against: ['a.top'], at: { x: 0, y: 0 } }] }, 'only a compartment that lies against nothing'],
  ])('rejects %#', (raw, text) => {
    const errors = errorsOf(raw)
    expect(errors.join('\n')).toContain(text)
  })

  it('offers each link as a site for one module, between its two spaces', () => {
    const template = valid(VESSEL)
    expect(sitesOf(template).at(-1)).toEqual({ path: 'ab', role: 'cytosolic', kind: 'single', link: 'ab', label: 'Resistance' })
    expect(siteNeighbours(template, 'ab')).toEqual([
      { path: 'a', relation: 'upstream' },
      { path: 'b', relation: 'downstream' },
    ])
    expect(siteNeighbours(template, 'a')).toEqual([{ path: 'ab', relation: 'downstream' }])
  })

  it('runs a flow from the first space, through the link, to the second', () => {
    expect(siteLinks('r', 'cytosolic', [{ id: 'up', relation: 'upstream' }, { id: 'down', relation: 'downstream' }])).toEqual([
      { from: 'up', to: 'r', kind: 'flow' },
      { from: 'r', to: 'down', kind: 'flow' },
    ])
    // Dropped on the first space, it runs into the link.
    expect(siteLinks('up', 'region', [{ id: 'r', relation: 'downstream' }])).toEqual([{ from: 'up', to: 'r', kind: 'flow' }])
  })
})

describe('changing a placed template', () => {
  const vessel = valid(VESSEL)
  const syncytium = valid(SYNCYTIUM)

  it('adds a link, and takes it away with either space it joins', () => {
    const added = addToEdits(vessel, null, 'compartments', tube('c', 1200))
    const linked = addToEdits(vessel, added.edits, 'links', { id: 'bc', label: 'Second', between: ['b', 'c'] })
    expect(editedTemplate(vessel, linked.edits).template.links.map((link) => link.id)).toEqual(['ab', 'bc'])
    const without = removeFromEdits(vessel, linked.edits, 'c')
    expect(editedTemplate(vessel, without.edits).template.links.map((link) => link.id)).toEqual(['ab'])
    const ownGone = removeFromEdits(vessel, linked.edits, 'a')
    expect(editedTemplate(vessel, ownGone.edits).template.links.map((link) => link.id)).toEqual(['bc'])
  })

  it('removes a link by its own path', () => {
    const { edits } = removeFromEdits(vessel, null, 'ab')
    expect(editedTemplate(vessel, edits).template.links).toBeUndefined()
  })

  it('gives a piece a place of its own, and takes it back into its row', () => {
    const plain = valid({ schemaVersion: 1, id: 'two', name: 'Two', cells: [cell('a'), cell('b')] })
    const placed = placeInEdits(plain, null, 'b', { x: 40.4, y: 500 })
    expect(placed.edits.places).toEqual({ b: { x: 40, y: 500 } })
    expect(editedTemplate(plain, placed.edits).template.cells[1]).toMatchObject({ at: { x: 40, y: 500 } })
    const back = placeInEdits(plain, placed.edits, 'b', null)
    expect(back.edits).toBeNull()
    // One the template places itself goes back into a row.
    const moved = placeInEdits(syncytium, null, 'b', null)
    expect(editedTemplate(syncytium, moved.edits).template.cells[1]).toMatchObject({ row: 0 })
  })

  it('will not place freely a cell that shares a compartment with another', () => {
    const pair = valid({
      schemaVersion: 1,
      id: 'pair',
      name: 'Pair',
      cells: [cell('a'), cell('b', { facets: [facet('left', 'left')] })],
      compartments: [{ id: 'cleft', label: 'Cleft', against: ['a.right', 'b.left'] }],
    })
    const { edits, errors } = placeInEdits(pair, null, 'b', { x: 0, y: 400 })
    expect(edits).toBeNull()
    expect(errors.join()).toContain('shares no compartment')
  })
})

describe('laying out pieces placed freely and links', () => {
  /** The vessel, but its tubes only diffuse into each other, which joins nothing. */
  const APART = { ...VESSEL, id: 'apart', links: [{ id: 'ab', label: 'Leak', between: ['a', 'b'], kind: 'diffusion' }] }
  /** Three tubes in a row, the first branching into the second and the third. */
  const BRANCH = {
    ...VESSEL,
    id: 'branch',
    compartments: [tube('a', 0), tube('b', 600), tube('c', 0, { at: { x: 0, y: 400 } })],
    links: [
      { id: 'ab', label: 'One', between: ['a', 'b'] },
      { id: 'ac', label: 'Two', between: ['a', 'c'] },
    ],
  }
  const definitions = new Map([VESSEL, SYNCYTIUM, APART, BRANCH].map((raw) => [raw.id, valid(raw)]))
  const lay = (template, nodes = [], at = { x: 100, y: 50 }) =>
    layoutPhysiology(nodes, new Map(), { instances: [{ id: 'bt-1', template, at }], definitions }).places

  it('puts a tube where it says, at a tube’s size, and one it flows into on from its end, past the joint', () => {
    const places = lay('vessel')
    expect(places.get('tpl:bt-1/a')).toMatchObject({ kind: 'region', shape: 'tube', rect: { x: 100, y: 50, ...TUBE } })
    expect(places.get('tpl:bt-1/b').rect).toMatchObject({ x: 100 + TUBE.width + JOINT.width, y: 50 })
    expect(places.get('tpl:bt-1/ab')).toMatchObject({
      kind: 'link',
      joint: 'flow',
      zone: { x: 100 + TUBE.width, y: 50, width: JOINT.width, height: TUBE.height },
    })
  })

  it('draws the module on a joint in the joint', () => {
    const places = lay('vessel', [{ id: 'r', data: { name: 'r', bioView: { site: 'bt-1/ab' } } }])
    expect(places.get('tpl:bt-1/ab').empty).toBe(false)
    expect(places.get('r')).toMatchObject({ kind: 'card', joint: 'flow', instance: 'bt-1', link: 'tpl:bt-1/ab' })
  })

  it('joins one flow out of a tube, and draws a second as a line', () => {
    const places = lay('branch')
    expect(places.get('tpl:bt-1/ab').joint).toBe('flow')
    expect(places.get('tpl:bt-1/ac').joint).toBeUndefined()
    expect(places.get('tpl:bt-1/ac').line).toBeDefined()
    expect(places.get('tpl:bt-1/c').rect).toMatchObject({ x: 100, y: 450 })
  })

  it('draws a link that joins nothing as a line from the edge of one space to the other', () => {
    const places = lay('apart')
    expect(places.get('tpl:bt-1/b').rect).toMatchObject({ x: 700, y: 50 })
    expect(places.get('tpl:bt-1/ab')).toMatchObject({ kind: 'link', flow: 'diffusion', line: { from: { x: 460, y: 110 }, to: { x: 700, y: 110 } } })
  })

  it('puts a cell joined by a junction against the right side of the other, and drags them as one', () => {
    const places = lay('syncytium')
    const [a, b] = ['a', 'b'].map((path) => places.get(`tpl:bt-1/${path}`))
    expect(a.rect).toMatchObject({ x: 100, y: 50 })
    expect(b.rect.x - (a.rect.x + a.rect.width)).toBeGreaterThan(0)
    expect(b.rect.x - (a.rect.x + a.rect.width)).toBeLessThan(20)
    expect(b.rect.y).toBe(a.rect.y)
    const joint = places.get('tpl:bt-1/gap')
    expect(joint.joint).toBe('junction')
    expect(joint.zone.x).toBeLessThan(b.rect.x)
    expect(joint.zone.x + joint.zone.width).toBeGreaterThan(a.rect.x + a.rect.width)
    // Their facing sides keep no names, where they touch.
    expect(a.facetLabels.map((label) => label.edge)).not.toContain('right')
    expect(a.block).toBe('tpl:bt-1/a')
    expect(b.block).toBe('tpl:bt-1/a')
    expect(places.get('tpl:bt-1/ecs').block).toBe('tpl:bt-1/a')
    expect(dragCompanions(places, { id: 'tpl:bt-1/b', type: 'bioCell' }).sort()).toEqual(['tpl:bt-1/a', 'tpl:bt-1/ecs'])
  })

  it('takes a drop on a junction’s channel into the junction, not onto the membranes it crosses', () => {
    const { places, sites } = layoutPhysiology([], new Map(), { instances: [{ id: 'bt-1', template: 'syncytium', at: { x: 100, y: 50 } }], definitions })
    const { zone } = places.get('tpl:bt-1/gap')
    const found = nearestSite(dropSites(sites), { x: zone.x + zone.width / 2, y: zone.y + zone.height / 2 })
    expect(found.ref).toBe('bt-1/gap')
  })

  it('runs a link between spaces well apart straight from edge to edge, with its module midway', () => {
    const { line, zone } = linkGeometry({ x: 0, y: 0, width: 100, height: 100 }, { x: 400, y: 0, width: 100, height: 100 })
    expect(line).toEqual({ from: { x: 100, y: 50 }, to: { x: 400, y: 50 } })
    expect(zone.x + zone.width / 2).toBe(250)
  })

  it('takes a link between overlapping spaces round through its module, clear of both', () => {
    const a = { x: 0, y: 0, width: 100, height: 100 }
    const b = { x: 50, y: 0, width: 100, height: 100 }
    const { line, zone } = linkGeometry(a, b)
    expect(line.via).toEqual({ x: zone.x + zone.width / 2, y: zone.y + zone.height / 2 })
    expect(zone.y + zone.height <= 0 || zone.y >= 100).toBe(true)
  })

  it('finds the two spaces of one template a link is dropped between', () => {
    const places = lay('apart')
    expect(linkEndsAt(places, { x: 580, y: 110 })).toEqual({ instance: 'bt-1', between: ['a', 'b'] })
    expect(linkEndsAt(places, { x: 5000, y: 5000 }, 200)).toBeNull()
  })
})

describe('where a module on a link is', () => {
  it('has the link between its two spaces: a compartment as extracellular, a cell as cytoplasm', () => {
    const template = valid({ ...SYNCYTIUM, links: [{ id: 'leak', label: 'Leak', between: ['ecs', 'a'], kind: 'diffusion' }] })
    const options = { instances: [{ id: 'bt-1', template: 'syncytium', at: { x: 0, y: 0 } }], definitions: new Map([['syncytium', template]]) }
    const places = placementsOf([{ id: 'm', data: { name: 'm', bioView: { site: 'bt-1/leak' } } }], options).get('m')
    expect(places.map(({ key, kind, as }) => ({ key, kind, as }))).toEqual([
      { key: 'site:bt-1/leak', kind: 'cytosolic', as: [] },
      { key: 'site:bt-1/ecs', kind: 'region', as: [GO.extracellularRegion] },
      { key: 'site:bt-1/a', kind: 'cytosol', as: [GO.cytoplasm] },
    ])
  })
})
