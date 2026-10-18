// @vitest-environment happy-dom
import { nextTick, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const confirm = vi.fn(async () => true)
vi.mock('../../../src/composables/useConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm }) }))
vi.mock('../../../src/utils/notify', () => ({ notify: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warn: vi.fn() } }))
vi.mock('../../../src/utils/save', () => ({ getFileHandle: vi.fn(async () => ({ success: true, handle: {}, cleanName: 'model' })) }))
vi.mock('../../../src/services/compress', () => ({
  generateOmexArchive: vi.fn(async () => new Blob(['omex'])),
  createCellMLDataFragment: vi.fn(),
  createOmexDataFragment: vi.fn(),
}))
vi.mock('../../../src/utils/cellml', () => ({
  generateFlattenedModel: vi.fn(() => new Blob(['<model/>'])),
  extractVoiAndParametersFromModel: vi.fn(() => ({ voi: null, mappedParameters: {} })),
}))

const { useImportExportSend } = await import('../../../src/composables/useImportExportSend.js')
const { generateOmexArchive } = await import('../../../src/services/compress')
const { generateFlattenedModel } = await import('../../../src/utils/cellml')
const { notify } = await import('../../../src/utils/notify')
const { useLibraryStore } = await import('../../../src/stores/libraryStore.js')
const { useSimulationSettingsStore } = await import('../../../src/stores/simulationSettingsStore.js')
const { EXPORT_KEYS } = await import('../../../src/utils/constants.js')

const ODE_XML = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="decay">
  <component name="decay">
    <variable name="t" units="second"/>
    <variable name="x" units="dimensionless" initial_value="1"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply><apply><minus/><ci>x</ci></apply></apply>
    </math>
  </component>
</model>`

const flowPort = (portType, multiportType = 'None') => ({ portType, label: 'flow', variables: ['v'], multiportType })

/**
 * Creates a decay node with a flow port.
 *
 * @param {string} id
 * @param {Object} [options]
 * @returns {Object}
 */
function createNode(id, { vType = 'variable', ports = [flowPort('general_ports')] } = {}) {
  return {
    id,
    data: {
      name: id,
      mathRef: 'file:decay',
      variables: [
        { name: 'x', type: 'variable', units: 'dimensionless' },
        { name: 'v', type: vType, value: '', units: 'per_second' },
        { name: 'k', type: 'constant', value: '1', units: 'per_second' },
      ],
      ports,
    },
  }
}

const connect = (source, target) => ({
  id: `${source.id}_${target.id}`,
  source: source.id,
  target: target.id,
  data: { couplings: [{ sourcePort: source.data.ports[0], targetPort: target.data.ports[0] }] },
})

describe('useImportExportSend selection exports', () => {
  let nodes, edges, selectedNodeIds, snapshotFlowState, onExportConfirm

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useLibraryStore().addMath('file:decay', ODE_XML)
    nodes = ref([createNode('a'), createNode('b'), createNode('c')])
    edges = ref([connect(nodes.value[0], nodes.value[1]), connect(nodes.value[1], nodes.value[2])])
    selectedNodeIds = ref([])
    snapshotFlowState = vi.fn(() => '{}')
    onExportConfirm = vi.fn()
  })

  /**
   * Sets up the composable over the test's workspace.
   *
   * @param {string} [libcellmlStatus]
   * @returns {ReturnType<typeof useImportExportSend>}
   */
  function setup(libcellmlStatus = 'ready') {
    return useImportExportSend({
      libcellml: { status: libcellmlStatus },
      nodes,
      edges,
      importDialogVisible: ref(false),
      exportDialogVisible: ref(false),
      currentImportConfig: ref(null),
      onExportConfirm,
      hasModelChanged: ref(false),
      snapshotFlowState,
      selectedNodeIds,
    })
  }

  const menuItem = (items, label) => items.value.find((item) => item.label === label)

  it('offers the selection exports after a separator, only while something is selected', () => {
    const { exportMenuItems, sendMenuItems } = setup()

    const labels = exportMenuItems.value.map((item) => (item.separator ? '---' : item.label))
    expect(labels.slice(-3)).toEqual(['---', 'CellML (selection)', 'OpenCOR (selection)'])
    expect(menuItem(exportMenuItems, 'CellML (selection)').disabled).toBe(true)
    expect(menuItem(sendMenuItems, 'OpenCOR (selection)').disabled).toBe(true)

    selectedNodeIds.value = ['a']
    expect(menuItem(exportMenuItems, 'CellML (selection)').disabled).toBe(false)
    expect(menuItem(sendMenuItems, 'OpenCOR (selection)').disabled).toBe(false)
  })

  it('offers the Circulatory Autogen export once libCellML is ready, as it writes CellML', () => {
    expect(menuItem(setup('loading').exportMenuItems, 'Circulatory Autogen').disabled).toBe(true)
    expect(menuItem(setup().exportMenuItems, 'Circulatory Autogen').disabled).toBe(false)
    expect(menuItem(setup('loading').exportMenuItems, 'Circulatory Autogen (legacy CSV)').disabled).toBe(true)
    expect(menuItem(setup().exportMenuItems, 'Circulatory Autogen (legacy CSV)').disabled).toBe(false)
  })

  it('exports a selection that builds cleanly without asking', async () => {
    selectedNodeIds.value = ['a', 'b']
    const { exportMenuItems } = setup()

    await menuItem(exportMenuItems, 'CellML (selection)').command()

    expect(confirm).not.toHaveBeenCalled()
    expect(onExportConfirm).toHaveBeenCalled()
  })

  it('stops a selection that can’t be built, before asking where to save', async () => {
    nodes.value[0].data.variables[2].value = ''
    selectedNodeIds.value = ['a']
    const { exportMenuItems } = setup()

    await menuItem(exportMenuItems, 'CellML (selection)').command()

    expect(notify.error).toHaveBeenCalledWith(expect.objectContaining({ items: ['"a.k" needs a value.'] }))
    expect(onExportConfirm).not.toHaveBeenCalled()
  })

  it('asks before exporting a selection with warnings, going on only if accepted', async () => {
    nodes.value[1] = createNode('b', { vType: 'boundary_condition' })
    selectedNodeIds.value = ['b']
    const { exportMenuItems } = setup()

    confirm.mockResolvedValueOnce(false)
    await menuItem(exportMenuItems, 'CellML (selection)').command()
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('"b.v" has no value') }))
    expect(onExportConfirm).not.toHaveBeenCalled()

    confirm.mockResolvedValueOnce(true)
    await menuItem(exportMenuItems, 'CellML (selection)').command()
    expect(onExportConfirm).toHaveBeenCalled()
  })

  it('sets an unsupplied boundary condition to 0 in the selection’s CellML', async () => {
    nodes.value[1] = createNode('b', { vType: 'boundary_condition' })
    selectedNodeIds.value = ['b']
    const { exportMenuItems, currentExportMode } = setup()

    await menuItem(exportMenuItems, 'CellML (selection)').command()
    await currentExportMode.value.action('model')

    const [flattenedNodes] = generateFlattenedModel.mock.calls.at(-1)
    expect(flattenedNodes[0].data.variables.find((row) => row.name === 'v').value).toBe('0')
    expect(nodes.value[1].data.variables.find((row) => row.name === 'v').value).toBe('')
  })

  it('stops sending a selection that can’t be built, and reports a send that fails', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    nodes.value[0].data.variables[2].value = ''
    selectedNodeIds.value = ['a']
    const { sendMenuItems } = setup()

    await menuItem(sendMenuItems, 'OpenCOR (selection)').command()
    expect(notify.error).toHaveBeenCalledWith(expect.objectContaining({ title: 'Selection can’t be exported' }))
    expect(open).not.toHaveBeenCalled()

    nodes.value[0].data.variables[2].value = '1'
    generateFlattenedModel.mockImplementationOnce(() => {
      throw new Error('Analyser error count: 1')
    })
    await menuItem(sendMenuItems, 'OpenCOR (selection)').command()
    expect(notify.error).toHaveBeenLastCalledWith({ title: 'Send failed', items: ['Analyser error count: 1'] })
    expect(open).not.toHaveBeenCalled()
    open.mockRestore()
  })

  it('falls back to the last whole-model mode when the selection empties', async () => {
    selectedNodeIds.value = ['a']
    const { exportMenuItems, currentExportMode, currentExportDisabled } = setup()
    await menuItem(exportMenuItems, 'OpenCOR').command()
    await menuItem(exportMenuItems, 'CellML (selection)').command()
    expect(currentExportMode.value.key).toBe(EXPORT_KEYS.CELLML_SELECTION)

    selectedNodeIds.value = []
    await nextTick()
    expect(currentExportMode.value.key).toBe(EXPORT_KEYS.OMEX)
    expect(currentExportDisabled.value).toBe(false)
  })

  it('builds the selection’s archive from its own model, plots, scans and snapshot', async () => {
    selectedNodeIds.value = ['a', 'b']
    useSimulationSettingsStore().setPlotConfig({
      groups: [{ id: 'plot-1', name: 'Plot 1' }],
      selections: ['a', 'c'].map((id) => ({ key: `${id}::x`, nodeId: id, nodeName: id, variableName: 'x', units: '', type: 'variable', plot: true, groupId: 'plot-1' })),
    })
    useSimulationSettingsStore().setParameterScanConfig({
      selections: ['b', 'c'].map((id) => ({ key: `${id}::k`, nodeId: id, nodeName: id, parameterName: 'k', min: 0, default: 1, max: 2 })),
    })
    const { exportMenuItems, currentExportMode } = setup()

    await menuItem(exportMenuItems, 'OpenCOR (selection)').command()
    expect(currentExportMode.value.key).toBe(EXPORT_KEYS.OMEX_SELECTION)
    await currentExportMode.value.action('model')

    const [flattenedNodes, flattenedEdges] = generateFlattenedModel.mock.calls.at(-1)
    expect(flattenedNodes.map((node) => node.id)).toEqual(['a', 'b'])
    expect(flattenedEdges.map((edge) => edge.id)).toEqual(['a_b'])
    expect(snapshotFlowState).toHaveBeenCalledWith(['a', 'b'])

    const [, , simData, addInfo] = generateOmexArchive.mock.calls.at(-1)
    expect(simData.plotConfig.selections.map((selection) => selection.nodeId)).toEqual(['a'])
    expect(simData.parameterScanConfig.selections.map((selection) => selection.nodeId)).toEqual(['b'])
    expect(addInfo.modified).toBe(true)
  })

  it('keeps a slider’s stored name in a workspace without super instances, whatever its id', async () => {
    nodes.value = [{ ...createNode('old/id'), data: { ...createNode('old/id').data, name: 'renamed' } }]
    edges.value = []
    useSimulationSettingsStore().setParameterScanConfig({
      selections: [{ key: 'old/id::k', nodeId: 'old/id', nodeName: 'stored', parameterName: 'k', min: 0, default: 1, max: 2 }],
    })
    const { exportMenuItems, currentExportMode } = setup()

    await menuItem(exportMenuItems, 'OpenCOR').command()
    await currentExportMode.value.action('model')

    const [, , simData] = generateOmexArchive.mock.calls.at(-1)
    expect(simData.parameterScanConfig.selections.map((selection) => selection.nodeName)).toEqual(['stored'])
  })

  it('builds the whole model’s archive as before', async () => {
    const { exportMenuItems, currentExportMode } = setup()

    await menuItem(exportMenuItems, 'OpenCOR').command()
    expect(currentExportMode.value.key).toBe(EXPORT_KEYS.OMEX)
    await currentExportMode.value.action('model')

    const [flattenedNodes] = generateFlattenedModel.mock.calls.at(-1)
    expect(flattenedNodes).toHaveLength(3)
    expect(snapshotFlowState).toHaveBeenLastCalledWith(null)
  })
})
