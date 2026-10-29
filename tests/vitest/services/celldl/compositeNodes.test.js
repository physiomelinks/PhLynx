// @vitest-environment node
// Diagrams with composite nodes (a storage, resistance or reaction element fused with its junction), as the CellDL
// editor saves them: listed as both bond elements and junctions. Node with xmldom's parser, as in convert.test.js.
import fs from 'node:fs'
import path from 'node:path'

import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { bgRdfFramework } from '@celldl/editor/bgrdf'
import { createConversionHandler, createConversionWorker } from '@physiomelinks/bg2cellml/worker'
import createLibCellML from 'libcellml.js'
import * as oxigraph from 'oxigraph'
import { Window } from 'happy-dom'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { createLiveCelldlConvert } from '../../../../src/composables/useLiveCelldlConvert.js'
import { convertCelldl } from '../../../../src/services/celldl/convert.js'
import { mintDocumentUri } from '../../../../src/services/celldl/documentUri.js'
import { buildInstance } from '../../../../src/services/import/buildWorkflow.js'
import { analyzeMathXml } from '../../../../src/services/math/analyzeMath.js'
import { useLibraryStore } from '../../../../src/stores/libraryStore.js'
import { generateFlattenedModel } from '../../../../src/utils/cellml.js'
import { ensureLibCellmlReady } from '../../helpers/libcellml-bootstrap.js'

globalThis.DOMParser ??= DOMParser
globalThis.XMLSerializer ??= XMLSerializer

const fixture = (name) => fs.readFileSync(path.resolve(__dirname, '../../fixtures/celldl', name), 'utf8')
/** The diagram's BG-RDF, which the editor host passes to live conversion. */
const turtleOf = (celldl) => celldl.match(/<!\[CDATA\[([\s\S]*?)\]\]>/)[1]
const WASM = path.resolve(process.cwd(), 'node_modules/libcellml.js/libcellml.wasm')

const DIAGRAMS = [
  {
    file: 'composite_rc.celldl',
    elements: ['ID-00000001', 'ID-00000002', 'ID-00000003'],
    variables: ['q_A_circ', 'q_B_circ', 'R_v_R_circ'],
  },
  {
    file: 'composite_chemical.celldl',
    elements: ['ID-00000001', 'ID-00000002', 'ID-00000003', 'ID-00000004', 'ID-00000005'],
    variables: ['q_A_cell', 'q_B_cell', 'kappa_Rx_r_cell'],
  },
]

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

/** A worker in this thread: bg2cellml's own message handler, with Node's libCellML and oxigraph. */
function inThreadWorker() {
  const handle = createConversionHandler({
    libcellml: () => createLibCellML({ locateFile: (file, prefix) => (file.endsWith('.wasm') ? WASM : prefix + file) }),
    oxigraph,
    domParser: new DOMParser(),
  })
  const listeners = { message: [], error: [] }
  return {
    postMessage(message) {
      handle(structuredClone(message)).then((reply) => {
        if (reply) listeners.message.forEach((listener) => listener({ data: structuredClone(reply) }))
      })
    },
    addEventListener(type, listener) {
      listeners[type].push(listener)
    },
    terminate() {},
  }
}

describe.each(DIAGRAMS)('a diagram with composite nodes: $file', ({ file, elements, variables }) => {
  const celldl = fixture(file)
  const name = file.replace('.celldl', '')
  const documentUri = mintDocumentUri(`${name}.cellml:${name}`)
  let libcellml
  let live

  beforeAll(async () => {
    ;({ instance: libcellml } = await ensureLibCellmlReady())
  }, 120000)

  afterEach(() => live?.stop())

  it('lists its composite nodes as junctions too, as the editor saves them', () => {
    const junctions = turtleOf(celldl).match(/bgf:hasJunctionStructure ([^.]+)\./)[1]
    expect(junctions).toContain(':ID-00000001')
    expect(turtleOf(celldl)).toMatch(/:ID-00000001 a celldl:Component, bgf:(ChemicalStorageNode|ElectricalCapacitiveNode)/)
  })

  it('converts, with an element for each of its nodes', async () => {
    const result = await convertCelldl(celldl, { documentUri, componentName: name })

    expect(result).toMatchObject({ ok: true, errors: [] })
    expect(Object.keys(result.elements).sort()).toEqual(elements)
  }, 120000)

  it('gives a module whose instance, placed as dropping it does, flattens and validates', async () => {
    const result = await convertCelldl(celldl, { documentUri, componentName: name })
    setActivePinia(createPinia())
    const store = useLibraryStore()
    store.addUnitsFile({ componentFile: `${name}.cellml`, model: result.unitsModel })
    store.addMathFile(`${name}.cellml`, result.components)
    const mathRef = `${name}.cellml:${name}`
    const module = [...store.availableModules.values()].find((candidate) => candidate.mathRef === mathRef)
    const analysis = analyzeMathXml(store.availableMath.get(mathRef))
    const node = buildInstance('n1', `${name}_1`, 'instanceNode', module, [], null, analysis, store.getMathDefaults(mathRef))

    const flat = await withHappyDom(async () => (await generateFlattenedModel([node], [], store)).text())

    const validator = new libcellml.Validator()
    validator.validateModel(new libcellml.Parser(false).parseModel(flat))
    expect(validator.errorCount()).toBe(0)
    expect(node.data.variables.map((row) => row.name)).toEqual(expect.arrayContaining(variables))
  }, 120000)

  it('converts live, in the worker, with neither pass finding an issue', async () => {
    let listener = null
    const host = {
      onChange: (next) => ((listener = next), () => (listener = null)),
      highlight: vi.fn(),
      setLiveAnnotations: vi.fn(),
    }
    live = createLiveCelldlConvert({
      host,
      createWorker: async (framework, knownUnits) =>
        createConversionWorker(inThreadWorker(), { framework, defaults: { knownUnits } }),
      loadFramework: async () => bgRdfFramework(),
      isAvailable: true,
      cheapDelay: 0,
      fullDelay: 0,
    })
    await live.start()

    listener({ rdf: turtleOf(celldl), documentUri, isOpened: true })

    await vi.waitFor(() => expect(live.latest.value?.pass).toBe('full'), { timeout: 60000, interval: 50 })
    expect(live.issues.value).toEqual([])
    expect(live.result.value.ok).toBe(true)
    expect(Object.keys(live.result.value.elements).sort()).toEqual(elements)
    expect(host.highlight).toHaveBeenLastCalledWith([], { isLive: true })
    await vi.waitFor(() => expect(host.setLiveAnnotations).toHaveBeenCalled())
  }, 120000)
})
