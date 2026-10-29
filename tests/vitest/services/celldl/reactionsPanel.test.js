// @vitest-environment node
// A diagram drawn in the CellDL editor's Reactions panel (0.20261007.0-phlynx.6): A + 2 B + ATP ⇌ C and
// C + ATP ⇌ D, each a composite ChemicalReactionNode bonded straight to its stores, B's coefficient a bondCount of
// 2, and the ATP chemostat a copy beside each reaction. bg2cellml 0.4.0 converts it, numbering the copy. Node with
// xmldom's parser, as in convert.test.js.
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

const DIAGRAM = fs.readFileSync(path.resolve(__dirname, '../../fixtures/celldl/reactions_panel.celldl'), 'utf8')
const NAME = 'reactions'
const MATH_REF = `${NAME}.cellml:${NAME}`
const STATES = ['q_A_c', 'q_B_c', 'q_C_c', 'q_D_c']
const SETTINGS = { ...BASELINE_SIMULATION_SETTINGS, endingPoint: 10, pointInterval: 0.1 }

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

describe('a diagram drawn in the Reactions panel', () => {
  let libcellml
  // One libOpenCOR for the file: a second instance in the same page breaks the first.
  let libOpenCOR
  let converted

  beforeAll(async () => {
    ;({ instance: libcellml } = await ensureLibCellmlReady())
    libOpenCOR = await createLibOpenCOR()
    converted = await convertAndFlatten()
  }, 120000)

  /**
   * Converts the diagram and flattens an instance of its module, placed as dropping it does.
   *
   * @returns {Promise<{result: Object, flat: string, node: Object}>}
   */
  async function convertAndFlatten() {
    const result = await convertCelldl(DIAGRAM, { documentUri: mintDocumentUri(MATH_REF), componentName: NAME })
    setActivePinia(createPinia())
    const store = useLibraryStore()
    store.addUnitsFile({ componentFile: `${NAME}.cellml`, model: result.unitsModel })
    store.addMathFile(`${NAME}.cellml`, result.components)
    const module = [...store.availableModules.values()].find((candidate) => candidate.mathRef === MATH_REF)
    const analysis = analyzeMathXml(store.availableMath.get(MATH_REF))
    const node = buildInstance('n1', `${NAME}_1`, 'instanceNode', module, [], null, analysis, store.getMathDefaults(MATH_REF))
    const flat = await withHappyDom(async () => (await generateFlattenedModel([node], [], store)).text())
    return { result, flat, node }
  }

  it('converts with the full checks, finding no issue', () => {
    expect(converted.result).toMatchObject({ ok: true, errors: [], warnings: [] })
  })

  it('numbers the chemostat copy the panel put beside the second reaction', () => {
    const { elements } = converted.result
    expect(elements['ID-00000007']).toMatchObject({ symbol: 'S_ATP_c', primary: 'u_S_ATP_c' })
    expect(elements['ID-00000013']).toMatchObject({ symbol: 'S_ATP_c_2', primary: 'u_S_ATP_c_2' })
    expect(converted.node.data.variables.map((row) => row.name)).toEqual(expect.arrayContaining(['u_S_ATP_c', 'u_S_ATP_c_2']))
  })

  it('takes B twice for each r1, from its bondCount of 2', () => {
    // B, bonded from its store to the reaction twice, loses twice the reaction's flow (written out in full).
    expect(converted.flat).toMatch(/<ci>v_q_B_c<\/ci>\s*<apply>\s*<minus\/>\s*<apply>\s*<times\/>\s*<cn[^>]*>2<\/cn>/)
    expect(converted.flat).not.toMatch(/<ci>v_q_A_c<\/ci>\s*<apply>\s*<minus\/>\s*<apply>\s*<times\/>\s*<cn[^>]*>2<\/cn>/)
  })

  it('gives a module whose instance flattens and validates, with a state for each species', () => {
    const parser = new libcellml.Parser(false)
    const model = parser.parseModel(converted.flat)
    const validator = new libcellml.Validator()
    validator.validateModel(model)
    const errorCount = validator.errorCount()
    ;[validator, model, parser].forEach((handle) => handle.delete())
    expect(errorCount).toBe(0)
    expect(converted.node.data.variables.map((row) => row.name)).toEqual(expect.arrayContaining(STATES))
  })

  it('runs in libOpenCOR, conserving A + C + D and B + 2 C + 2 D', async () => {
    const session = createSimulationSession({ module: libOpenCOR, cellml: converted.flat })
    try {
      const results = await session.run({ settings: SETTINGS }).promise
      const values = (state) => [...[...results.variables].find(([name]) => name.endsWith(`/${state}`))[1].values]
      const [A, B, C, D] = STATES.map(values)

      expect(A).toHaveLength(101)
      // To the solver's tolerance.
      A.forEach((a, i) => expect(a + C[i] + D[i]).toBeCloseTo(1.02, 5))
      B.forEach((b, i) => expect(b + 2 * C[i] + 2 * D[i]).toBeCloseTo(1.04, 5))
      // Both reactions run: A and B turn into C, and C into D.
      expect(A.at(-1)).toBeLessThan(0.95)
      expect(D.at(-1)).toBeGreaterThan(0.05)
    } finally {
      session.dispose()
    }
  }, 120000)
})
