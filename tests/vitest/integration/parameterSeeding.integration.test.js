// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { patchUnderscoreTagSelectors } from '../helpers/happyDom.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

// The canvas, stubbed: createInstanceNode hands its node to addNodes.
const canvas = vi.hoisted(() => ({ addNodes: vi.fn() }))
vi.mock('@vue-flow/core', async (importOriginal) => {
  const { computed } = await import('vue')
  return {
    ...(await importOriginal()),
    useVueFlow: () => ({
      getNodes: computed(() => []),
      addNodes: canvas.addNodes,
      updateNode: vi.fn(),
      screenToFlowCoordinate: (p) => p,
      onNodesInitialized: () => ({ off: vi.fn() }),
    }),
  }
})

const { default: useDragAndDrop } = await import('../../../src/composables/useDnD.js')
const { useParametersImport } = await import('../../../src/composables/useParametersImport.js')
const { prepareCellmlImport } = await import('../../../src/services/import/prepareCellml.js')
const { useDefaultParametersStore } = await import('../../../src/stores/defaultParametersStore.js')
const { useLibraryStore } = await import('../../../src/stores/libraryStore.js')
const { processCellMLData } = await import('../../../src/utils/cellml.js')
const { parseParametersJson } = await import('../../../src/utils/parameters/parse.js')

const resourceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../resources/parameters')
const readResource = (name) => readFileSync(path.join(resourceDir, name), 'utf8')

describe('enterocyte parameter seeding', () => {
  let restoreSelectors

  beforeAll(async () => {
    restoreSelectors = patchUnderscoreTagSelectors()
    await ensureLibCellmlReady()
  }, 120000)

  afterAll(() => restoreSelectors?.())

  beforeEach(() => {
    setActivePinia(createPinia())
    canvas.addNodes.mockClear()
  })

  /** Loads NKA's math, config and parameters as a folder import does, parameters first. */
  async function loadNkaFolder() {
    const library = useLibraryStore()
    const deps = { nodes: ref([]), recordEdit: async ({ apply }) => apply(), confirm: vi.fn(), choose: vi.fn() }
    const file = await parseParametersJson(readResource('NKA_parameters.json'), 'NKA_parameters.json')
    await useParametersImport(deps).importParameterFile(file, 'NKA_parameters.json', { record: false })

    const processed = processCellMLData(prepareCellmlImport(readResource('NKA.cellml'), 'NKA.cellml'))
    expect(processed.type).toBe('success')
    library.addMathFile('NKA.cellml', processed.components)
    library.addUnitsFile({ componentFile: 'NKA.cellml', model: processed.units.model })
    library.addConfigFile('NKA_NKA_modules_config.json', JSON.parse(readResource('NKA_NKA_modules_config.json')))
    return { library, file }
  }

  it('seeds a dragged NKA with the values of NKA_parameters.json and registers its globals', async () => {
    const { library, file } = await loadNkaFolder()
    expect(useDefaultParametersStore().getSet('NKA.cellml:NKA', 'NKA')).not.toBeNull()

    const module = library.availableModules.get('NKA:NKA')
    useDragAndDrop(new Set()).createInstanceNode(module, { x: 0, y: 0 })
    const [[node]] = canvas.addNodes.mock.calls

    expect(node.data.parameterisation).toBe('NKA')
    const rows = new Map(node.data.variables.map((row) => [row.name, row]))
    const applied = [...file.values].filter(([name]) => rows.has(name) && rows.get(name).type !== 'variable')
    expect(applied.length).toBeGreaterThan(20)
    for (const [name, param] of applied) expect([name, rows.get(name).value]).toEqual([name, param.value])

    for (const name of ['F', 'RT', 'RTF']) {
      if (rows.has(name)) expect(library.getGlobalConstant(name)?.value).toBe(file.globals.get(name).value)
    }
    expect(library.getGlobalConstant('F')?.value).toBe('96485.3321')
  })
})
