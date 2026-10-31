import { describe, expect, it } from 'vitest'

import { bioFlowNodes, templateTitleNodes } from '../../../src/composables/useBioNodes.js'
import { BUILT_IN_TEMPLATES } from '../../../src/services/bioView/builtInTemplates.js'
import { layoutPhysiology } from '../../../src/services/bioView/layout.js'

const definitions = new Map(BUILT_IN_TEMPLATES.map((template) => [template.id, template]))
const instances = [{ id: 'bt-1', template: 'epithelial-cell', at: { x: 100, y: 50 } }]
const node = (id, bioView) => ({ id, data: { name: id, ...(bioView && { bioView }) } })

/** The physiological view's nodes for the epithelial template and these diagram nodes. */
function draw(nodes = []) {
  const roles = new Map(nodes.map((n) => [n.id, { role: n.data.bioView?.role ?? 'none', site: n.data.bioView?.site }]))
  const { places } = layoutPhysiology(nodes, roles, { instances, definitions })
  return { places, bio: bioFlowNodes(nodes, roles, places) }
}

describe('physiological view nodes for a template', () => {
  it('draws each empty piece as a node of its own, keyed by its place, that can be dragged but not selected', () => {
    const { places, bio } = draw()
    const cell = bio.find((n) => n.id === 'tpl:bt-1/cell')
    const rect = places.get('tpl:bt-1/cell').rect
    expect(cell).toMatchObject({
      type: 'bioCell',
      selectable: false,
      draggable: true,
      zIndex: -10,
      position: { x: rect.x, y: rect.y },
      data: { name: 'Epithelial cell', empty: true, instance: 'bt-1', site: 'bt-1/cell' },
    })
    expect(cell.data.facetLabels.map((label) => label.edge)).toEqual(['top', 'bottom', 'left', 'right'])
    // Process zones are drawn relative to the cell.
    const zone = places.get('tpl:bt-1/cell').zones[0]
    expect(cell.data.zones[0]).toMatchObject({ label: 'Metabolism', rect: { x: zone.rect.x - rect.x, y: zone.rect.y - rect.y } })
    const lumen = bio.find((n) => n.id === 'tpl:bt-1/apical-fluid')
    expect(lumen).toMatchObject({ type: 'bioRegion', zIndex: -20, selectable: false, data: { empty: true, tone: 'sky', edge: 'top' } })
    expect(bio.filter((n) => n.id.startsWith('tpl:'))).toHaveLength(4)
  })

  it('switches a piece to its node’s id once a module binds to it, and its children follow', () => {
    const p = node('p', { role: 'membraneProtein', site: 'bt-1/cell.apical' })
    const before = draw([p]).bio
    expect(before.find((n) => n.id === 'p').parentNode).toBe('tpl:bt-1/cell')

    const { bio } = draw([node('cyto', { role: 'cytosol', site: 'bt-1/cell' }), p])
    expect(bio.some((n) => n.id === 'tpl:bt-1/cell')).toBe(false)
    expect(bio.find((n) => n.id === 'cyto')).toMatchObject({ type: 'bioCell', data: { name: 'cyto', instance: 'bt-1' } })
    expect(bio.find((n) => n.id === 'cyto').selectable).toBeUndefined()
    expect(bio.find((n) => n.id === 'cyto').data.empty).toBeUndefined()
    expect(bio.find((n) => n.id === 'p').parentNode).toBe('cyto')
    expect(bio.findIndex((n) => n.id === 'cyto')).toBeLessThan(bio.findIndex((n) => n.id === 'p'))
  })

  it('names each template above its pieces, by its own label once it has one', () => {
    const { places } = draw()
    const [title] = templateTitleNodes(instances, definitions, places)
    const lumen = places.get('tpl:bt-1/apical-fluid').rect
    expect(title).toMatchObject({ id: 'tpl:bt-1', type: 'bioTemplateTitle', selectable: false, draggable: false })
    expect(title.data).toEqual({ name: 'Epithelial cell', instance: 'bt-1', renamed: false })
    expect(title.position.y).toBeLessThan(lumen.y)
    const renamed = templateTitleNodes([{ ...instances[0], label: 'Kidney tubule' }], definitions, places)
    expect(renamed[0].data).toMatchObject({ name: 'Kidney tubule', renamed: true })
  })
})
