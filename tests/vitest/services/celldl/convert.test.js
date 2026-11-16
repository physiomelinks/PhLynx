// @vitest-environment node
// The editor's oxigraph wasm doesn't start under happy-dom, whose Response breaks wasm streaming,
// and happy-dom's DOMParser drops the CDATA a CellDL document keeps its Turtle in; so these run in
// Node with xmldom's parser, and flatten with happy-dom's DOM, which PhLynx's CellML code needs.
import fs from 'node:fs'
import path from 'node:path'

import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { CellMLTextGenerator } from 'cellml-text-editor'
import { Window } from 'happy-dom'
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, describe, expect, it } from 'vitest'

import { convertCelldl, knownUnitsFor } from '../../../../src/services/celldl/convert.js'
import { LOCAL_DOCUMENT_BASE, mintDocumentUri } from '../../../../src/services/celldl/documentUri.js'
import { variableForElement } from '../../../../src/services/celldl/elements.js'
import { getConverter } from '../../../../src/services/celldl/runtime.js'
import { sectionLayout } from '../../../../src/services/celldl/sectionLayout.js'
import { analyzeMathXml } from '../../../../src/services/math/analyzeMath.js'
import { reconcileRows } from '../../../../src/services/math/reconcileRows.js'
import { useLibraryStore } from '../../../../src/stores/libraryStore.js'
import { generateFlattenedModel } from '../../../../src/utils/cellml.js'
import { ensureLibCellmlReady } from '../../helpers/libcellml-bootstrap.js'

globalThis.DOMParser ??= DOMParser
globalThis.XMLSerializer ??= XMLSerializer

const fixture = (name) => fs.readFileSync(path.resolve(__dirname, '../../fixtures/celldl', name), 'utf8')
const RC = fixture('rc.celldl')
const ONE_REACTION = fs.readFileSync(path.resolve(__dirname, '../../../resources/celldl/one_reaction.celldl'), 'utf8')
const DOCUMENT_URI = mintDocumentUri('rc.cellml:rc')

/** Runs `run` with happy-dom's DOMParser, XMLSerializer and Node in place of xmldom's. */
async function withHappyDom(run) {
  const window = new Window()
  const saved = { DOMParser: globalThis.DOMParser, XMLSerializer: globalThis.XMLSerializer, Node: globalThis.Node }
  Object.assign(globalThis, { DOMParser: window.DOMParser, XMLSerializer: window.XMLSerializer, Node: window.Node })
  try {
    return await run()
  } finally {
    Object.assign(globalThis, saved)
    await window.happyDOM.close()
  }
}

/** The fixture with absolute IRIs in `document`, as a file from another tool may have. */
const withAbsoluteIris = (celldl, document) =>
  celldl.replace('@prefix : <#> .', `@prefix : <${document}#> .`).replace('<> a celldl:Document', `<${document}> a celldl:Document`)

describe('convertCelldl', () => {
  let libcellml

  beforeAll(async () => {
    ;({ instance: libcellml } = await ensureLibCellmlReady())
  }, 120000)

  it('shares one converter', async () => {
    expect(await getConverter()).toBe(await getConverter())
  }, 120000)

  it('converts an RC circuit to a component of the given name, with its elements by SVG id', async () => {
    const result = await convertCelldl(RC, { documentUri: DOCUMENT_URI, componentName: 'rc' })

    expect(result).toMatchObject({ ok: true, errors: [], warnings: [], renamedUnits: {}, documentUri: DOCUMENT_URI })
    expect(result.generator).toEqual({ name: '@physiomelinks/bg2cellml', version: expect.any(String) })
    expect(result.frameworkVersion).toEqual(expect.any(String))
    expect(result.components.map((component) => component.name)).toEqual(['rc'])
    expect(result.unitsModel).toContain('<model ')
    expect(Object.keys(result.elements).sort()).toEqual(['I_R', 'R_0', 'V_C', 'V_in', 'q_1'])
    expect(result.elements.I_R).toMatchObject({ kind: 'one', primary: expect.any(String) })
    expect(result.annotations.I_R).toMatchObject({ primary: result.elements.I_R.primary, tooltip: expect.any(String) })
  }, 120000)

  it('gives a module that flattens and validates, and whose elements map to its rows', async () => {
    const result = await convertCelldl(RC, { documentUri: DOCUMENT_URI, componentName: 'rc' })
    setActivePinia(createPinia())
    const store = useLibraryStore()
    store.addUnitsFile({ componentFile: 'rc.cellml', model: result.unitsModel })
    store.addMathFile('rc.cellml', result.components)
    const mathRef = 'rc.cellml:rc'
    const rows = reconcileRows(analyzeMathXml(store.availableMath.get(mathRef)), [], {
      defaults: store.getMathDefaults(mathRef),
    })
    const node = { id: 'n1', type: 'instanceNode', data: { name: 'rc_1', mathRef, variables: rows, ports: [] } }

    const flat = await withHappyDom(async () => (await generateFlattenedModel([node], [], store)).text())

    const parser = new libcellml.Parser(false)
    const validator = new libcellml.Validator()
    validator.validateModel(parser.parseModel(flat))
    expect(validator.errorCount()).toBe(0)
    for (const id of Object.keys(result.elements)) {
      expect(rows.map((row) => row.name)).toContain(variableForElement(result.elements[id], rows))
    }
  }, 120000)

  it('passes warnings with its CellML', async () => {
    const result = await convertCelldl(fixture('rc_sine.celldl'), { documentUri: DOCUMENT_URI, componentName: 'rc' })

    expect(result.ok).toBe(true)
    expect(result.components).toHaveLength(1)
    expect(result.warnings).toEqual([expect.objectContaining({ severity: 'warning', stage: 'analyser' })])
  }, 120000)

  it("blocks a diagram that doesn't convert, naming the element at fault", async () => {
    const result = await convertCelldl(fixture('rc_unbonded.celldl'), { documentUri: DOCUMENT_URI, componentName: 'rc' })

    expect(result).toMatchObject({ ok: false, components: null, unitsModel: null })
    expect(result.errors).toEqual([expect.objectContaining({ severity: 'error', stage: 'model', elementId: 'V_C.L' })])
  }, 120000)

  it('blocks a component name that is not a CellML identifier', async () => {
    const result = await convertCelldl(RC, { documentUri: DOCUMENT_URI, componentName: '1 rc' })

    expect(result.ok).toBe(false)
    expect(result.errors).toEqual([expect.objectContaining({ stage: 'input' })])
  }, 120000)

  it("renames its units when the library's other units define the name differently", async () => {
    const own = await convertCelldl(RC, { documentUri: DOCUMENT_URI, componentName: 'rc' })
    const name = own.unitsModel.match(/<units name="([^"]+)"/)[1]
    const clash = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="other"><units name="${name}"><unit units="ampere"/><unit units="metre"/></units></model>`
    const availableUnits = [
      { componentFile: 'other.cellml', model: clash },
      { componentFile: 'rc.cellml', model: own.unitsModel },
    ]

    const result = await convertCelldl(RC, {
      documentUri: DOCUMENT_URI,
      componentName: 'rc',
      knownUnits: knownUnitsFor(availableUnits, 'rc.cellml'),
    })

    expect(result.ok).toBe(true)
    expect(result.renamedUnits).toEqual({ [name]: `${name}_1` })
  }, 120000)

  it('keeps the document IRI of a diagram with absolute IRIs, and the minted one otherwise', async () => {
    const document = 'https://example.org/models/rc.celldl'
    const result = await convertCelldl(withAbsoluteIris(RC, document), { documentUri: DOCUMENT_URI, componentName: 'rc' })

    expect(result.ok).toBe(true)
    expect(result.documentUri).toBe(document)
  }, 120000)

  it("lays a module's math out in its sections, each headed by a comment after a blank line", async () => {
    const result = await convertCelldl(ONE_REACTION, { documentUri: DOCUMENT_URI, componentName: 'one' })
    setActivePinia(createPinia())
    const store = useLibraryStore()
    store.addMathFile('one.cellml', result.components)

    const math = store.availableMath.get('one.cellml:one')
    // xmldom's DOM has no `children`, which the text generator needs, so the layout is built here with happy-dom's.
    const text = await withHappyDom(() => {
      const layout = sectionLayout(math, 'one', result.sections)
      return new CellMLTextGenerator({ simplified: true }).generateResult(math, { layout }).text
    })

    const lines = text.split('\n')
    const comments = lines.filter((line) => line.startsWith('//'))
    expect(comments).toEqual([
      '// Chemical potentials',
      '// Reaction affinities',
      '// Reaction flux',
      '// Species flux',
      '// Mass conservation',
    ])
    // Each but the first follows a blank line; the conservation section, last, holds the ODEs.
    comments.slice(1).forEach((comment) => expect(lines[lines.indexOf(comment) - 1]).toBe(''))
    expect(lines[0]).toBe('// Chemical potentials')
    expect(lines.slice(lines.indexOf('// Mass conservation') + 1).filter(Boolean).every((line) => line.startsWith('ode('))).toBe(true)
    // The CellML holds no comments: they are PhLynx's layout alone.
    expect(store.availableMath.get('one.cellml:one')).not.toContain('<!--')
  }, 120000)
})

describe('LOCAL_DOCUMENT_BASE', () => {
  it("is under bg2cellml's base for local models", async () => {
    const { LOCAL_MODEL_BASE } = await import('@physiomelinks/bg2cellml')
    expect(LOCAL_DOCUMENT_BASE).toBe(`${LOCAL_MODEL_BASE}phlynx/`)
  })
})

describe('knownUnitsFor', () => {
  it("lists every units file's CellML but the module's own", () => {
    const files = [
      { componentFile: 'a.cellml', model: 'A' },
      { componentFile: 'own.cellml', model: 'OWN' },
      { componentFile: 'b.cellml', model: 'B' },
    ]
    expect(knownUnitsFor(files, 'own.cellml')).toEqual(['A', 'B'])
    expect(knownUnitsFor(files)).toEqual(['A', 'OWN', 'B'])
    expect(knownUnitsFor(undefined, 'own.cellml')).toEqual([])
  })
})
