// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, describe, expect, it } from 'vitest'

import { parseSidecar } from '../../../../src/services/annotations/sidecar.js'
import { mathRefFromSidecarLocation, sidecarLocation } from '../../../../src/services/export/annotationsRdf.js'
import { buildModularModel } from '../../../../src/services/export/modularCellml.js'
import { useLibraryStore } from '../../../../src/stores/libraryStore.js'
import { ensureLibCellmlReady } from '../../helpers/libcellml-bootstrap.js'
import { readToy } from '../annotations/toyModel.js'
import { TOY_UNITS, toyWorkspace } from './toyWorkspace.js'

beforeAll(() => ensureLibCellmlReady(), 120000)

describe('sidecar locations', () => {
  it('maps a mathRef to annotations/<file>/<component>.ttl and back', () => {
    expect(sidecarLocation('porter.cellml:porter')).toBe('annotations/porter.cellml/porter.ttl')
    expect(mathRefFromSidecarLocation('annotations/porter.cellml/porter.ttl')).toBe('porter.cellml:porter')
    expect(mathRefFromSidecarLocation('annotations.ttl')).toBeNull()
    expect(mathRefFromSidecarLocation('other/porter.cellml/porter.ttl')).toBeNull()
    expect(sidecarLocation('no-component')).toBeNull()
  })
})

describe('the modular export of the toy workspace', () => {
  it('writes each math used once, with its sidecar as stored, resolving against its module file', async () => {
    setActivePinia(createPinia())
    const library = useLibraryStore()
    const { nodes } = toyWorkspace(library)
    const { files, sidecars, warnings } = await buildModularModel(nodes, [], library, [], { check: false })
    expect(warnings).toEqual([])
    expect(files.map(({ location }) => location)).toEqual(['pool.cellml', 'wall.cellml', 'porter.cellml'])
    expect(sidecars.map(({ location, format }) => [location, format])).toEqual([
      ['annotations/pool.cellml/pool.ttl', 'text/turtle'],
      ['annotations/wall.cellml/wall.ttl', 'text/turtle'],
      ['annotations/porter.cellml/porter.ttl', 'text/turtle'],
    ])
    for (const [i, name] of ['pool', 'wall', 'porter'].entries()) {
      expect(sidecars[i].text).toBe(readToy(`${name}.ttl`))
      const parsed = await parseSidecar(sidecars[i].text, { mathRef: `${name}.cellml:${name}`, cellml: files[i].text })
      expect(parsed.unresolved).toEqual([])
    }
  })

  it('writes no sidecars for a workspace without annotations', async () => {
    setActivePinia(createPinia())
    const library = useLibraryStore()
    library.addUnitsFile({ componentFile: 'units.cellml', model: TOY_UNITS })
    library.addMathFile('pool.cellml', [{ name: 'pool', math: readToy('pool.cellml') }])
    const plain = [{ id: 'n1', type: 'instanceNode', data: { name: 'p', mathRef: 'pool.cellml:pool', variables: [], ports: [] } }]
    expect(await buildModularModel(plain, [], library, [], { check: false })).toMatchObject({ sidecars: [], warnings: [] })
  })
})
