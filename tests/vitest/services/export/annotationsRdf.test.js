// @vitest-environment happy-dom
import { existsSync, readFileSync, readdirSync } from 'fs'
import { resolve } from 'path'
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, describe, expect, it } from 'vitest'

import { parseApiCoords } from '../../../../src/services/annotations/apicoord.js'
import { BQBIOL } from '../../../../src/services/annotations/iris.js'
import { parseRdf } from '../../../../src/services/annotations/rdf.js'
import {
  COMBINED_ANNOTATIONS_LOCATION,
  COMBINED_ANNOTATIONS_MARKER,
  OMEX_METADATA_FORMAT,
  collectAnnotationFiles,
  mathRefFromSidecarLocation,
  sidecarLocation,
  staleInstanceNames,
  writeTurtle,
} from '../../../../src/services/export/annotationsRdf.js'
import { useLibraryStore } from '../../../../src/stores/libraryStore.js'
import { generateFlattenedModel } from '../../../../src/utils/cellml.js'
import { ensureLibCellmlReady } from '../../helpers/libcellml-bootstrap.js'
import { readToy } from '../annotations/toyModel.js'
import { TOY_UNITS, toyWorkspace, unitsFor } from './toyWorkspace.js'

const ARCHIVE_BASE = 'https://example.org/archive/'

beforeAll(() => ensureLibCellmlReady(), 120000)

/** Flattens the nodes and collects their annotation files, as the OMEX export does. */
async function exportAnnotations(library, nodes, instanceSources, cellmlFileName = 'model.cellml') {
  await Promise.all([...new Set(nodes.map((node) => node.data.mathRef))].map((ref) => library.ensureModuleAnnotations(ref)))
  const exportedIds = new Map()
  const cellml = await (await generateFlattenedModel(nodes, [], library, [], { check: false, exportedIds })).text()
  const result = await collectAnnotationFiles({ nodes, exportedIds, cellmlFileName, libraryStore: library, instanceSources })
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

describe('writeTurtle', () => {
  it('writes prefixed names, relative IRIs, blank nodes and literals that parse back', async () => {
    const text = writeTurtle(
      [
        { subject: { termType: 'NamedNode', value: './model.cellml#a' }, predicate: { termType: 'NamedNode', value: BQBIOL.isPropertyOf }, object: { termType: 'BlankNode', value: 'b0' } },
        { subject: { termType: 'BlankNode', value: 'b0' }, predicate: { termType: 'NamedNode', value: BQBIOL.is }, object: { termType: 'NamedNode', value: 'http://purl.obolibrary.org/obo/CHEBI_29101' } },
        { subject: { termType: 'NamedNode', value: './model.cellml#a' }, predicate: { termType: 'NamedNode', value: 'http://purl.org/dc/terms/title' }, object: { termType: 'Literal', value: 'say "hi"\n' } },
      ],
      [['model', './model.cellml#']]
    )
    expect(text.startsWith(COMBINED_ANNOTATIONS_MARKER)).toBe(true)
    expect(text).toContain('model:a bqbiol:isPropertyOf _:b0')
    expect(text).toContain('chebi:29101')
    const triples = await parseRdf(text, { baseIri: ARCHIVE_BASE })
    expect(triples).toHaveLength(3)
    expect(triples[0].subject.value).toBe(`${ARCHIVE_BASE}model.cellml#a`)
    expect(triples.find((t) => t.object.termType === 'Literal').object.value).toBe('say "hi"\n')
  })

  it('refuses an internal IRI', () => {
    const internal = { termType: 'NamedNode', value: 'https://phlynx.invalid/modules/x.cellml#x' }
    expect(() => writeTurtle([{ subject: internal, predicate: internal, object: internal }])).toThrow(/internal IRI/)
  })
})

describe('collectAnnotationFiles on the toy workspace', () => {
  let library, nodes, instanceSources

  async function setUp() {
    setActivePinia(createPinia())
    library = useLibraryStore()
    ;({ nodes, instanceSources } = await toyWorkspace(library))
  }

  it('writes one sidecar per math used, the instance file as loaded, and the combined file', async () => {
    await setUp()
    const { files, warnings } = await exportAnnotations(library, nodes, instanceSources)
    expect(warnings).toEqual([])
    expect(files.map(({ location, format }) => [location, format])).toEqual([
      ['annotations/pool.cellml/pool.ttl', 'text/turtle'],
      ['annotations/wall.cellml/wall.ttl', 'text/turtle'],
      ['annotations/porter.cellml/porter.ttl', 'text/turtle'],
      ['toy-apicoords.ttl', 'text/turtle'],
      [COMBINED_ANNOTATIONS_LOCATION, OMEX_METADATA_FORMAT],
    ])
    expect(files[0].text).toBe(readToy('pool.ttl'))
    expect(files[3].text).toBe(readToy('toy-apicoords.ttl'))
  })

  it('places every bound instance on its component, with the coordinates copied', async () => {
    await setUp()
    const { combined, cellml } = await exportAnnotations(library, nodes, instanceSources)
    expect(combined.text).not.toContain('phlynx.invalid')
    const ids = cellmlIds(cellml)
    const { instances, coords, warnings } = await parseApiCoords(combined.text, { baseIri: ARCHIVE_BASE })
    expect(warnings).toEqual([])
    expect(instances.map(({ name }) => name).sort()).toEqual(nodes.map((node) => node.data.name).sort())
    for (const instance of instances) {
      expect(ids.has(instance.name)).toBe(true)
      expect(instance.subject).toBe(`${ARCHIVE_BASE}model.cellml#${instance.name}`)
      // The coordinate keeps the instance file's relative IRI.
      expect(instance.coordIri).toBe(`${ARCHIVE_BASE}apicoords.rdf#coord_${instance.name}`)
      expect(instance.coord.kind).toBeTruthy()
    }
    expect(coords.size).toBe(instances.length)
  })

  it("puts each instance's copy of its sidecar on that instance's variable ids", async () => {
    await setUp()
    const { combined, cellml } = await exportAnnotations(library, nodes, instanceSources)
    const ids = cellmlIds(cellml)
    const triples = await parseRdf(combined.text, { baseIri: ARCHIVE_BASE })
    const modelPrefix = `${ARCHIVE_BASE}model.cellml#`
    const annotated = new Set(
      triples
        .filter((t) => t.predicate.value === BQBIOL.isVersionOf && t.subject.value.startsWith(modelPrefix))
        .map((t) => t.subject.value.slice(modelPrefix.length))
    )
    for (const id of annotated) expect(ids.has(id)).toBe(true)
    // A '#id' subject in the sidecar follows its variable's id, prefixed for each instance.
    expect(annotated).toContain('porter_in-flux_in')
    expect(annotated).toContain('porter_out-flux_in')
    expect(annotated).toContain('porter_in-c_A_i')
    expect(annotated).toContain('outside-c_A')
    // An entity part of the component is part of the instance's component.
    const partOf = triples.filter((t) => t.predicate.value === BQBIOL.isPartOf).map((t) => t.object.value)
    expect(partOf).toContain(`${modelPrefix}outside`)
    expect(partOf).toContain(`${modelPrefix}vessel`)
  })

  it('uses the current names and warns when a bound instance was renamed', async () => {
    await setUp()
    const porter = nodes.find((node) => node.data.name === 'porter_in')
    porter.data = { ...porter.data, name: 'uptake' }
    expect(staleInstanceNames(nodes, 'model.cellml')).toEqual([{ name: 'uptake', fileName: 'porter_in', file: 'model.cellml' }])
    const { combined, files, warnings } = await exportAnnotations(library, nodes, instanceSources)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/porter_in \(now uptake\)/)
    // The instance file stays as it was loaded; the combined file has the new name.
    expect(files.find((file) => file.location === 'toy-apicoords.ttl').text).toBe(readToy('toy-apicoords.ttl'))
    const { instances } = await parseApiCoords(combined.text, { baseIri: ARCHIVE_BASE })
    expect(instances.find((instance) => instance.coordIri.endsWith('#coord_porter_in')).name).toBe('uptake')
    expect(combined.text).toContain('uptake-flux_in')
  })

  it('warns when the archive names its model differently from the instance file', async () => {
    await setUp()
    const { warnings, combined } = await exportAnnotations(library, nodes, instanceSources, 'renamed.cellml')
    expect(warnings[0]).toMatch(/in model\.cellml/)
    expect(combined.text).toContain('@prefix model: <./renamed.cellml#>')
  })

  it('writes nothing for a workspace without annotations', async () => {
    setActivePinia(createPinia())
    library = useLibraryStore()
    library.addUnitsFile({ componentFile: 'units.cellml', model: TOY_UNITS })
    library.addMathFile('pool.cellml', [{ name: 'pool', math: readToy('pool.cellml') }])
    const plain = [{ id: 'n1', type: 'instanceNode', data: { name: 'p', mathRef: 'pool.cellml:pool', variables: [], ports: [] } }]
    expect(await exportAnnotations(library, plain, [])).toMatchObject({ files: [], warnings: [] })
  })
})

const PRIVATE = resolve(__dirname, '../../fixtures/annotations/private')
const readPrivate = (...path) => readFileSync(resolve(PRIVATE, ...path), 'utf8')

describe.skipIf(!existsSync(resolve(PRIVATE, 'expected.json')))('collectAnnotationFiles on the private fixtures', () => {
  it('resolves every expected instance and every annotated variable in the exported model', async () => {
    setActivePinia(createPinia())
    const library = useLibraryStore()
    const components = readdirSync(resolve(PRIVATE, 'maths'))
      .filter((file) => file.endsWith('.cellml'))
      .map((file) => file.replace(/\.cellml$/, ''))
    const maths = components.map((component) => readPrivate('maths', `${component}.cellml`))
    library.addUnitsFile({ componentFile: 'units.cellml', model: unitsFor(maths) })
    for (const component of components) {
      library.addMathFile(`${component}.cellml`, [{ name: component, math: readPrivate('maths', `${component}.cellml`) }])
      library.setModuleAnnotations(`${component}.cellml:${component}`, readPrivate('sidecars', `${component}.ttl`))
    }
    const instanceText = readPrivate('apicoords.ttl')
    const apiCoords = await parseApiCoords(instanceText)
    const expected = JSON.parse(readPrivate('expected.json'))
    const nodes = expected.instances.map(({ name, mathRef }, i) => {
      const component = mathRef.split(':')[1]
      const instance = apiCoords.instances.find((entry) => entry.name === name)
      return {
        id: `n${i}`,
        type: 'instanceNode',
        data: {
          name,
          mathRef: `${component}.cellml:${component}`,
          variables: [],
          ports: [],
          apiCoord: { subject: instance.subject, coordIri: instance.coordIri, name },
        },
      }
    })
    const sources = [{ location: 'instances.ttl', format: 'turtle', text: instanceText }]
    const { files, combined, cellml, warnings } = await exportAnnotations(library, nodes, sources)
    expect(warnings).toEqual([])
    expect(files.find((file) => file.location === 'instances.ttl').text).toBe(instanceText)
    expect(combined.text).not.toContain('phlynx.invalid')

    const parsed = await parseApiCoords(combined.text, { baseIri: ARCHIVE_BASE })
    expect(parsed.instances.map(({ name }) => name).sort()).toEqual(expected.instances.map(({ name }) => name).sort())
    expect(parsed.coords.size).toBe(apiCoords.coords.size)

    const ids = cellmlIds(cellml)
    const triples = await parseRdf(combined.text, { baseIri: ARCHIVE_BASE })
    const prefix = `${ARCHIVE_BASE}model.cellml#`
    const subjects = triples.filter((t) => t.subject.value.startsWith(prefix)).map((t) => t.subject.value.slice(prefix.length))
    for (const id of subjects) expect(ids.has(id)).toBe(true)
    // Every sidecar variable, once per instance of its math.
    let expectedCount = 0
    for (const node of nodes) expectedCount += (await library.ensureModuleAnnotations(node.data.mathRef)).variables.length
    // Components can be a version of a GO activity; their subjects are the instance names.
    const names = new Set(nodes.map((node) => `${prefix}${node.data.name}`))
    const variableSubjects = new Set(
      triples
        .filter((t) => t.predicate.value === BQBIOL.isVersionOf && t.subject.value.startsWith(prefix))
        .map((t) => t.subject.value)
        .filter((subject) => !names.has(subject))
    )
    expect(variableSubjects.size).toBe(expectedCount)
  })
})
