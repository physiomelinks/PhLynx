import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { generateFlattenedModel, processCellMLData } from '../../../src/utils/cellml.js'
import { checkAndClaimCouplings, resolvePortCouplings } from '../../../src/utils/edges.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

// cardiac_modules.cellml, cardiac_units.cellml and the resistor/flow_merge/flow_split
// configs (renamed to PhLynx's config keys) from physiomelinks/circulatory-autogen-modules,
// plus PhLynx's bundled BG vessel (arterial_simple:vp) as an ODE sink.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const resourceDir = path.resolve(__dirname, '../../resources/module_library')
const assetDir = path.resolve(__dirname, '../../../src/assets')
const readResource = (name) => readFileSync(path.join(resourceDir, name), 'utf8')
const readAsset = (name) => readFileSync(path.join(assetDir, name), 'utf8')

let libcellml

function loadLibrary(store) {
  for (const file of ['cardiac_units.cellml', 'cardiac_modules.cellml']) {
    const result = processCellMLData(readResource(file))
    expect(result.type).toBe('success')
    if (result.components?.length) store.addMathFile(file, result.components)
    if (result.units.count > 0) store.addUnitsFile({ componentFile: file, model: result.units.model })
  }
  store.addConfigFile('cardiac_modules_config.json', JSON.parse(readResource('cardiac_modules_config.json')))

  const units = processCellMLData(readAsset('units/units.cellml'))
  store.addUnitsFile({ componentFile: 'units.cellml', model: units.units.model })
  const bg = processCellMLData(readAsset('modules/BG_modules.cellml'))
  store.addMathFile('BG_modules.cellml', bg.components)
  store.addConfigFile('BG.json', JSON.parse(readAsset('module_configs/BG.json')))
}

const VESSEL_CONSTANTS = { I: 1e6, C: 1e-8, R: 1e7, q_0: 1e-4, u_0: 0, u_ext: 0 }

function makeNode(store, name, moduleRef, constants = {}) {
  const module = store.availableModules.get(moduleRef)
  return {
    id: name,
    data: {
      name,
      moduleRef,
      mathRef: module.mathRef,
      ports: JSON.parse(JSON.stringify(module.ports)),
      variables: module.variables.map((v) =>
        v.name in constants ? { ...v, type: 'constant', value: String(constants[v.name]) } : { ...v }
      ),
    },
  }
}

// Connects nodes as WorkspaceArea's onConnect does, enforcing the single-connection rule.
function connectAll(nodes, pairs) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const edges = []
  const used = new Set()
  for (const [source, target] of pairs) {
    const sourceIndex = edges.filter((e) => e.source === source).length
    const targetIndex = edges.filter((e) => e.target === target).length
    const couplings = resolvePortCouplings(byId.get(source).data.ports, byId.get(target).data.ports, sourceIndex, targetIndex)
    const check = checkAndClaimCouplings(source, target, couplings, used)
    expect(check.conflicts).toEqual([])
    edges.push({ id: `${source}--${target}`, source, target, data: { couplings } })
  }
  return edges
}

async function generate(nodes, edges, store) {
  const blob = generateFlattenedModel(nodes, edges, store)
  const text = await blob.text()
  const parser = new libcellml.Parser(false)
  const model = parser.parseModel(text)
  expect(parser.errorCount()).toBe(0)
  parser.delete()
  return model
}

function withVariable(model, componentName, variableName, fn) {
  const component = model.componentByName(componentName, true)
  expect(component, `component ${componentName}`).toBeTruthy()
  const v = component.variableByName(variableName)
  try {
    expect(v, `${componentName}.${variableName}`).toBeTruthy()
    return fn(v)
  } finally {
    v?.delete()
    component.delete()
  }
}

function equivalent(model, [c1, v1], [c2, v2]) {
  return withVariable(model, c1, v1, (a) => withVariable(model, c2, v2, (b) => a.hasEquivalentVariable(b, true)))
}

function sumComponentMath(model) {
  const component = model.componentByName('generated_summations', true)
  const math = component?.math() ?? ''
  component?.delete()
  return math
}

describe('per-variable (list-form) multi_port generation', () => {
  let store
  let warnSpy

  beforeAll(async () => {
    ;({ instance: libcellml } = await ensureLibCellmlReady())
  }, 120000)

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    loadLibrary(store)
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // generateFlattenedModel logs non-fatal analyser messages (the all-algebraic tests have some).
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sums v_in over two sources into flow_merge and shares u with both', async () => {
    // Two vessels (flow v is a state) into flow_merge, into a third vessel.
    const nodes = [
      makeNode(store, 'A', 'arterial_simple:vp', { ...VESSEL_CONSTANTS, v_in: 1e-6 }),
      makeNode(store, 'B', 'arterial_simple:vp', { ...VESSEL_CONSTANTS, v_in: 2e-6 }),
      makeNode(store, 'merge', 'flow_merge:vp'),
      makeNode(store, 'vessel', 'arterial_simple:vp', { ...VESSEL_CONSTANTS, u_out: 1000 }),
    ]
    const edges = connectAll(nodes, [
      ['A', 'merge'],
      ['B', 'merge'],
      ['merge', 'vessel'],
    ])

    const model = await generate(nodes, edges, store)

    // v_in = A.v + B.v, through the generated summation component.
    const math = sumComponentMath(model)
    expect(math).toContain('<plus/>')
    expect(math).not.toContain('<minus/>')
    expect(equivalent(model, ['generated_summations', 'sum_of_v_in'], ['merge', 'v_in'])).toBe(true)
    expect(equivalent(model, ['generated_summations', 'op_v'], ['A', 'v'])).toBe(true)
    expect(equivalent(model, ['generated_summations', 'op_v_1'], ['B', 'v'])).toBe(true)
    // v_in itself is not mapped straight to either source's v.
    expect(equivalent(model, ['merge', 'v_in'], ['A', 'v'])).toBe(false)

    // u is shared with both sources.
    expect(equivalent(model, ['merge', 'u'], ['A', 'u_out'])).toBe(true)
    expect(equivalent(model, ['merge', 'u'], ['B', 'u_out'])).toBe(true)

    // The plain exit port maps one-to-one.
    expect(equivalent(model, ['merge', 'v_out'], ['vessel', 'v_in'])).toBe(true)
    expect(equivalent(model, ['merge', 'u_d'], ['vessel', 'u'])).toBe(true)

    const validator = new libcellml.Validator()
    validator.validateModel(model)
    expect(validator.errorCount()).toBe(0)
    const analyser = new libcellml.Analyser()
    analyser.analyseModel(model)
    expect(analyser.errorCount()).toBe(0)
    const analysedModel = analyser.model()
    expect(analysedModel.type()).toBe(libcellml.AnalyserModel.Type.ODE)
    analysedModel.delete()
    validator.delete()
    analyser.delete()
    model.delete()

    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('sums over the neighbours on an exit port too (flow_split)', async () => {
    const nodes = [
      makeNode(store, 'R0', 'resistor:pp', { u_in: 3000, R: 1e7 }),
      makeNode(store, 'split', 'flow_split:pv'),
      makeNode(store, 'R1', 'resistor:pp', { u_out: 0, R: 1e7 }),
      makeNode(store, 'R2', 'resistor:pp', { u_out: 0, R: 2e7 }),
    ]
    const edges = connectAll(nodes, [
      ['R0', 'split'],
      ['split', 'R1'],
      ['split', 'R2'],
    ])

    const model = await generate(nodes, edges, store)

    expect(sumComponentMath(model)).not.toContain('<minus/>')
    expect(equivalent(model, ['generated_summations', 'sum_of_v_out'], ['split', 'v_out'])).toBe(true)
    expect(equivalent(model, ['split', 'u'], ['R1', 'u_in'])).toBe(true)
    expect(equivalent(model, ['split', 'u'], ['R2', 'u_in'])).toBe(true)
    // An all-algebraic network, so only validated (generateFlattenedModel throws on validation errors).
    model.delete()
  })

  it('sets an unconnected sum variable to 0 and warns', async () => {
    const nodes = [makeNode(store, 'merge', 'flow_merge:vp'), makeNode(store, 'R3', 'resistor:pp', { u_out: 0, R: 5e6 })]
    const edges = connectAll(nodes, [['merge', 'R3']])

    const model = await generate(nodes, edges, store)

    expect(equivalent(model, ['generated_summations', 'sum_of_v_in'], ['merge', 'v_in'])).toBe(true)
    expect(sumComponentMath(model)).toMatch(/<cn[^>]*>0<\/cn>/)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"merge" variable "v_in"'))
    model.delete()
  })
})
