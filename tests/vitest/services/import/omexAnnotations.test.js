// @vitest-environment happy-dom
import JSZip from 'jszip'
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { generateOmexArchive } from '../../../../src/services/compress.js'
import { buildModularModel } from '../../../../src/services/export/modularCellml.js'
import { importOmexFile, readArchiveEntries } from '../../../../src/services/import/omex.js'
import { buildRestoredPorts, restoreOmexAnnotations } from '../../../../src/services/import/omexAnnotations.js'
import { useLibraryStore } from '../../../../src/stores/libraryStore.js'
import { PHLYNX_PROJECT_VERSION } from '../../../../src/utils/constants.js'
import { ensureLibCellmlReady } from '../../helpers/libcellml-bootstrap.js'
import { readToy } from '../annotations/toyModel.js'
import { toyWorkspace } from '../export/toyWorkspace.js'

const omexStore = vi.hoisted(() => ({ preservedExtras: [] }))
vi.mock('../../../../src/stores/omexStore.js', () => ({ useOmexStore: () => omexStore }))

// An unrelated RDF file and a note someone else put in the archive.
const OTHER_RDF = `@prefix dcterms: <http://purl.org/dc/terms/> .\n<./model.cellml> dcterms:creator "someone" .\n`
const EXTRAS = [
  { location: 'notes/readme.txt', format: 'text/plain', payload: 'hello' },
  { location: 'metadata/other.ttl', format: 'text/turtle', payload: OTHER_RDF },
]

beforeAll(() => ensureLibCellmlReady(), 120000)

/** Exports the workspace's nodes as a modular OMEX archive with their annotations, as the OpenCOR export does. */
async function exportOmex(library, nodes) {
  const modular = await buildModularModel(nodes, [], library, [], { check: false })
  const snapshot = JSON.stringify({ id: 'phlynx-flow-snapshot', version: PHLYNX_PROJECT_VERSION, nodeData: nodes.map(({ id, data }) => ({ id, data })), edges: [] })
  const omex = await generateOmexArchive({ blob: new Blob([modular.main]), flat: modular.flat }, snapshot, {}, {
    cellmlFileName: 'model.cellml',
    extractedData: {},
    moduleFiles: modular.files,
    annotationFiles: modular.sidecars,
  })
  return { omex: await omex.arrayBuffer(), warnings: modular.warnings }
}

/** Imports an archive's annotations into fresh stores, as an OMEX import does. */
async function importOmex(buffer) {
  const result = await importOmexFile(buffer)
  setActivePinia(createPinia())
  const library = useLibraryStore()
  const restored = restoreOmexAnnotations(result.annotations, { libraryStore: library })
  return { result, restored, library }
}

describe('OMEX export and import of annotations', () => {
  let library, nodes

  beforeEach(() => {
    omexStore.preservedExtras = EXTRAS
    setActivePinia(createPinia())
    library = useLibraryStore()
    ;({ nodes } = toyWorkspace(library))
  })

  it('lists the module files and sidecars in the manifest with their formats', async () => {
    const { omex } = await exportOmex(library, nodes)
    const archive = await JSZip.loadAsync(omex)
    const manifest = await archive.file('manifest.xml').async('string')
    expect(manifest).toContain('<content location="annotations/porter.cellml/porter.ttl" format="text/turtle"/>')
    expect(manifest).toContain('<content location="porter.cellml" format="http://identifiers.org/combine.specifications/cellml"/>')
    expect(await archive.file('model.cellml').async('string')).toMatch(/xlink:href="porter\.cellml"/)
  })

  it('runs a flattened copy from the SED-ML, and imports the modular main model', async () => {
    const { omex } = await exportOmex(library, nodes)
    const archive = await JSZip.loadAsync(omex)
    const manifest = await archive.file('manifest.xml').async('string')
    expect(manifest).toContain('<content location="flattened/model.cellml" format="http://identifiers.org/combine.specifications/cellml"/>')
    expect(await archive.file('document.sedml').async('string')).toContain('source="flattened/model.cellml"')
    expect(await archive.file('flattened/model.cellml').async('string')).not.toMatch(/<import\b/)
    expect((await importOmexFile(omex)).files.cellml).toBe('model.cellml')
  })

  it('brings the sidecars back', async () => {
    const { omex } = await exportOmex(library, nodes)
    const imported = await importOmex(omex)
    expect(imported.result.files.cellml).toBe('model.cellml')
    expect(imported.restored).toEqual({ sidecars: 3 })
    for (const name of ['pool', 'porter', 'wall']) {
      expect(imported.library.getModuleAnnotations(`${name}.cellml:${name}`)).toBe(readToy(`${name}.ttl`))
    }
  })

  it('keeps unrelated extras with their manifest format, RDF included', async () => {
    const { omex } = await exportOmex(library, nodes)
    const { result } = await importOmex(omex)
    expect(result.extras).toEqual(
      expect.arrayContaining([
        { location: 'notes/readme.txt', format: 'text/plain' },
        { location: 'metadata/other.ttl', format: 'text/turtle' },
      ])
    )
    const entries = await readArchiveEntries(await JSZip.loadAsync(omex), result)
    const formatOf = (location) => entries.find((entry) => entry.location === location)?.format
    expect(formatOf('notes/readme.txt')).toBe('text/plain')
    expect(formatOf('metadata/other.ttl')).toBe('text/turtle')
    expect(formatOf('flow-snapshot.json')).toBe('application/x.vnd.phlynx-flow+json')
  })
})

describe('buildRestoredPorts', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('gives nodes on a restored side-car math its side-car ports, and leaves the rest', async () => {
    const library = useLibraryStore()
    library.addMath('pool.cellml:pool', readToy('pool.cellml'))
    library.setModuleAnnotations('pool.cellml:pool', readToy('pool.ttl'))
    const variables = ['c_A', 'v_A', 'volume', 'area'].map((name) => ({ name }))
    const nodes = [
      { id: 'p', data: { mathRef: 'pool.cellml:pool', variables, ports: [] } },
      { id: 'w', data: { mathRef: 'wall.cellml:wall', variables: [{ name: 'u' }], ports: [] } },
    ]

    const ports = await buildRestoredPorts(nodes, [{ mathRef: 'pool.cellml:pool' }], library)

    expect([...ports.keys()]).toEqual(['p'])
    expect(ports.get('p').every((port) => port.annotation.source.kind === 'sidecar')).toBe(true)
    expect(ports.get('p').length).toBeGreaterThan(0)
    expect(nodes[0].data.ports).toEqual([])
  })
})
