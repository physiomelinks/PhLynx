import { describe, expect, it } from 'vitest'

import { CARD, layoutPhysiology } from '../../../../src/services/bioView/layout.js'

const node = (id, bioView) => ({ id, data: { name: id, ...(bioView && { bioView }) } })
const roles = (entries) => new Map(Object.entries(entries).map(([id, role]) => [id, { role }]))

describe('physiological view layout of modules on no piece', () => {
  const nodes = [node('cell'), node('pump'), node('channel'), node('lumen'), node('plain')]
  // A stored role, or one a module would have on a piece, never draws it as anything but a protein or a card.
  const byAnnotations = roles({ cell: 'cytosol', pump: 'membraneProtein', channel: 'membraneProtein', lumen: 'region' })

  it('puts proteins in a tray on the left and everything else as cards on the right', () => {
    const layout = layoutPhysiology(nodes, byAnnotations).places
    expect(layout.get('channel')).toMatchObject({ kind: 'tray' })
    expect(layout.get('pump')).toMatchObject({ kind: 'tray' })
    for (const id of ['cell', 'lumen', 'plain']) expect(layout.get(id).kind).toBe('card')
    expect(layout.get('pump').x).toBeLessThan(layout.get('cell').x)
  })

  it('goes beside what else is drawn', () => {
    const around = [{ x: 1000, y: 500, width: 400, height: 300 }]
    const layout = layoutPhysiology(nodes, byAnnotations, { around }).places
    expect(layout.get('pump').x).toBeLessThan(1000)
    expect(layout.get('plain').x).toBeGreaterThan(1400)
    expect(layout.get('plain').y).toBeGreaterThanOrEqual(500)
  })

  it('keeps where the user put one, and leaves out those laid out elsewhere', () => {
    const moved = [...nodes.slice(0, 4), node('plain', { position: { x: 7, y: 8 } })]
    const layout = layoutPhysiology(moved, byAnnotations, { placedElsewhere: new Set(['cell']) }).places
    expect(layout.get('plain')).toEqual({ kind: 'card', x: 7, y: 8 })
    expect(layout.has('cell')).toBe(false)
  })

  it('lays out the same way every time, whatever order the nodes come in', () => {
    expect(layoutPhysiology([...nodes].reverse(), byAnnotations)).toEqual(layoutPhysiology(nodes, byAnnotations))
  })

  it('stacks cards without overlap', () => {
    const layout = layoutPhysiology([node('a'), node('b')], new Map()).places
    expect(layout.get('b').y - layout.get('a').y).toBeGreaterThanOrEqual(CARD.height)
  })
})
