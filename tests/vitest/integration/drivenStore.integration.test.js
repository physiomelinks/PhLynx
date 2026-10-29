// @vitest-environment node
// A CellDL store's amount set from another module: a coupling marked drivesState drops the instance's own dq/dt and
// initial value, so the store follows what it is coupled to. Node with xmldom's parser, as in enzymeComposite.test.js.
import fs from 'node:fs'
import path from 'node:path'

import createLibOpenCOR from '@opencor/libopencor'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { Window } from 'happy-dom'
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { convertCelldl } from '../../../src/services/celldl/convert.js'
import { mintDocumentUri } from '../../../src/services/celldl/documentUri.js'
import { resolveBoundaryValues, storeOptions } from '../../../src/services/export/boundaryValues.js'
import { buildInstance } from '../../../src/services/import/buildWorkflow.js'
import { createSimulationSession } from '../../../src/services/simulation/engine.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { generateFlattenedModel, processCellMLData } from '../../../src/utils/cellml.js'
import { BASELINE_SIMULATION_SETTINGS } from '../../../src/utils/constants.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

// libOpenCOR gives Node a global Worker, which the library store would start the math worker with; analyse inline.
vi.mock('../../../src/services/math/mathWorkerClient.js', async () => {
  const { analyzeMathBatch } = await import('../../../src/services/math/analyzeMath.js')
  const analyzeBatchInBackground = async (items) => analyzeMathBatch(items)
  return { analyzeBatchInBackground, analyzeInBackground: async (xml) => (await analyzeBatchInBackground([{ key: '', xml }]))[0]?.analysis ?? null }
})

globalThis.DOMParser ??= DOMParser
globalThis.XMLSerializer ??= XMLSerializer

const ENZYME = fs.readFileSync(path.resolve(__dirname, '../../resources/celldl/enzyme.celldl'), 'utf8')
const SETTINGS = { ...BASELINE_SIMULATION_SETTINGS, endingPoint: 4, pointInterval: 1 }
// What the source module computes: X(t) = X0 (1 + sin t), with X0 = 0.5.
const EXPECTED_X = [0, 1, 2, 3, 4].map((t) => 0.5 * (1 + Math.sin(t)))

/** A module computing X(t) in the store's units, with no ODE of its own. */
const sourceMath = (units) => `<model xmlns="http://www.cellml.org/cellml/2.0#" name="source">
  <component name="source">
    <variable name="t" units="second" interface="public"/>
    <variable name="X" units="${units}" interface="public"/>
    <variable name="X0" units="${units}" interface="public" initial_value="0.5"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML" xmlns:cellml="http://www.cellml.org/cellml/2.0#">
      <apply><eq/><ci>X</ci><apply><times/><ci>X0</ci><apply><plus/><cn cellml:units="dimensionless">1</cn>
        <apply><sin/><apply><divide/><ci>t</ci><cn cellml:units="second">1</cn></apply></apply></apply></apply></apply>
    </math>
  </component>
</model>`

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

const port = (variable) => ({ portType: 'general_ports', label: 'link', variables: [variable], multiportType: 'None' })

describe('a CellDL store driven by a connection', () => {
  let libOpenCOR
  let converted
  let store

  beforeAll(async () => {
    await ensureLibCellmlReady()
    libOpenCOR = await createLibOpenCOR()
    converted = await convertCelldl(ENZYME, { documentUri: mintDocumentUri('enzyme.cellml:enzyme'), componentName: 'enzyme' })
    expect(converted.ok).toBe(true)
  }, 120000)

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    store.addUnitsFile({ componentFile: 'enzyme.cellml', model: converted.unitsModel })
    store.addMathFile('enzyme.cellml', converted.components)
    store.setMathSource('enzyme.cellml:enzyme', { format: 'celldl', document: ENZYME, documentUri: 'urn:test' })
    const units = store.availableModules.get([...store.availableModules.keys()].find((ref) => ref.includes('enzyme')))
      .variables.find((row) => row.name === 'q_S_c').units
    const source = processCellMLData(sourceMath(units))
    expect(source.type).toBe('success')
    store.addMathFile('source.cellml', source.components)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  function makeNode(id, mathRef, ports) {
    const module = { ...[...store.availableModules.values()].find((m) => m.mathRef === mathRef), ports }
    return buildInstance(id, id, 'instanceNode', module, [], null, store.getMathAnalysis(mathRef), store.getMathDefaults(mathRef))
  }

  /** Two enzymes and a source, the source coupled to enzyme_1's q_S_c, marked as driving it or not. */
  function workspace(drivesState) {
    const enzyme1 = makeNode('enzyme_1', 'enzyme.cellml:enzyme', [port('q_S_c')])
    const enzyme2 = makeNode('enzyme_2', 'enzyme.cellml:enzyme', [])
    const source = makeNode('source_1', 'source.cellml:source', [port('X')])
    const coupling = { sourcePort: source.data.ports[0], targetPort: enzyme1.data.ports[0], ...(drivesState && { drivesState: true }) }
    const edge = { id: 'e1', source: 'source_1', target: 'enzyme_1', data: { couplings: [coupling] } }
    return { nodes: [enzyme1, enzyme2, source], edges: [edge] }
  }

  async function run(nodes, edges) {
    const flat = await withHappyDom(async () => (await generateFlattenedModel(nodes, edges, store, [], { check: true })).text())
    const session = createSimulationSession({ module: libOpenCOR, cellml: flat })
    try {
      const results = await session.run({ settings: SETTINGS }).promise
      const values = (name) => {
        const hit = results.variables.get(name)
        if (!hit) throw new Error(`${name} not in ${[...results.variables.keys()].join(", ")}`)
        return [...hit.values]
      }
      return { flat, values }
    } finally {
      session.dispose()
    }
  }

  it('rejects the coupling unmarked, saying confirming it can drive the store', async () => {
    const { nodes, edges } = workspace(false)
    const resolved = resolveBoundaryValues(nodes, edges, store.getMathAnalysis, storeOptions(store))
    expect(resolved.drivable).toEqual([expect.objectContaining({ nodeId: 'enzyme_1', name: 'q_S_c', from: ['source_1.X'] })])
    await expect(withHappyDom(() => generateFlattenedModel(nodes, edges, store))).rejects.toThrow(/drive the store enzyme_1\.q_S_c/)
  })

  it('marks the store set by the connection and its initial value ignored', () => {
    const { nodes, edges } = workspace(true)
    const resolved = resolveBoundaryValues(nodes, edges, store.getMathAnalysis, storeOptions(store))
    expect(resolved.overdetermined).toEqual([])
    expect(resolved.driven.get('enzyme_1').get('q_S_c')).toEqual({ initialiser: 'q_S_c_init', from: ['source_1.X'] })
    expect(resolved.status.get('enzyme_1').get('q_S_c')).toEqual({ state: 'connected', from: ['source_1.X'] })
    expect(resolved.status.get('enzyme_1').get('q_S_c_init')).toEqual({ state: 'drivenInitial', from: ['source_1.X'] })
    expect(resolved.ignored.get('enzyme_1')).toContain('q_S_c_init')
    expect(resolved.driven.has('enzyme_2')).toBe(false)
  })

  it('runs with the store following the connection, and other instances left alone', async () => {
    const { nodes, edges } = workspace(true)
    const { flat, values } = await run(nodes, edges)

    // The driven q_S_c is equivalent to X, which the run reports it as; the store's potential follows it.
    const X = values('source_1/X')
    X.forEach((value, i) => expect(value).toBeCloseTo(EXPECTED_X[i], 5))
    const row = (name) => Number(nodes[0].data.variables.find((candidate) => candidate.name === name).value)
    values('enzyme_1/u_q_S_c').forEach((u, i) => expect(u).toBeCloseTo(row('RT') * Math.log(row('K_q_S_c') * X[i]), 3))
    // The other instance keeps its own dynamics: S falls from 1 as the enzyme turns it into product.
    const otherS = values('enzyme_2/q_S_c')
    expect(otherS[0]).toBeCloseTo(1, 5)
    expect(otherS.at(-1)).toBeLessThan(0.95)
    // Only the driven copy lost its ODE.
    expect(flat.match(/<\/bvar>\s*<ci>q_S_c<\/ci>/g)?.length).toBe(1)
  }, 120000)

  it('runs the store on its own dynamics again once the connection is gone', async () => {
    const { nodes } = workspace(true)
    const { values } = await run(nodes, [])

    const S = values('enzyme_1/q_S_c')
    expect(S[0]).toBeCloseTo(1, 5)
    expect(S.at(-1)).toBeLessThan(0.95)
  }, 120000)
})
