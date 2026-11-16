// @vitest-environment node
// An enzyme reaction, E + S ⇌ C ⇌ E + P, drawn two ways: with its reactions bonded straight to composite storage
// nodes (a storage fused with its 0-junction), as the CellDL editor draws it, and with a 0-junction beside each
// storage. bg2cellml 0.3.2 converts the first; both should give the same model. Node with xmldom's parser, as in
// convert.test.js.
import fs from 'node:fs'
import path from 'node:path'

import createLibOpenCOR from '@opencor/libopencor'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { Window } from 'happy-dom'
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { convertCelldl } from '../../../../src/services/celldl/convert.js'
import { mintDocumentUri } from '../../../../src/services/celldl/documentUri.js'
import { buildInstance } from '../../../../src/services/import/buildWorkflow.js'
import { analyzeMathXml } from '../../../../src/services/math/analyzeMath.js'
import { createSimulationSession } from '../../../../src/services/simulation/engine.js'
import { useLibraryStore } from '../../../../src/stores/libraryStore.js'
import { generateFlattenedModel } from '../../../../src/utils/cellml.js'
import { BASELINE_SIMULATION_SETTINGS } from '../../../../src/utils/constants.js'
import { ensureLibCellmlReady } from '../../helpers/libcellml-bootstrap.js'

// libOpenCOR gives Node a global Worker, which the library store would start the math worker with; analyse inline.
vi.mock('../../../../src/services/math/mathWorkerClient.js', async () => {
  const { analyzeMathBatch } = await import('../../../../src/services/math/analyzeMath.js')
  const analyzeBatchInBackground = async (items) => analyzeMathBatch(items)
  return { analyzeBatchInBackground, analyzeInBackground: async (xml) => (await analyzeBatchInBackground([{ key: '', xml }]))[0]?.analysis ?? null }
})

globalThis.DOMParser ??= DOMParser
globalThis.XMLSerializer ??= XMLSerializer

const fixture = (name) => fs.readFileSync(path.resolve(__dirname, '../../fixtures/celldl', name), 'utf8')
const STATES = ['q_S_c', 'q_E_c', 'q_C_c', 'q_P_c']
const SETTINGS = { ...BASELINE_SIMULATION_SETTINGS, endingPoint: 10, pointInterval: 0.1 }

const DIAGRAMS = [
  { file: 'enzyme_composite_direct.celldl', drawn: 'bonded straight to composite stores' },
  { file: 'enzyme_canonical.celldl', drawn: 'with a 0-junction beside each store' },
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

describe('an enzyme reaction', () => {
  let libcellml
  // One libOpenCOR for the file: a second instance in the same page breaks the first.
  let libOpenCOR
  // Each drawing's states' values over the run, by name.
  const runs = {}

  beforeAll(async () => {
    ;({ instance: libcellml } = await ensureLibCellmlReady())
    libOpenCOR = await createLibOpenCOR()
  }, 120000)

  /**
   * Converts a diagram and flattens an instance of its module, placed as dropping it does.
   *
   * @param {string} file
   * @returns {Promise<{result: Object, flat: string, node: Object}>}
   */
  async function convertAndFlatten(file) {
    const name = 'enzyme'
    const result = await convertCelldl(fixture(file), { documentUri: mintDocumentUri(`${name}.cellml:${name}`), componentName: name })
    setActivePinia(createPinia())
    const store = useLibraryStore()
    store.addUnitsFile({ componentFile: `${name}.cellml`, model: result.unitsModel })
    store.addMathFile(`${name}.cellml`, result.components)
    const mathRef = `${name}.cellml:${name}`
    const module = [...store.availableModules.values()].find((candidate) => candidate.mathRef === mathRef)
    const analysis = analyzeMathXml(store.availableMath.get(mathRef))
    const node = buildInstance('n1', `${name}_1`, 'instanceNode', module, [], null, analysis, store.getMathDefaults(mathRef))
    const flat = await withHappyDom(async () => (await generateFlattenedModel([node], [], store)).text())
    return { result, flat, node }
  }

  describe.each(DIAGRAMS)('drawn $drawn', ({ file }) => {
    it('converts with the full checks, finding no issue', async () => {
      const { result } = await convertAndFlatten(file)

      expect(result).toMatchObject({ ok: true, errors: [], warnings: [] })
    }, 120000)

    it('gives a module whose instance flattens and validates, with a state for each species', async () => {
      const { flat, node } = await convertAndFlatten(file)

      const parser = new libcellml.Parser(false)
      const model = parser.parseModel(flat)
      const validator = new libcellml.Validator()
      validator.validateModel(model)
      const errorCount = validator.errorCount()
      ;[validator, model, parser].forEach((handle) => handle.delete())
      expect(errorCount).toBe(0)
      expect(node.data.variables.map((row) => row.name)).toEqual(expect.arrayContaining(STATES))
    }, 120000)

    it('runs in libOpenCOR, conserving the enzyme (E + C) and the substrate (S + C + P)', async () => {
      const { flat } = await convertAndFlatten(file)
      const session = createSimulationSession({ module: libOpenCOR, cellml: flat })
      try {
        const results = await session.run({ settings: SETTINGS }).promise
        const values = (state) => [...[...results.variables].find(([name]) => name.endsWith(`/${state}`))[1].values]
        const [S, E, C, P] = STATES.map(values)
        runs[file] = { S, E, C, P }

        expect(S).toHaveLength(101)
        // To the solver's tolerance.
        E.forEach((e, i) => expect(e + C[i]).toBeCloseTo(0.1, 5))
        S.forEach((s, i) => expect(s + C[i] + P[i]).toBeCloseTo(1, 5))
        // The reaction runs: substrate turns into product, through the complex.
        expect(Math.max(...C)).toBeGreaterThan(0.01)
        expect(S.at(-1)).toBeLessThan(0.7)
        expect(P.at(-1)).toBeGreaterThan(0.3)
      } finally {
        session.dispose()
      }
    }, 120000)
  })

  it('runs the same either way it is drawn', () => {
    const [direct, canonical] = DIAGRAMS.map(({ file }) => runs[file])
    for (const state of ['S', 'E', 'C', 'P']) {
      direct[state].forEach((value, i) => expect(value).toBeCloseTo(canonical[state][i], 5))
    }
  })
})
