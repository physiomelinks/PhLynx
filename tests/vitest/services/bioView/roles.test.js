import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

import { parseApiCoords } from '../../../../src/services/annotations/apicoord.js'
import { GO } from '../../../../src/services/annotations/iris.js'
import { parseSidecar } from '../../../../src/services/annotations/sidecar.js'
import { glyphFor } from '../../../../src/services/bioView/glyphs.js'
import { cellNodeIdFor, goLocationsOf, resolveBioRole } from '../../../../src/services/bioView/roles.js'

const TOY = resolve(__dirname, '../../fixtures/annotations/toy')
const readToy = (name) => readFileSync(resolve(TOY, name), 'utf8')
const toySidecar = (name) => parseSidecar(readToy(`${name}.ttl`), { mathRef: `${name}.cellml:${name}`, cellml: readToy(`${name}.cellml`) })

/** A node per ApiCoord instance, bound to it as Apply binds one. */
const nodesFor = (apiCoords) =>
  apiCoords.instances.map((instance) => ({
    id: `node-${instance.name}`,
    data: { name: instance.name, apiCoord: { subject: instance.subject, coordIri: instance.coordIri, name: instance.name } },
  }))

describe('physiological roles', () => {
  it('reads each kind of ApiCoord', async () => {
    const apiCoords = await parseApiCoords(readToy('toy-apicoords.ttl'))
    const nodes = nodesFor(apiCoords)
    const porter = await toySidecar('porter')
    const roleOf = (name, sidecar = null) => resolveBioRole(nodes.find((n) => n.data.name === name).data, { apiCoords, sidecar, nodes })

    expect(roleOf('porter_in', porter)).toEqual({
      role: 'membraneProtein',
      facet: 'apical',
      cell: 'node-cell',
      side: null,
      glyph: 'symporter',
      source: 'apiCoord',
    })
    expect(roleOf('porter_out', porter)).toMatchObject({ role: 'membraneProtein', facet: 'basolateral', cell: 'node-cell' })
    expect(roleOf('wall')).toMatchObject({ role: 'membrane', cell: 'node-cell', facet: null, glyph: null })
    expect(roleOf('cell')).toMatchObject({ role: 'cytosol', cell: null })
    expect(roleOf('outside')).toMatchObject({ role: 'region', side: 'apical' })
    // The one lyph with api:coalescedWith is what the basolateral facet faces.
    expect(roleOf('vessel')).toMatchObject({ role: 'region', side: 'basolateral' })
  })

  it('falls back to the module’s sidecar when the instance has no ApiCoord', async () => {
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
    const apiCoords = await parseApiCoords(readToy('toy-apicoords.ttl'))
    const nodes = nodesFor(apiCoords)
    const data = { ...nodes.find((n) => n.data.name === 'porter_in').data, bioView: { facet: 'lateral', glyph: 'pump', cell: 'other' } }
    expect(resolveBioRole(data, { apiCoords, sidecar: await toySidecar('porter'), nodes })).toMatchObject({
      role: 'membraneProtein',
      facet: 'lateral',
      glyph: 'pump',
      cell: 'other',
      source: 'apiCoord',
    })
    expect(resolveBioRole({ bioView: { role: 'region' } }).source).toBe('override')
    // Choices that don't fit are ignored.
    expect(resolveBioRole({ bioView: { role: 'mitochondrion', facet: 'top', glyph: 'blob' } })).toMatchObject({ role: 'none', facet: null, glyph: null })
  })

  it('is nothing physiological without annotations', () => {
    expect(resolveBioRole({ name: 'plain' })).toEqual({ role: 'none', facet: null, cell: null, side: null, glyph: null, source: 'none' })
  })

  it('finds the node bound to an ApiCoord', () => {
    const nodes = [{ id: 'a', data: { apiCoord: { coordIri: 'x' } } }, { id: 'b', data: {} }]
    expect(cellNodeIdFor('x', nodes)).toBe('a')
    expect(cellNodeIdFor('y', nodes)).toBeNull()
    expect(cellNodeIdFor(null, nodes)).toBeNull()
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

// Unpublished fixtures, gitignored: the test runs only where they are present, and reads what to expect
// from private/expected.json, so nothing of the model is written here.
const PRIVATE = resolve(__dirname, '../../fixtures/annotations/private')
const EXPECTED = resolve(PRIVATE, 'expected.json')
const readPrivate = (...path) => readFileSync(resolve(PRIVATE, ...path), 'utf8')

describe.skipIf(!existsSync(EXPECTED))('physiological roles of the private fixtures', () => {
  it('gives every instance a role from its ApiCoord, and every protein a cartoon and a cell', async () => {
    const expected = JSON.parse(readPrivate('expected.json'))
    const apiCoords = await parseApiCoords(readPrivate('apicoords.ttl'))
    const nodes = nodesFor(apiCoords)
    const ROLE_OF_KIND = { deployment: 'membraneProtein', 'facet-layer': 'membrane', cell: 'cytosol', layer: 'region', lyph: 'region' }

    for (const instance of expected.instances) {
      const component = instance.mathRef.split(':')[1]
      const sidecarFile = resolve(PRIVATE, 'sidecars', `${component}.ttl`)
      const sidecar = existsSync(sidecarFile)
        ? await parseSidecar(readPrivate('sidecars', `${component}.ttl`), { mathRef: `${component}.cellml:${component}`, cellml: readPrivate('maths', `${component}.cellml`) })
        : null
      const role = resolveBioRole(nodes.find((n) => n.data.name === instance.name).data, { apiCoords, sidecar, nodes })
      expect(role.role, instance.name).toBe(ROLE_OF_KIND[instance.kind])
      expect(role.source, instance.name).toBe('apiCoord')
      if (role.role === 'membraneProtein') {
        expect(role.glyph, instance.name).not.toBe('generic')
        expect(role.facet, instance.name).toBeTruthy()
        expect(role.cell, instance.name).toBeTruthy()
      }
    }
    // One region faces the basolateral facets.
    const sides = expected.instances.map((i) => resolveBioRole(nodes.find((n) => n.data.name === i.name).data, { apiCoords, nodes }).side)
    expect(sides.filter((side) => side === 'basolateral')).toHaveLength(1)
  })
})
