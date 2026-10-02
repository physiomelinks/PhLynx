import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Papa from 'papaparse'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { generateFlattenedModel, processCellMLData } from '../../../src/utils/cellml.js'
import { resolvePortCouplings } from '../../../src/utils/edges.js'
import { applyParametersToNodes } from '../../../src/utils/parameters.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

// A parameter value on a variable that is fed through a connection is kept on
// the node but not emitted (as circulatory_autogen): otherwise libCellML sees two
// initial values, or an equation and an initial value, in one connected set.
// diffusion_volume files from physiomelinks/circulatory-autogen-modules.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const resourceDir = path.resolve(__dirname, '../../resources/module_library')
const readResource = (name) => readFileSync(path.join(resourceDir, name), 'utf8')

let libcellml

function loadLibrary(store) {
  for (const file of ['diffusion_volume_units.cellml', 'diffusion_volume_modules.cellml']) {
    const result = processCellMLData(readResource(file))
    expect(result.type).toBe('success')
    if (result.components?.length) store.addMathFile(file, result.components)
    if (result.units.count > 0) store.addUnitsFile({ componentFile: file, model: result.units.model })
  }
  store.addConfigFile(
    'diffusion_volume_modules_config.json',
    JSON.parse(readResource('diffusion_volume_modules_config.json'))
  )
}

// The library's parameters file, one row per instance (`<variable>_<instance>`), globals as they are.
function parameterRows(instances, extra = []) {
  const { data } = Papa.parse(readResource('diffusion_volume_parameters.csv'), { header: true, skipEmptyLines: true })
  const rows = []
  for (const row of data) {
    const base = { units: row.units, value: row.value, data_reference: 'test' }
    if (row.vessel_type === 'global') {
      rows.push({ ...base, variable_name: row.variable_name })
      continue
    }
    for (const [instance, moduleType] of Object.entries(instances)) {
      if (moduleType === row.vessel_type) rows.push({ ...base, variable_name: `${row.variable_name}_${instance}` })
    }
  }
  return [...rows, ...extra]
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

/** Initial values on the variable and on the variables it is directly connected to. */
function initialValuesAround(model, componentName, variableName) {
  const component = model.componentByName(componentName, true)
  const variable = component.variableByName(variableName)
  expect(variable, `${componentName}.${variableName}`).toBeTruthy()
  const values = []
  if (variable.initialValue() !== '') values.push(`${componentName}.${variableName}=${variable.initialValue()}`)
  for (let i = 0; i < variable.equivalentVariableCount(); i++) {
    const other = variable.equivalentVariable(i)
    if (other.initialValue() !== '') values.push(`${other.name()}=${other.initialValue()}`)
    other.delete()
  }
  variable.delete()
  component.delete()
  return values
}

function analyserErrors(model) {
  const analyser = new libcellml.Analyser()
  analyser.analyseModel(model)
  const errors = []
  for (let i = 0; i < analyser.errorCount(); i++) {
    const issue = analyser.error(i)
    errors.push(issue.description())
    issue.delete()
  }
  analyser.delete()
  return errors
}

describe('parameter values on connection-fed variables', () => {
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
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function twoVolumesThroughAFace(extraRows = []) {
    const nodes = [
      makeNode(store, 'va', 'tissue_diffusion_volume:nn'),
      makeNode(store, 'face', 'tissue_diffusion_face:nn'),
      makeNode(store, 'vb', 'tissue_diffusion_volume:nn'),
    ]
    const edges = connectAll(nodes, [
      ['va', 'face'],
      ['face', 'vb'],
    ])
    const rows = parameterRows(
      { va: 'tissue_diffusion_volume', face: 'tissue_diffusion_face', vb: 'tissue_diffusion_volume' },
      extraRows
    )
    applyParametersToNodes(nodes, rows, store)
    return { nodes, edges }
  }

  it('ignores the face C_up/C_down parameter values while they are connected', async () => {
    const { nodes, edges } = twoVolumesThroughAFace()
    const face = nodes[1]
    expect(face.data.variables.find((v) => v.name === 'C_up')).toMatchObject({ type: 'constant', value: '0.0597' })

    const model = await generate(nodes, edges, store) // throws on validation errors

    // Only the connected volume's state carries an initial value (C_P = C_P_init).
    expect(initialValuesAround(model, 'face', 'C_up')).toEqual(['C_P=C_P_init'])
    expect(initialValuesAround(model, 'face', 'C_down')).toEqual(['C_P=C_P_init'])
    expect(analyserErrors(model)).toEqual([])
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"face" variable "C_up" is set by a connection'))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"face" variable "C_down" is set by a connection'))

    // The node keeps its value: it is used again once disconnected.
    expect(face.data.variables.find((v) => v.name === 'C_up').value).toBe('0.0597')
    model.delete()
  })

  it('keeps the parameter value of an unconnected input', async () => {
    const { nodes, edges } = twoVolumesThroughAFace()

    const model = await generate(nodes, edges, store)

    expect(initialValuesAround(model, 'va', 'flux_c')).toEqual(['va_flux_c=4.46e-16'])
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('"flux_c"'))
    model.delete()
  })

  it('uses the face parameter values once the face is disconnected', async () => {
    const nodes = [makeNode(store, 'face', 'tissue_diffusion_face:nn')]
    applyParametersToNodes(nodes, parameterRows({ face: 'tissue_diffusion_face' }), store)

    const model = await generate(nodes, [], store)

    expect(initialValuesAround(model, 'face', 'C_up')).toEqual(['C_up=0.0597'])
    expect(initialValuesAround(model, 'face', 'C_down')).toEqual(['C_down=0.0597'])
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('is set by a connection'))
    model.delete()
  })

  it('gives a per-variable sum variable no initial value from a parameter', async () => {
    // J_in of vb sums the face's J_down; J_in of va sums nothing (0).
    const extra = ['va', 'vb'].map((instance) => ({
      variable_name: `J_in_${instance}`,
      units: 'mol_per_s',
      value: '1e-15',
      data_reference: 'test',
    }))
    const { nodes, edges } = twoVolumesThroughAFace(extra)

    const model = await generate(nodes, edges, store)

    expect(initialValuesAround(model, 'vb', 'J_in')).toEqual([])
    expect(initialValuesAround(model, 'va', 'J_in')).toEqual([])
    expect(analyserErrors(model)).toEqual([])
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"vb" variable "J_in" is set by a connection'))
    model.delete()
  })
})
