import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { generateFlattenedModel, processCellMLData } from '../../../src/utils/cellml.js'
import { resolvePortCouplings } from '../../../src/utils/edges.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

// Every term of a generated sum is added, whether the Sum port is on the upstream
// (exit) or downstream (entrance) side, and whether or not the term comes through a
// Multiply port. The bundled microvasculature_network modules have
// dq_C/dt = v - v_out_sum, so v_out_sum must be the positive outflow.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const assetDir = path.resolve(__dirname, '../../../src/assets')
const readAsset = (name) => readFileSync(path.join(assetDir, name), 'utf8')

let libcellml

function loadLibrary(store) {
  const units = processCellMLData(readAsset('units/units.cellml'))
  store.addUnitsFile({ componentFile: 'units.cellml', model: units.units.model })
  const modules = processCellMLData(readAsset('modules/microvasculature_network_modules.cellml'))
  store.addMathFile('microvasculature_network_modules.cellml', modules.components)
  store.addConfigFile(
    'microvasculature_network.json',
    JSON.parse(readAsset('module_configs/microvasculature_network.json'))
  )
}

function makeNode(store, name, moduleRef) {
  const module = store.availableModules.get(moduleRef)
  return {
    id: name,
    data: {
      name,
      moduleRef,
      mathRef: module.mathRef,
      ports: JSON.parse(JSON.stringify(module.ports)),
      variables: module.variables.map((v) => ({ ...v })),
    },
  }
}

function connectAll(nodes, pairs) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const edges = []
  for (const [source, target] of pairs) {
    const sourceIndex = edges.filter((e) => e.source === source).length
    const targetIndex = edges.filter((e) => e.target === target).length
    const couplings = resolvePortCouplings(
      byId.get(source).data.ports,
      byId.get(target).data.ports,
      sourceIndex,
      targetIndex
    )
    edges.push({ id: `${source}--${target}`, source, target, data: { couplings } })
  }
  return edges
}

async function generate(nodes, edges, store) {
  const text = await generateFlattenedModel(nodes, edges, store).text()
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

function componentMath(model, name) {
  const component = model.componentByName(name, true)
  const math = component?.math() ?? ''
  component?.delete()
  return math
}

describe('whole-port Sum multiport sign convention', () => {
  let store

  beforeAll(async () => {
    ;({ instance: libcellml } = await ensureLibCellmlReady())
  }, 120000)

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    loadLibrary(store)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('makes an upstream Sum port the plus-sum of the downstream flows', async () => {
    const nodes = [
      makeNode(store, 'artery', 'artery_Nout:pv_micro'),
      makeNode(store, 'cap1', 'capillary:vp_micro'),
      makeNode(store, 'cap2', 'capillary:vp_micro'),
    ]
    const edges = connectAll(nodes, [
      ['artery', 'cap1'],
      ['artery', 'cap2'],
    ])

    const model = await generate(nodes, edges, store)

    const math = componentMath(model, 'generated_summations')
    expect(math).toMatch(/<plus\/>\s*<ci>op_v_in<\/ci>\s*<ci>op_v_in_1<\/ci>/)
    expect(math).not.toContain('<minus/>')
    expect(equivalent(model, ['generated_summations', 'sum_of_v_out_sum'], ['artery', 'v_out_sum'])).toBe(true)
    expect(equivalent(model, ['generated_summations', 'op_v_in'], ['cap1', 'v_in'])).toBe(true)
    expect(equivalent(model, ['generated_summations', 'op_v_in_1'], ['cap2', 'v_in'])).toBe(true)
    model.delete()
  })

  it('adds factor x variable when a Multiply port feeds a Sum port', async () => {
    const nodes = [
      makeNode(store, 'cap1', 'capillary:vp_micro'),
      makeNode(store, 'cap2', 'capillary:vp_micro'),
      makeNode(store, 'junction', 'artery_Min:vv_micro'),
    ]
    // cap1's outflow counts twice.
    const cap1Flow = nodes[0].data.ports.find((p) => p.portType === 'exit_ports' && p.label === 'flow_port')
    cap1Flow.multiportType = 'Multiply'
    cap1Flow.multiplyFactor = 2
    const edges = connectAll(nodes, [
      ['cap1', 'junction'],
      ['cap2', 'junction'],
    ])

    const model = await generate(nodes, edges, store)

    const multiplyMath = componentMath(model, 'generated_multiplications')
    expect(multiplyMath).toMatch(/<ci>scaled_v<\/ci>\s*<apply>\s*<times\/>\s*<cn[^>]*>2<\/cn>\s*<ci>in_v<\/ci>/)
    expect(equivalent(model, ['generated_multiplications', 'in_v'], ['cap1', 'v'])).toBe(true)

    const sumMath = componentMath(model, 'generated_summations')
    expect(sumMath).toMatch(/<plus\/>\s*<ci>op_v<\/ci>\s*<ci>op_scaled_v<\/ci>/)
    expect(sumMath).not.toContain('<minus/>')
    expect(equivalent(model, ['generated_summations', 'sum_of_v_in_sum'], ['junction', 'v_in_sum'])).toBe(true)
    expect(equivalent(model, ['generated_summations', 'op_scaled_v'], ['generated_multiplications', 'scaled_v'])).toBe(
      true
    )
    expect(equivalent(model, ['generated_summations', 'op_v'], ['cap2', 'v'])).toBe(true)
    model.delete()
  })
})
