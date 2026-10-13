import { readFileSync } from 'node:fs'
import path from 'node:path'

import Papa from 'papaparse'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildInstance } from '../../../src/services/import/buildWorkflow.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { generateFlattenedModel, processCellMLData } from '../../../src/utils/cellml.js'
import { resolvePortCouplings } from '../../../src/utils/edges.js'
import { applyParametersToNodes } from '../../../src/utils/parameters.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

// A loaded parameter value never changes a row's type, so a connected boundary condition's value stays a fallback
// the connection overrides (as in circulatory_autogen); otherwise libcellml finds two initial values in one
// connected set. diffusion_volume files from physiomelinks/circulatory-autogen-modules, via #604.
const resourceDir = path.resolve(process.cwd(), 'tests/resources/module_library')
const readResource = (name) => readFileSync(path.join(resourceDir, name), 'utf8')
const VOLUME = 'tissue_diffusion_volume'
const FACE = 'tissue_diffusion_face'

let libcellml

function loadLibrary(store) {
  for (const file of ['diffusion_volume_units.cellml', 'diffusion_volume_modules.cellml']) {
    const result = processCellMLData(readResource(file))
    expect(result.type).toBe('success')
    if (result.components?.length) store.addMathFile(file, result.components)
    if (result.units.count > 0) store.addUnitsFile({ componentFile: file, model: result.units.model })
  }
  store.addConfigFile('diffusion_volume_modules_config.json', JSON.parse(readResource('diffusion_volume_modules_config.json')))
}

/** The library's parameters file, one row per instance (`<variable>_<instance>`); globals go to the store. */
function loadParameters(store, nodes, moduleTypes) {
  const { data } = Papa.parse(readResource('diffusion_volume_parameters.csv'), { header: true, skipEmptyLines: true })
  const rows = []
  for (const row of data) {
    if (row.vessel_type === 'global') {
      store.assignGlobalConstant(row.variable_name, row.value, row.units)
      continue
    }
    for (const node of nodes) {
      if (moduleTypes[node.id] === row.vessel_type) {
        rows.push({ variable_name: `${row.variable_name}_${node.id}`, units: row.units, value: row.value, data_reference: 'test' })
      }
    }
  }
  const { variablesById } = applyParametersToNodes(nodes, rows)
  for (const node of nodes) if (variablesById.has(node.id)) node.data.variables = variablesById.get(node.id)
}

/** A node built from its module, as one dropped on the canvas is. */
function makeNode(store, name, moduleType) {
  const module = store.availableModules.get(`${moduleType}:nn`)
  return buildInstance(name, name, 'instanceNode', module, [], null, store.getMathAnalysis(module.mathRef), store.getMathDefaults(module.mathRef))
}

function connect(nodes, source, target) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const couplings = resolvePortCouplings(byId.get(source).data.ports, byId.get(target).data.ports, 0, 0)
  return { id: `${source}--${target}`, source, target, data: { couplings } }
}

async function flatten(nodes, edges, store) {
  const parser = new libcellml.Parser(false)
  const model = parser.parseModel(await generateFlattenedModel(nodes, edges, store).text())
  expect(parser.errorCount()).toBe(0)
  parser.delete()
  return model
}

/** Initial values on a variable and on those it is directly connected to. */
function initialValuesAround(model, componentName, variableName) {
  const component = model.componentByName(componentName, true)
  const variable = component.variableByName(variableName)
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

describe('parameter values on variables a connection supplies', () => {
  let store
  let warn

  beforeAll(async () => {
    ;({ instance: libcellml } = await ensureLibCellmlReady())
  }, 120000)

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    loadLibrary(store)
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function twoVolumesThroughAFace() {
    const nodes = [makeNode(store, 'va', VOLUME), makeNode(store, 'face', FACE), makeNode(store, 'vb', VOLUME)]
    loadParameters(store, nodes, { va: VOLUME, face: FACE, vb: VOLUME })
    return { nodes, edges: [connect(nodes, 'va', 'face'), connect(nodes, 'face', 'vb')] }
  }

  it("keeps the face's boundary conditions as such, and the connection supplies them", async () => {
    const { nodes, edges } = twoVolumesThroughAFace()
    const face = nodes[1]
    expect(face.data.variables.find((v) => v.name === 'C_up')).toMatchObject({ type: 'boundary_condition', value: '0.0597' })

    const model = await flatten(nodes, edges, store) // analyses with libcellml, and throws on its errors

    // Only each volume's state carries an initial value.
    expect(initialValuesAround(model, 'face', 'C_up')).toEqual(['C_P=C_P_init'])
    expect(initialValuesAround(model, 'face', 'C_down')).toEqual(['C_P=C_P_init'])
    expect(face.data.variables.find((v) => v.name === 'C_up').value).toBe('0.0597')
    model.delete()
  })

  it('uses the value of a boundary condition nothing is connected to', async () => {
    const { nodes, edges } = twoVolumesThroughAFace()
    const model = await flatten(nodes, edges, store)
    expect(initialValuesAround(model, 'va', 'flux_c')).toEqual(['va_flux_c=4.46e-16'])
    model.delete()
  })

  it("uses the face's values once it is disconnected", async () => {
    // The volume, left unconnected, gives the model the ODE that clocks the face.
    const nodes = [makeNode(store, 'va', VOLUME), makeNode(store, 'face', FACE)]
    loadParameters(store, nodes, { va: VOLUME, face: FACE })
    const model = await flatten(nodes, [], store)
    expect(initialValuesAround(model, 'face', 'C_up')).toEqual(['C_up=0.0597'])
    expect(initialValuesAround(model, 'face', 'C_down')).toEqual(['C_down=0.0597'])
    model.delete()
  })

  it('ignores a constant a connection supplies, as an older load left, with a warning', async () => {
    const { nodes, edges } = twoVolumesThroughAFace()
    const face = nodes[1]
    face.data.variables = face.data.variables.map((v) => (v.name === 'C_up' ? { ...v, type: 'constant' } : v))

    const model = await flatten(nodes, edges, store)

    expect(initialValuesAround(model, 'face', 'C_up')).toEqual(['C_P=C_P_init'])
    expect(warn).toHaveBeenCalledWith('"face" variable "C_up" is set by a connection; ignoring its parameter value 0.0597.')
    model.delete()
  })

  it('sets a Sum variable nothing is connected to to 0, ignoring its value', async () => {
    const { nodes, edges } = twoVolumesThroughAFace()
    const va = nodes[0]
    va.data.variables = va.data.variables.map((v) => (v.name === 'J_in' ? { ...v, value: '1e-15' } : v))

    const model = await flatten(nodes, edges, store)

    expect(initialValuesAround(model, 'va', 'J_in')).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/"va" variable "J_in" .* ignoring its value 1e-15 and setting it to 0/))
    model.delete()
  })

  it('rejects boundary conditions coupled only to each other', () => {
    const faces = [makeNode(store, 'f1', FACE), makeNode(store, 'f2', FACE)]
    loadParameters(store, faces, { f1: FACE, f2: FACE })
    expect(() => generateFlattenedModel(faces, [connect(faces, 'f1', 'f2')], store)).toThrow(
      /Boundary conditions connected only to each other, so nothing computes them: f1\.C_down, f2\.C_up\./
    )
  })
})
