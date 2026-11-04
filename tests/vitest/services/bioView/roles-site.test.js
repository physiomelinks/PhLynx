import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

import { parseSidecar } from '../../../../src/services/annotations/sidecar.js'
import { nodeDataForCopy, withAnnotationData } from '../../../../src/services/annotations/nodeData.js'
import { resolveBioRole } from '../../../../src/services/bioView/roles.js'

const TOY = resolve(__dirname, '../../fixtures/annotations/toy')
const readToy = (name) => readFileSync(resolve(TOY, name), 'utf8')
const toySidecar = (name) => parseSidecar(readToy(`${name}.ttl`), { mathRef: `${name}.cellml:${name}`, cellml: readToy(`${name}.cellml`) })

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

  it('keeps the sidecar’s role once bound, with no annotated facet, as the template places it', async () => {
    const sidecar = await toySidecar('porter')
    expect(resolveBioRole({ name: 'porter' }, { sidecar })).toMatchObject({ role: 'membraneProtein', annotatedFacet: null })

    const bound = { name: 'porter', bioView: { site: 'bt-x1/cell.basolateral' } }
    expect(resolveBioRole(bound, { sidecar })).toMatchObject({
      role: 'membraneProtein',
      source: 'sidecar',
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
