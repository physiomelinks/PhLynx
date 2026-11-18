// @vitest-environment node
// A module run at steady state: its instances set to steady state flatten and simulate the reduced math, derived per
// math and setup and kept with the workspace, while full instances keep the full kinetics.
import fs from 'node:fs'
import path from 'node:path'

import createLibOpenCOR from '@opencor/libopencor'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { Window } from 'happy-dom'
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { findCaExportBlocker } from '../../../src/services/export/ca.js'
import { buildInstance } from '../../../src/services/import/buildWorkflow.js'
import { createSimulationSession } from '../../../src/services/simulation/engine.js'
import { buildScopeSignature, checkScope } from '../../../src/services/simulation/scopedModel.js'
import { nodeInKinetics, scopeWithKinetics } from '../../../src/services/steadyState/kineticsOverride.js'
import { steadyStateRows } from '../../../src/services/steadyState/steadyStateLibrary.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { generateFlattenedModel, processCellMLData } from '../../../src/utils/cellml.js'
import { BASELINE_SIMULATION_SETTINGS } from '../../../src/utils/constants.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

// libOpenCOR gives Node a global Worker, which the store would start the math and steady-state workers with; run
// them inline.
vi.mock('../../../src/services/math/mathWorkerClient.js', async () => {
  const { analyzeMathBatch } = await import('../../../src/services/math/analyzeMath.js')
  const analyzeBatchInBackground = async (items) => analyzeMathBatch(items)
  return { analyzeBatchInBackground, analyzeInBackground: async (xml) => (await analyzeBatchInBackground([{ key: '', xml }]))[0]?.analysis ?? null }
})
vi.mock('../../../src/services/steadyState/steadyStateClient.js', async () => {
  const { analyseSteadyState } = await import('../../../src/services/steadyState/steadyState.js')
  return { analyseSteadyStateInBackground: async (options) => analyseSteadyState(options) }
})

globalThis.DOMParser ??= DOMParser
globalThis.XMLSerializer ??= XMLSerializer

const GLUT2 = fs.readFileSync(path.resolve(__dirname, '../fixtures/steadyState/glut2.cellml'), 'utf8')
const MATH_REF = 'glut2.cellml:glut2'

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

describe('instances at steady state', () => {
  let libOpenCOR
  let store

  beforeAll(async () => {
    await ensureLibCellmlReady()
    libOpenCOR = await createLibOpenCOR()
  }, 120000)

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    const data = processCellMLData(GLUT2)
    expect(data.type).toBe('success')
    store.addUnitsFile({ componentFile: 'glut2.cellml', model: data.units.model })
    store.addMathFile('glut2.cellml', data.components)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  function makeNode(id) {
    const module = [...store.availableModules.values()].find((m) => m.mathRef === MATH_REF)
    return buildInstance(id, id, 'instanceNode', module, [], null, store.getMathAnalysis(MATH_REF), store.getMathDefaults(MATH_REF))
  }

  /** The node set to steady state, with its rows for the reduced math. */
  async function steady(node) {
    const entry = await withHappyDom(() => store.ensureSteadyState(MATH_REF))
    expect(entry.status).toBe('ready')
    node.data.kinetics = 'steady'
    node.data.variables = steadyStateRows(entry, node.data.variables, node.data.ports)
    return node
  }

  it('derives the reduced math, with defaults, for the math and its setup', async () => {
    const entry = await withHappyDom(() => store.ensureSteadyState(MATH_REF))
    expect(entry.message ?? '').toBe('')
    expect(entry.status).toBe('ready')
    expect(entry.xml).toContain('name="v_ss"')
    expect(entry.defaults.get('q_tot')).toBe('1')
    expect(store.getSteadyState(MATH_REF)).toBe(entry)
    // A new setup needs deriving again
    store.setSteadyStateConfig(MATH_REF, { ...entry.result.spec, label: 'GLUT2' })
    expect(store.getSteadyState(MATH_REF)).toBeNull()
    expect((await withHappyDom(() => store.ensureSteadyState(MATH_REF))).xml).toContain('name="v_GLUT2"')
  })

  it('keeps setups with the workspace and in undo entries', () => {
    const spec = { cycleStates: ['q_E1_E1', 'q_E2_E2', 'q_E3_E3', 'q_E4_E4'], flux: 'v_R1', label: 'GLUT2' }
    store.setSteadyStateConfig(MATH_REF, spec)
    const saved = JSON.parse(JSON.stringify(store.getState()))
    expect(saved.steadyStateConfigs).toEqual([[MATH_REF, spec]])
    const entry = store.getMathEntry(MATH_REF)
    store.setSteadyStateConfig(MATH_REF, null)
    store.restoreMathEntry(MATH_REF, entry)
    expect(store.getSteadyStateConfig(MATH_REF)).toEqual(spec)

    setActivePinia(createPinia())
    const loaded = useLibraryStore()
    loaded.loadState(saved)
    expect(loaded.getSteadyStateConfig(MATH_REF)).toEqual(spec)
    loaded.removeMath(MATH_REF)
    expect(loaded.getSteadyStateConfig(MATH_REF)).toBeNull()
  })

  it('flattens a steady-state instance with the reduced math, beside a full one', async () => {
    const full = makeNode('full')
    const reduced = await steady(makeNode('reduced'))
    expect(reduced.data.variables.map((row) => row.name)).toContain('q_tot')
    expect(reduced.data.variables.map((row) => row.name)).not.toContain('q_E1_E1')

    const scope = { nodes: [full, reduced], internalEdges: [], allNodes: [full, reduced], allEdges: [], inspectionModules: [] }
    expect(checkScope(scope, store).incompleteNodes).toEqual([])
    const flat = await withHappyDom(async () => (await generateFlattenedModel([full, reduced], [], store, [], { check: true })).text())
    expect(flat).toMatch(/<component name="reduced"[\s\S]*?name="v_ss"/)
    expect(flat).toMatch(/<component name="full"[\s\S]*?name="q_E1_E1"/)

    // The scope's signature follows the mode
    const before = buildScopeSignature(scope, store)
    reduced.data.kinetics = undefined
    expect(buildScopeSignature(scope, store)).not.toBe(before)
  }, 60000)

  it('runs the steady state, matching the full kinetics once they settle', async () => {
    // Scarce transporter, as the steady state assumes (Briggs–Haldane): 0.001 mol in each of its four states
    const full = makeNode('full')
    for (const row of full.data.variables) if (/^q_E\d_E\d(_init)?$/.test(row.name) && row.value !== '') row.value = '0.001'
    const reduced = await steady(makeNode('reduced'))
    reduced.data.variables.find((row) => row.name === 'q_tot').value = '0.004'
    const flat = await withHappyDom(async () => (await generateFlattenedModel([full, reduced], [], store)).text())
    const session = createSimulationSession({ module: libOpenCOR, cellml: flat })
    try {
      const settings = { ...BASELINE_SIMULATION_SETTINGS, endingPoint: 100, pointInterval: 1 }
      const results = await session.run({ settings }).promise
      const last = (name) => results.variables.get(name).values.at(-1)
      // Once the transporter settles, the full cycle's flux is the steady-state flux
      expect(last('reduced/v_ss')).toBeGreaterThan(0)
      expect(Math.abs(last('full/v_R1') - last('reduced/v_ss')) / last('reduced/v_ss')).toBeLessThan(0.01)
    } finally {
      session.dispose()
    }
  }, 120000)

  it('runs an instance in the other kinetics for one run, keeping its own values', async () => {
    const full = makeNode('n')
    // Scarce transporter in this instance: 0.001 mol in each state, so its total is 0.004
    for (const row of full.data.variables) if (/^q_E\d_E\d(_init)?$/.test(row.name) && row.value !== '') row.value = '0.001'
    const asSteady = await withHappyDom(() => nodeInKinetics(full, 'steady', store))
    expect(asSteady).not.toBe(full)
    expect(full.data.kinetics).toBeUndefined()
    expect(asSteady.data.kinetics).toBe('steady')
    expect(asSteady.data.variables.find((row) => row.name === 'q_tot').value).toBe('0.004')
    expect(asSteady.data.kineticsStash.variables).toBe(full.data.variables)
    // And back: its full rows, as kept
    const back = await nodeInKinetics(asSteady, 'full', store)
    expect(back.data.kinetics).toBeUndefined()
    expect(back.data.variables).toBe(full.data.variables)

    const scope = { nodes: [full], internalEdges: [], allNodes: [full], allEdges: [], inspectionModules: [] }
    const swapped = await withHappyDom(() => scopeWithKinetics(scope, new Map([['n', 'steady']]), store))
    expect(swapped.nodes[0].data.kinetics).toBe('steady')
    expect(swapped.allNodes[0]).toBe(swapped.nodes[0])
    const flat = await withHappyDom(async () => (await generateFlattenedModel(swapped.nodes, [], store)).text())
    expect(flat).toContain('name="v_ss"')
  }, 60000)

  it('reports a steady-state instance whose steady state isn’t derived yet, and blocks the CA export', () => {
    const node = makeNode('reduced')
    node.data.kinetics = 'steady'
    const scope = { nodes: [node], internalEdges: [], allNodes: [node], allEdges: [], inspectionModules: [] }
    expect(checkScope(scope, store).incompleteNodes[0].reason).toMatch(/steady state/)
    expect(findCaExportBlocker([node], [], store)).toMatch(/steady-state instances/)
  })
})
