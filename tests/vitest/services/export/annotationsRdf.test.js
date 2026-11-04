// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, describe, expect, it } from 'vitest'

import { BQBIOL, SEMSIM } from '../../../../src/services/annotations/iris.js'
import { parseRdf } from '../../../../src/services/annotations/rdf.js'
import {
  COMBINED_ANNOTATIONS_LOCATION,
  COMBINED_ANNOTATIONS_MARKER,
  OMEX_METADATA_FORMAT,
  collectAnnotationFiles,
  combinedLocalNamespace,
  mathRefFromSidecarLocation,
  sidecarLocation,
} from '../../../../src/services/export/annotationsRdf.js'
import { useLibraryStore } from '../../../../src/stores/libraryStore.js'
import { generateFlattenedModel } from '../../../../src/utils/cellml.js'
import { ensureLibCellmlReady } from '../../helpers/libcellml-bootstrap.js'
import { readToy } from '../annotations/toyModel.js'
import { TOY_UNITS, toyWorkspace } from './toyWorkspace.js'

const ARCHIVE_BASE = 'https://example.org/archive/'
const MODEL_OMEX = 'http://omex-library.org/model.omex/'
const LOCAL = `${MODEL_OMEX}annotations.ttl#`

beforeAll(() => ensureLibCellmlReady(), 120000)

/** Flattens the nodes and collects their annotation files, as the OMEX export does. */
async function exportAnnotations(library, nodes, cellmlFileName = 'model.cellml', archiveName) {
  await Promise.all([...new Set(nodes.map((node) => node.data.mathRef))].map((ref) => library.ensureModuleAnnotations(ref)))
  const exportedIds = new Map()
  const cellml = await (await generateFlattenedModel(nodes, [], library, [], { check: false, exportedIds })).text()
  const libraryStore = library
  const options = { nodes, exportedIds, cellmlFileName, libraryStore, archiveName }
  const result = await collectAnnotationFiles(options)
  return { ...result, cellml, combined: result.files.find((file) => file.location === COMBINED_ANNOTATIONS_LOCATION) }
}

const cellmlIds = (cellml) => new Set([...cellml.matchAll(/\bid="([^"]*)"/g)].map((m) => m[1]))

describe('sidecar locations', () => {
  it('maps a mathRef to annotations/<file>/<component>.ttl and back', () => {
    expect(sidecarLocation('porter.cellml:porter')).toBe('annotations/porter.cellml/porter.ttl')
    expect(mathRefFromSidecarLocation('annotations/porter.cellml/porter.ttl')).toBe('porter.cellml:porter')
    expect(mathRefFromSidecarLocation('annotations.ttl')).toBeNull()
    expect(mathRefFromSidecarLocation('other/porter.cellml/porter.ttl')).toBeNull()
    expect(sidecarLocation('no-component')).toBeNull()
  })
})

describe('collectAnnotationFiles on the toy workspace', () => {
  let library, nodes

  async function setUp() {
    setActivePinia(createPinia())
    library = useLibraryStore()
    ;({ nodes } = toyWorkspace(library))
  }

  it('writes one sidecar per math used and the combined file', async () => {
    await setUp()
    const { files, warnings } = await exportAnnotations(library, nodes)
    expect(warnings).toEqual([])
    expect(files.map(({ location, format }) => [location, format])).toEqual([
      ['annotations/pool.cellml/pool.ttl', 'text/turtle'],
      ['annotations/wall.cellml/wall.ttl', 'text/turtle'],
      ['annotations/porter.cellml/porter.ttl', 'text/turtle'],
      [COMBINED_ANNOTATIONS_LOCATION, OMEX_METADATA_FORMAT],
    ])
    expect(files[0].text).toBe(readToy('pool.ttl'))
  })

  it('writes only absolute IRIs, so nothing depends on where the file is read from', async () => {
    await setUp()
    const { combined } = await exportAnnotations(library, nodes)
    expect(combined.text.startsWith(COMBINED_ANNOTATIONS_MARKER)).toBe(true)
    expect(combined.text).not.toContain('phlynx.invalid')
    expect(combined.text).toContain(`@prefix model: <${MODEL_OMEX}model.cellml#> .`)
    expect(combined.text).not.toMatch(/<\.\//)
    const triples = await parseRdf(combined.text, { baseIri: ARCHIVE_BASE })
    const terms = triples.flatMap((t) => [t.subject, t.object]).filter((term) => term.termType === 'NamedNode')
    expect(terms.some((term) => term.value.startsWith(ARCHIVE_BASE))).toBe(false)
  })

  it("puts each instance's copy of its sidecar on that instance's variable ids", async () => {
    await setUp()
    const { combined, cellml } = await exportAnnotations(library, nodes)
    const ids = cellmlIds(cellml)
    const triples = await parseRdf(combined.text, { baseIri: ARCHIVE_BASE })
    const modelPrefix = `${MODEL_OMEX}model.cellml#`
    const annotated = new Set(
      triples
        .filter((t) => t.predicate.value === BQBIOL.isVersionOf && t.subject.value.startsWith(modelPrefix))
        .map((t) => t.subject.value.slice(modelPrefix.length))
    )
    for (const id of annotated) expect(ids.has(id)).toBe(true)
    // A '#id' subject in the sidecar follows its variable's id, prefixed for each instance.
    expect(annotated).toContain('porter_in-flux_in')
    expect(annotated).toContain('porter_out-flux_in')
    expect(annotated).toContain('porter_in-v4y7hdahd')
    expect(annotated).toContain('outside-v4rjndoly')
    // An entity part of the module is part of the instance's own entity.
    const partOf = triples.filter((t) => t.predicate.value === BQBIOL.isPartOf).map((t) => t.object.value)
    expect(partOf).toContain(`${LOCAL}outside-entity_self`)
    expect(partOf).toContain(`${LOCAL}vessel-entity_self`)
    // Each instance has its own processes and shared entities; a transporter's processes gain the instance's own
    // entity as mediator, which the sidecar leaves out, and one that names a mediator keeps just its own.
    const objectsOf = (subject, predicate) =>
      triples.filter((t) => t.subject.value === subject && t.predicate.value === predicate).map((t) => t.object.value)
    const mediatorsOf = (process) =>
      objectsOf(process, SEMSIM.hasMediatorParticipant).flatMap((m) => objectsOf(m, SEMSIM.hasPhysicalEntityReference))
    for (const name of ['porter_in', 'porter_out']) {
      expect(mediatorsOf(`${LOCAL}${name}-process_flux_in`)).toEqual([`${LOCAL}${name}-entity_self`])
      expect(mediatorsOf(`${LOCAL}${name}-process_vp3vtnv5k`)).toEqual([`${LOCAL}${name}-entity_self`])
      expect(objectsOf(`${LOCAL}${name}-Na_in`, BQBIOL.isPartOf)).toEqual([`${LOCAL}${name}-inside`])
    }
    const blankProcess = triples.find(
      (t) => t.subject.value === `${modelPrefix}porter_in-v4xc6r3hg` && t.predicate.value === BQBIOL.isPropertyOf
    ).object.value
    expect(mediatorsOf(blankProcess)).toEqual([`${LOCAL}porter_in-entity_self`])
    expect(mediatorsOf(`${LOCAL}outside-process_v82dsevh3`)).toEqual([])
  })

  it("names each instance's entities in the archive's OMEX local namespace, with no blank nodes", async () => {
    await setUp()
    const { combined } = await exportAnnotations(library, nodes, 'model.cellml', 'toy.omex')
    const local = 'http://omex-library.org/toy.omex/annotations.ttl#'
    expect(combinedLocalNamespace('toy.omex')).toBe(local)
    expect(combinedLocalNamespace('toy')).toBe(local)
    expect(combined.text).toContain(`@prefix local: <${local}> .`)
    expect(combined.text).toContain(
      'model:outside-v4rjndoly bqbiol:isVersionOf opb:00340 ;\n    bqbiol:isPropertyOf local:outside-Na_self .'
    )
    expect(combined.text).toContain(
      'local:outside-Na_self bqbiol:is chebi:29101 ;\n    bqbiol:isPartOf local:outside-entity_self .'
    )
    const triples = await parseRdf(combined.text, { baseIri: ARCHIVE_BASE })
    const isLocal = (term) => term.termType === 'NamedNode' && term.value.startsWith(local)
    const isAnnotated = (t) => t.predicate.value === BQBIOL.isVersionOf && !t.object.value.includes('GO')
    const annotated = new Set(triples.filter(isAnnotated).map((t) => t.subject.value))
    const sidecarTriples = triples.filter((t) => isLocal(t.subject) || annotated.has(t.subject.value))
    // A blank-node entity in a sidecar (the porter's) becomes a local one too.
    expect(sidecarTriples.some((t) => isLocal(t.object) && t.object.value.startsWith(`${local}porter_in-b`))).toBe(true)
    const entities = triples.filter((t) => t.predicate.value === BQBIOL.isPropertyOf).map((t) => t.object)
    expect(entities.every((term) => isLocal(term) || term.value.startsWith(`${MODEL_OMEX}model.cellml#`))).toBe(true)
    const isBlank = (t) => t.subject.termType === 'BlankNode' || t.object.termType === 'BlankNode'
    expect(sidecarTriples.some(isBlank)).toBe(false)
  })

  it('names the local namespace after the model when no archive name is given', async () => {
    await setUp()
    const { combined } = await exportAnnotations(library, nodes)
    expect(combined.text).toContain('@prefix local: <http://omex-library.org/model.omex/annotations.ttl#> .')
  })

  it("leaves out, with a warning, a sidecar whose math is missing, since its '#<id>' subjects need it", async () => {
    const store = { getModuleAnnotations: () => readToy('pool.ttl'), availableMath: new Map() }
    const node = { id: 'n1', data: { name: 'p', mathRef: 'pool.cellml:pool' } }
    const exportedIds = new Map([['n1', { componentId: 'p', variableIds: new Map() }]])
    const { warnings } = await collectAnnotationFiles({
      nodes: [node],
      exportedIds,
      cellmlFileName: 'model.cellml',
      libraryStore: store,
    })
    expect(warnings).toContainEqual(expect.stringMatching(/^The math of pool\.cellml:pool is missing/))
  })

  it('writes nothing for a workspace without annotations', async () => {
    setActivePinia(createPinia())
    library = useLibraryStore()
    library.addUnitsFile({ componentFile: 'units.cellml', model: TOY_UNITS })
    library.addMathFile('pool.cellml', [{ name: 'pool', math: readToy('pool.cellml') }])
    const plain = [{ id: 'n1', type: 'instanceNode', data: { name: 'p', mathRef: 'pool.cellml:pool', variables: [], ports: [] } }]
    expect(await exportAnnotations(library, plain)).toMatchObject({ files: [], warnings: [] })
  })
})
