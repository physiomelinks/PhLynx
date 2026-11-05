import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

import { GO } from '../../../../src/services/annotations/iris.js'
import { parseSidecar } from '../../../../src/services/annotations/sidecar.js'
import { glyphFor } from '../../../../src/services/bioView/glyphs.js'
import { goLocationsOf, resolveBioRole } from '../../../../src/services/bioView/roles.js'

const TOY = resolve(__dirname, '../../fixtures/annotations/toy')
const readToy = (name) => readFileSync(resolve(TOY, name), 'utf8')
const toySidecar = (name) => parseSidecar(readToy(`${name}.ttl`), { mathRef: `${name}.cellml:${name}`, cellml: readToy(`${name}.cellml`) })

describe('physiological roles', () => {
  it('takes a role the location source worked out over the sidecar’s, and the user’s over both', async () => {
    const sidecar = await toySidecar('porter')
    const worked = { role: 'membraneProtein', facet: 'basolateral', cell: 'c1' }
    expect(resolveBioRole({ name: 'p' }, { sidecar, worked })).toMatchObject({
      role: 'membraneProtein',
      facet: 'basolateral',
      cell: 'c1',
      annotatedFacet: 'basolateral',
      source: 'location',
    })
    expect(resolveBioRole({ bioView: { role: 'region' } }, { sidecar, worked })).toMatchObject({ role: 'region', source: 'override' })
    expect(resolveBioRole({}, { sidecar, worked: null }).source).toBe('sidecar')
  })

  it('reads the role from the module’s sidecar', async () => {
    const roleOf = async (name) => resolveBioRole({ name }, { sidecar: await toySidecar(name) })
    expect(await roleOf('porter')).toMatchObject({ role: 'membraneProtein', facet: null, cell: null, glyph: 'symporter', source: 'sidecar' })
    expect(await roleOf('wall')).toMatchObject({ role: 'membrane', source: 'sidecar' })
    expect(await roleOf('pool')).toMatchObject({ role: 'region', side: null, source: 'sidecar' })
  })

  it('reads where an unkinded module’s variables are', () => {
    const sidecar = (...locations) => ({ component: { kind: null, isVersionOf: [] }, variables: locations.map((location) => ({ location })) })
    expect(resolveBioRole({}, { sidecar: sidecar(GO.cytoplasm, GO.extracellularRegion) }).role).toBe('membraneProtein')
    expect(resolveBioRole({}, { sidecar: sidecar(GO.cytoplasm, `self+${GO.cytoplasm}`) }).role).toBe('cytosolic')
    expect(resolveBioRole({}, { sidecar: sidecar('self') }).role).toBe('none')
    expect(goLocationsOf(sidecar('self', `self+${GO.plasmaMembrane}`, GO.cytoplasm))).toEqual(new Set([GO.plasmaMembrane, GO.cytoplasm]))
  })

  it('lets the user’s choices win', async () => {
    const data = { name: 'porter', bioView: { facet: 'lateral', glyph: 'pump', cell: 'other' } }
    expect(resolveBioRole(data, { sidecar: await toySidecar('porter') })).toMatchObject({
      role: 'membraneProtein',
      facet: 'lateral',
      glyph: 'pump',
      cell: 'other',
      source: 'sidecar',
    })
    // Taken out of the membrane, it has no facet.
    const unplaced = { ...data, bioView: { facet: null } }
    expect(resolveBioRole(unplaced, { sidecar: await toySidecar('porter') })).toMatchObject({ facet: null, annotatedFacet: null })
    expect(resolveBioRole({ bioView: { role: 'region' } }).source).toBe('override')
    // Choices that don't fit are ignored.
    expect(resolveBioRole({ bioView: { role: 'mitochondrion', facet: 'top', glyph: 'blob' } })).toMatchObject({ role: 'none', facet: null, glyph: null })
  })

  it('keeps a lateral protein’s side and a region’s adjacency, dropping what doesn’t fit', () => {
    const lateral = { bioView: { role: 'membraneProtein', facet: 'lateral', at: 'right' } }
    expect(resolveBioRole(lateral)).toMatchObject({ facet: 'lateral', at: 'right' })
    expect(resolveBioRole({ bioView: { role: 'membraneProtein', facet: 'apical', at: 'right' } }).at).toBeNull()
    const region = {
      bioView: {
        role: 'region',
        adjacent: [{ cell: 'c', facet: 'lateral', at: 'up' }, { cell: 'c', facet: 'roof' }, { facet: 'apical' }, { cell: 'd', facet: 'apical', at: 'left' }],
      },
    }
    expect(resolveBioRole(region).adjacent).toEqual([
      { cell: 'c', facet: 'lateral', at: 'left' },
      { cell: 'd', facet: 'apical' },
    ])
    expect(resolveBioRole({ bioView: { role: 'region', adjacent: [] } }).adjacent).toBeNull()
    expect(resolveBioRole({ bioView: { role: 'cytosol', adjacent: [{ cell: 'c', facet: 'apical' }] } }).adjacent).toBeNull()
  })

  it('is nothing physiological without annotations', () => {
    expect(resolveBioRole({ name: 'plain' })).toEqual({
      role: 'none',
      facet: null,
      at: null,
      annotatedFacet: null,
      cell: null,
      side: null,
      adjacent: null,
      glyph: null,
      source: 'none',
    })
  })

  it('draws each annotated protein function as its cartoon, and others as generic', () => {
    expect(glyphFor([GO.glucoseSodiumSymporter])).toBe('symporter')
    expect(glyphFor([GO.glucoseTransporter])).toBe('uniporter')
    expect(glyphFor([GO.sodiumPotassiumAtpase])).toBe('pump')
    expect(glyphFor([GO.inwardRectifierPotassiumChannel])).toBe('channel')
    expect(glyphFor(['GO:0000000'])).toBe('generic')
    expect(glyphFor([GO.glucoseTransporter], 'antiporter')).toBe('antiporter')
  })
})
