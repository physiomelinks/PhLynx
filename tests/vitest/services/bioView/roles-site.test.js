import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

import { parseApiCoords } from '../../../../src/services/annotations/apicoord.js'
import { nodeDataForCopy, withAnnotationData } from '../../../../src/services/annotations/nodeData.js'
import { resolveBioRole } from '../../../../src/services/bioView/roles.js'

const TOY = resolve(__dirname, '../../fixtures/annotations/toy')

/** The toy model's annotations, with a node bound to each instance. */
async function toy() {
  const apiCoords = await parseApiCoords(readFileSync(resolve(TOY, 'toy-apicoords.ttl'), 'utf8'))
  const nodes = apiCoords.instances.map((instance) => ({
    id: `node-${instance.name}`,
    data: { name: instance.name, apiCoord: { subject: instance.subject, coordIri: instance.coordIri, name: instance.name } },
  }))
  return { apiCoords, nodes }
}

describe('physiological roles bound to a template site', () => {
  it('gives the site a node is bound to', () => {
    const data = { name: 'p', bioView: { role: 'membraneProtein', site: 'bt-x1/cell.apical', order: 0 } }
    expect(resolveBioRole(data)).toMatchObject({ role: 'membraneProtein', site: 'bt-x1/cell.apical' })
  })

  it('leaves site out when a node is bound to none', () => {
    expect(resolveBioRole({ name: 'p', bioView: { role: 'region' } })).not.toHaveProperty('site')
    for (const site of ['', 42, null, { instance: 'bt-x1' }]) {
      expect(resolveBioRole({ name: 'p', bioView: { role: 'region', site } })).not.toHaveProperty('site')
    }
  })

  it('has no annotated facet once bound, so a protein the template places is not shown as moved', async () => {
    const { apiCoords, nodes } = await toy()
    const porter = nodes.find((node) => node.data.name === 'porter_in')
    expect(resolveBioRole(porter.data, { apiCoords, nodes })).toMatchObject({ annotatedFacet: 'apical' })

    const bound = { ...porter.data, bioView: { role: 'membraneProtein', site: 'bt-x1/cell.basolateral' } }
    expect(resolveBioRole(bound, { apiCoords, nodes })).toMatchObject({
      role: 'membraneProtein',
      facet: 'apical',
      annotatedFacet: null,
      site: 'bt-x1/cell.basolateral',
    })
  })

  it('keeps the site when a node is rebuilt, and drops it from a pasted copy', () => {
    const bioView = { role: 'membraneProtein', glyph: 'pump', site: 'bt-x1/cell.apical', order: 1 }
    expect(withAnnotationData({}, { name: 'p', bioView }).bioView).toEqual(bioView)
    expect(nodeDataForCopy({ name: 'p', bioView }).bioView).toEqual({ role: 'membraneProtein', glyph: 'pump' })
  })
})
