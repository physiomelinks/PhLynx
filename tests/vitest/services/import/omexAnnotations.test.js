// @vitest-environment happy-dom
import { readFileSync } from 'fs'
import { resolve } from 'path'
import JSZip from 'jszip'
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { generateOmexArchive } from '../../../../src/services/compress.js'
import { COMBINED_ANNOTATIONS_LOCATION, OMEX_METADATA_FORMAT, collectAnnotationFiles } from '../../../../src/services/export/annotationsRdf.js'
import { importOmexFile, readArchiveEntries } from '../../../../src/services/import/omex.js'
import { buildRestoredPorts, restoreOmexAnnotations } from '../../../../src/services/import/omexAnnotations.js'
import { useAnnotationStore } from '../../../../src/stores/annotationStore.js'
import { useLibraryStore } from '../../../../src/stores/libraryStore.js'
import { PHLYNX_PROJECT_VERSION } from '../../../../src/utils/constants.js'
import { generateFlattenedModel } from '../../../../src/utils/cellml.js'
import { ensureLibCellmlReady } from '../../helpers/libcellml-bootstrap.js'
import { readToy } from '../annotations/toyModel.js'
import { TOY_UNITS, toyWorkspace } from '../export/toyWorkspace.js'

const omexStore = vi.hoisted(() => ({ preservedExtras: [] }))
vi.mock('../../../../src/stores/omexStore.js', () => ({ useOmexStore: () => omexStore }))

const TOY_INSTANCE_FILE = resolve(__dirname, '../../fixtures/annotations/toy/toy-apicoords.ttl')

// An unrelated RDF file and a note someone else put in the archive.
const OTHER_RDF = `@prefix dcterms: <http://purl.org/dc/terms/> .\n<./model.cellml> dcterms:creator "someone" .\n`
const EXTRAS = [
  { location: 'notes/readme.txt', format: 'text/plain', payload: 'hello' },
  { location: 'metadata/other.ttl', format: 'text/turtle', payload: OTHER_RDF },
]

beforeAll(() => ensureLibCellmlReady(), 120000)

/** Exports the workspace's nodes as an OMEX archive with their annotations, as the OpenCOR export does. */
async function exportOmex(library, annotationStore, nodes) {
  await Promise.all([...new Set(nodes.map((node) => node.data.mathRef))].map((ref) => library.ensureModuleAnnotations(ref)))
  const exportedIds = new Map()
  const blob = await generateFlattenedModel(nodes, [], library, [], { check: false, exportedIds })
  const annotations = await collectAnnotationFiles({
    nodes,
    exportedIds,
    cellmlFileName: 'model.cellml',
    libraryStore: library,
    instanceSources: annotationStore.instanceSources,
  })
  const snapshot = JSON.stringify({ id: 'phlynx-flow-snapshot', version: PHLYNX_PROJECT_VERSION, nodeData: nodes.map(({ id, data }) => ({ id, data })), edges: [] })
  const omex = await generateOmexArchive({ blob }, snapshot, {}, { cellmlFileName: 'model.cellml', extractedData: {}, annotationFiles: annotations.files })
  return { omex: await omex.arrayBuffer(), warnings: annotations.warnings }
}

/** Imports an archive's annotations into fresh stores, as an OMEX import does. */
async function importOmex(buffer) {
  const result = await importOmexFile(buffer)
  setActivePinia(createPinia())
  const library = useLibraryStore()
  const annotationStore = useAnnotationStore()
  const restored = restoreOmexAnnotations(result.annotations, { libraryStore: library, annotationStore })
  const archive = await JSZip.loadAsync(buffer)
  const snapshot = JSON.parse(await archive.file(result.files.flowSnapshot).async('string'))
  return { result, restored, library, annotationStore, archive, snapshot }
}

describe('OMEX export and import of annotations', () => {
  let library, annotationStore, nodes

  beforeEach(async () => {
    omexStore.preservedExtras = EXTRAS
    setActivePinia(createPinia())
    library = useLibraryStore()
    annotationStore = useAnnotationStore()
    let instanceSources
    ;({ nodes, instanceSources } = await toyWorkspace(library))
    for (const source of instanceSources) annotationStore.addInstanceSource(source)
  })

  it('lists the sidecars, instance file and combined file in the manifest with their formats', async () => {
    const { omex } = await exportOmex(library, annotationStore, nodes)
    const archive = await JSZip.loadAsync(omex)
    const manifest = await archive.file('manifest.xml').async('string')
    expect(manifest).toContain('<content location="annotations/porter.cellml/porter.ttl" format="text/turtle"/>')
    expect(manifest).toContain('<content location="toy-apicoords.ttl" format="text/turtle"/>')
    expect(manifest).toContain(`<content location="${COMBINED_ANNOTATIONS_LOCATION}" format="${OMEX_METADATA_FORMAT}"/>`)
    // The instance file is the same bytes as the file it was loaded from.
    expect(Buffer.from(await archive.file('toy-apicoords.ttl').async('uint8array')).equals(readFileSync(TOY_INSTANCE_FILE))).toBe(true)
  })

  it('brings the sidecars, instance file and bindings back, and skips the combined file', async () => {
    const { omex } = await exportOmex(library, annotationStore, nodes)
    const imported = await importOmex(omex)
    expect(imported.restored).toEqual({ sidecars: 3, instanceFiles: 1 })
    for (const name of ['pool', 'porter', 'wall']) {
      expect(imported.library.getModuleAnnotations(`${name}.cellml:${name}`)).toBe(readToy(`${name}.ttl`))
    }
    expect(imported.annotationStore.instanceSources).toEqual([
      { location: 'toy-apicoords.ttl', format: 'turtle', text: readToy('toy-apicoords.ttl') },
    ])
    const locations = imported.result.extras.map(({ location }) => location)
    expect(locations).not.toContain(COMBINED_ANNOTATIONS_LOCATION)
    expect(locations).not.toContain('toy-apicoords.ttl')
    // The nodes' bindings travel in the flow snapshot.
    const bindings = imported.snapshot.nodeData.map(({ data }) => [data.name, data.apiCoord])
    expect(bindings).toEqual(nodes.map(({ data }) => [data.name, data.apiCoord]))
  })

  it('keeps the instance file byte-identical through a second export', async () => {
    const first = await exportOmex(library, annotationStore, nodes)
    const imported = await importOmex(first.omex)
    await Promise.all(['pool', 'porter', 'wall'].map((name) => imported.library.addMathFile(`${name}.cellml`, [{ name, math: readToy(`${name}.cellml`) }])))
    imported.library.addUnitsFile({ componentFile: 'units.cellml', model: TOY_UNITS })
    const second = await exportOmex(imported.library, imported.annotationStore, imported.snapshot.nodeData)
    const archive = await JSZip.loadAsync(second.omex)
    expect(Buffer.from(await archive.file('toy-apicoords.ttl').async('uint8array')).equals(readFileSync(TOY_INSTANCE_FILE))).toBe(true)
    const combined = await (await JSZip.loadAsync(first.omex)).file(COMBINED_ANNOTATIONS_LOCATION).async('string')
    expect(await archive.file(COMBINED_ANNOTATIONS_LOCATION).async('string')).toBe(combined)
  })

  it('keeps unrelated extras with their manifest format, RDF included', async () => {
    const { omex } = await exportOmex(library, annotationStore, nodes)
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

  it('warns, and still round-trips, when a bound instance was renamed', async () => {
    const renamed = nodes.map((node) => (node.data.name === 'wall' ? { ...node, data: { ...node.data, name: 'membrane' } } : node))
    const { omex, warnings } = await exportOmex(library, annotationStore, renamed)
    expect(warnings.join(' ')).toMatch(/wall \(now membrane\)/)
    const archive = await JSZip.loadAsync(omex)
    expect(await archive.file(COMBINED_ANNOTATIONS_LOCATION).async('string')).toContain('model:membrane bqbiol:is')
    const imported = await importOmex(omex)
    expect(imported.annotationStore.instanceSources[0].text).toBe(readToy('toy-apicoords.ttl'))
    expect(imported.snapshot.nodeData.find(({ data }) => data.name === 'membrane').data.apiCoord.name).toBe('wall')
  })
})

describe('buildRestoredPorts', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('gives nodes on a restored sidecar math its sidecar ports, and leaves the rest', async () => {
    const library = useLibraryStore()
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
