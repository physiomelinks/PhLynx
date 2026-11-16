// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, describe, expect, it } from 'vitest'

import { parseSidecar } from '../../../src/services/annotations/sidecar.js'
import { renameSidecar } from '../../../src/services/annotations/sidecarEdit.js'
import { buildCaCellmlFiles } from '../../../src/services/export/caCellml.js'
import { buildModularModel } from '../../../src/services/export/modularCellml.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { uniqueComponentIds } from '../../../src/utils/cellml.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'
import { readToy } from '../services/annotations/toyModel.js'
import { TOY_UNITS } from '../services/export/toyWorkspace.js'

// A fork saved into pool's own file: another component with the same ids.
const POOL = readToy('pool.cellml')
const FORK = POOL.replace('name="pool"', 'name="pool_v2"')
const SIDECAR = readToy('pool.ttl')

const idsOf = (xml) => [...xml.matchAll(/\bid="([^"]*)"/g)].map((m) => m[1])

/** The id of a component's variable in a CellML document. */
function variableId(xml, component, variable) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const el = [...doc.getElementsByTagName('component')].find((c) => c.getAttribute('name') === component)
  return [...el.getElementsByTagName('variable')].find((v) => v.getAttribute('name') === variable).getAttribute('id')
}

beforeAll(() => ensureLibCellmlReady(), 120000)

describe('uniqueComponentIds', () => {
  it('keeps the first component its ids and renames a later one’s clashes after its component', () => {
    const { models, idMaps } = uniqueComponentIds([POOL, FORK])
    expect(models[0]).toBe(POOL)
    expect(idMaps[0].size).toBe(0)
    expect(idMaps[1].get('v4rjndoly')).toBe('pool_v2-v4rjndoly')
    expect(variableId(models[1], 'pool_v2', 'c_A')).toBe('pool_v2-v4rjndoly')
  })

  it('steers clear of an id the component already has', () => {
    const fork = FORK.replace('id="v82dsevh3"', 'id="pool_v2-v4rjndoly"')
    const { idMaps } = uniqueComponentIds([POOL, fork])
    expect(idMaps[1].get('v4rjndoly')).toBe('pool_v2-v4rjndoly_2')
  })
})

describe('CA modules export of a file with two components sharing ids', () => {
  const library = {
    availableMath: new Map([
      ['pool.cellml:pool', POOL],
      ['pool.cellml:pool_v2', FORK],
    ]),
    unitDefinitions: new Map(),
  }
  const config = () => [
    { module_type: 'a', component_file: 'pool.cellml', component_type: 'pool' },
    { module_type: 'b', component_file: 'pool.cellml', component_type: 'pool_v2' },
  ]

  it('writes each id once, and the renamed sidecar resolves in the written file', async () => {
    const { files, idRenames } = await buildCaCellmlFiles('m', config(), library)
    const xml = files.get('pool_modules.cellml')
    const ids = idsOf(xml)
    expect(ids.length).toBe(new Set(ids).size)
    expect([...idRenames.keys()]).toEqual(['pool.cellml:pool_v2'])

    const forkRef = 'pool_modules.cellml:pool_v2'
    const forkSidecar = await renameSidecar(SIDECAR, 'pool.cellml:pool', forkRef, {
      ids: idRenames.get('pool.cellml:pool_v2'),
    })
    expect(forkSidecar).toContain('m:pool_v2-v4rjndoly')
    const read = async (text, mathRef) => {
      const { variables, warnings } = await parseSidecar(text, { mathRef, cellml: xml })
      return { warnings, byVariable: new Map(variables.map((entry) => [entry.variable, entry.id])) }
    }
    const fork = await read(forkSidecar, forkRef)
    expect(fork.warnings).toEqual([])
    expect(fork.byVariable.get('c_A')).toBe(variableId(xml, 'pool_v2', 'c_A'))
    // The first component's sidecar still resolves unchanged, on its own ids.
    const firstRef = 'pool_modules.cellml:pool'
    const first = await read(await renameSidecar(SIDECAR, 'pool.cellml:pool', firstRef), firstRef)
    expect(first.warnings).toEqual([])
    expect(first.byVariable.get('c_A')).toBe('v4rjndoly')
  })
})

describe('modular export of two maths from one file sharing ids', () => {
  it('writes each id once in the module file, and each renamed sidecar resolves in it', async () => {
    setActivePinia(createPinia())
    const library = useLibraryStore()
    library.addUnitsFile({ componentFile: 'units.cellml', model: TOY_UNITS })
    library.addMathFile('pool.cellml', [
      { name: 'pool', math: POOL },
      { name: 'pool_v2', math: FORK },
    ])
    library.setModuleAnnotations('pool.cellml:pool', SIDECAR)
    library.setModuleAnnotations(
      'pool.cellml:pool_v2',
      await renameSidecar(SIDECAR, 'pool.cellml:pool', 'pool.cellml:pool_v2')
    )
    const nodes = ['pool', 'pool_v2'].map((component, i) => ({
      id: `n${i}`,
      type: 'instanceNode',
      data: { name: `p${i}`, mathRef: `pool.cellml:${component}`, variables: [], ports: [] },
    }))
    const { files, sidecars, warnings } = await buildModularModel(nodes, [], library, [], { check: false })
    expect(warnings).toEqual([])
    expect(files.map(({ location }) => location)).toEqual(['pool.cellml'])
    const ids = idsOf(files[0].text)
    expect(ids.length).toBe(new Set(ids).size)

    for (const component of ['pool', 'pool_v2']) {
      const sidecar = sidecars.find(({ location }) => location === `annotations/pool.cellml/${component}.ttl`)
      const parsed = await parseSidecar(sidecar.text, { mathRef: `pool.cellml:${component}`, cellml: files[0].text })
      expect(parsed.unresolved).toEqual([])
      expect(parsed.variables.find(({ variable }) => variable === 'c_A').id).toBe(variableId(files[0].text, component, 'c_A'))
    }
  })
})
