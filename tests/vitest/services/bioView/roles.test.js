import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

import { GO } from '../../../../src/services/annotations/iris.js'
import { parseSidecar } from '../../../../src/services/annotations/sidecar.js'
import { goLocationsOf, resolveBioRole } from '../../../../src/services/bioView/roles.js'
import { contextOfModule } from '../../../../src/services/bioView/skinContext.js'
import { NO_SKIN, resolveSkin } from '../../../../src/services/bioView/skinRegistry.js'

/** The skin a module with a role and terms is drawn with, chosen or not. */
const skinOf = (role, terms, chosen) => resolveSkin(contextOfModule(role, terms), chosen)?.id ?? null

const TOY = resolve(__dirname, '../../fixtures/annotations/toy')
const readToy = (name) => readFileSync(resolve(TOY, name), 'utf8')
const toySidecar = (name) => parseSidecar(readToy(`${name}.ttl`), { mathRef: `${name}.cellml:${name}`, cellml: readToy(`${name}.cellml`) })

describe('physiological roles', () => {
  it('takes its site’s role on a piece, else a role the location source worked out, else the sidecar’s', async () => {
    const sidecar = await toySidecar('porter')
    expect(resolveBioRole({ name: 'p' }, { sidecar, worked: 'cytosolic', siteRole: 'region' })).toMatchObject({
      role: 'region',
      source: 'site',
    })
    expect(resolveBioRole({ name: 'p' }, { sidecar, worked: 'cytosolic' })).toMatchObject({
      role: 'cytosolic',
      source: 'location',
    })
    expect(resolveBioRole({}, { sidecar, worked: null }).source).toBe('sidecar')
  })

  it('ignores a stored role and where a retired field put it', async () => {
    const data = { name: 'porter', bioView: { role: 'region', facet: 'lateral', cell: 'c', adjacent: [] } }
    expect(resolveBioRole(data, { sidecar: await toySidecar('porter') })).toEqual({
      role: 'membraneProtein',
      skin: 'symporter',
      skinContext: expect.any(Object),
      source: 'sidecar',
    })
    expect(resolveBioRole({ bioView: { role: 'region' } })).toMatchObject({ role: 'none', source: 'none' })
  })

  it('reads the role from the module’s sidecar', async () => {
    const roleOf = async (name) => resolveBioRole({ name }, { sidecar: await toySidecar(name) })
    expect(await roleOf('porter')).toMatchObject({ role: 'membraneProtein', skin: 'symporter', source: 'sidecar' })
    expect(await roleOf('wall')).toMatchObject({ role: 'membrane', source: 'sidecar' })
    expect(await roleOf('pool')).toMatchObject({ role: 'region', source: 'sidecar' })
  })

  it('reads where an unkinded module’s variables are', () => {
    const sidecar = (...locations) => ({ component: { kind: null, isVersionOf: [] }, variables: locations.map((location) => ({ location })) })
    expect(resolveBioRole({}, { sidecar: sidecar(GO.cytoplasm, GO.extracellularRegion) }).role).toBe('membraneProtein')
    expect(resolveBioRole({}, { sidecar: sidecar(GO.cytoplasm, `self+${GO.cytoplasm}`) }).role).toBe('cytosolic')
    expect(resolveBioRole({}, { sidecar: sidecar('self') }).role).toBe('none')
    expect(goLocationsOf(sidecar('self', `self+${GO.plasmaMembrane}`, GO.cytoplasm))).toEqual(new Set([GO.plasmaMembrane, GO.cytoplasm]))
  })

  it('draws a module with the skin chosen for it, ignoring one that doesn’t fit', async () => {
    const sidecar = await toySidecar('porter')
    expect(resolveBioRole({ bioView: { skin: 'pump' } }, { sidecar }).skin).toBe('pump')
    expect(resolveBioRole({ bioView: { skin: 'blob' } }, { sidecar }).skin).toBe('symporter')
  })

  it('is nothing physiological without annotations', () => {
    expect(resolveBioRole({ name: 'plain' })).toEqual({ role: 'none', skin: null, skinContext: null, source: 'none' })
  })

  it('draws each annotated protein function as its skin, and others as generic', () => {
    const glyphFor = (terms, chosen) => skinOf('membraneProtein', terms, chosen)
    expect(glyphFor([GO.glucoseSodiumSymporter])).toBe('symporter')
    expect(glyphFor([GO.glucoseTransporter])).toBe('uniporter')
    expect(glyphFor([GO.sodiumPotassiumAtpase])).toBe('pump')
    expect(glyphFor([GO.inwardRectifierPotassiumChannel])).toBe('channel')
    expect(glyphFor(['GO:0000000'])).toBe('generic')
    expect(glyphFor([GO.glucoseTransporter], 'antiporter')).toBe('antiporter')
    // A process's skin, or none, is not a protein's.
    expect(glyphFor(['GO:0005739'])).toBe('generic')
    expect(glyphFor([], 'mitochondrion')).toBe('generic')
    expect(glyphFor([], NO_SKIN)).toBe('generic')
  })

  it('draws a process as the generic process unless chosen or annotated with a cartoon, or none', () => {
    // SBGN's process node, where nothing says more.
    const process = { siteRole: 'cytosolic' }
    expect(resolveBioRole({}, process).skin).toBe('process')
    expect(resolveBioRole({ bioView: { skin: 'mitochondrion' } }, process).skin).toBe('mitochondrion')
    expect(resolveBioRole({ bioView: { skin: 'blob' } }, process).skin).toBe('process')
    const processGlyphFor = (terms, chosen) => skinOf('cytosolic', terms, chosen)
    expect(processGlyphFor(['GO:0030016'])).toBe('myofilament')
    expect(processGlyphFor(['GO:0005739'])).toBe('mitochondrion')
    expect(processGlyphFor(['GO:0000000'])).toBe('process')
    expect(processGlyphFor([], 'pump')).toBe('process')
    // A plain card only by choice.
    expect(processGlyphFor(['GO:0005739'], NO_SKIN)).toBeNull()
    expect(resolveBioRole({ bioView: { skin: NO_SKIN } }, process).skin).toBeNull()
  })
})
