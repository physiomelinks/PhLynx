// @vitest-environment happy-dom
/**
 * The Circulatory Autogen exports' menu entries: the native one checks the model, then asks once for every super-module's
 * identity before asking where to save, and writes from the store's super-modules; the flat one asks nothing and writes the model.
 */
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/composables/useConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm: vi.fn(async () => true) }) }))
vi.mock('../../../src/utils/notify', () => ({ notify: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() } }))
vi.mock('../../../src/utils/save', () => ({ getFileHandle: vi.fn(async () => ({ success: true, handle: {}, cleanName: 'model' })) }))
vi.mock('../../../src/services/export/ca', async (original) => ({ ...(await original()), generateExportZip: vi.fn(async () => new Blob(['zip'])) }))

const { useImportExportSend } = await import('../../../src/composables/useImportExportSend.js')
const { generateExportZip } = await import('../../../src/services/export/ca')
const { notify } = await import('../../../src/utils/notify')
const { exposed, exposures, module, port, superInstance, supermodule } = await import('../fixtures/hierarchy/graph.js')

describe('the Circulatory Autogen exports of a workspace with a super-module', () => {
  let store
  let ask
  let save
  let onExportConfirm

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    const child = module('p', 'p', { scope: 'sm_1', ports: [port('exit_ports', 'flow', ['v'])] })
    const sm = supermodule('sm_1', 'pump', { submoduleOrder: ['p'] })
    const exposure = exposures('sm_1', [exposed('xp_0', 'p', 'exit_ports', 'flow')])
    store = { nodes: [superInstance({ nodes: [sm, child], edges: exposure }, 'dndnode_0', 'pump', 'sm_1'), sm, child], edges: exposure }
    ask = vi.fn(async (requests) => new Map(requests.map((request) => [request.smId, request.suggestion])))
    save = vi.fn(async () => true)
    onExportConfirm = vi.fn()
  })

  const setup = (options = {}) =>
    useImportExportSend({
      libcellml: { status: 'ready' },
      nodes: ref([]),
      edges: ref([]),
      importDialogVisible: ref(false),
      exportDialogVisible: ref(false),
      currentImportConfig: ref(null),
      onExportConfirm,
      hasModelChanged: ref(false),
      snapshotFlowState: vi.fn(),
      selectedNodeIds: ref([]),
      isHierarchical: ref(true),
      storeGraph: () => store,
      caIdentities: { ask, save },
      ...options,
    })
  const menuItem = (items, label) => items.value.find((item) => item.label === label)

  it('offers the native, flat and legacy CSV exports', () => {
    const labels = setup().exportMenuItems.value.map((item) => item.label)
    expect(labels).toEqual(expect.arrayContaining(['Circulatory Autogen', 'Circulatory Autogen (flat)', 'Circulatory Autogen (legacy CSV)']))
  })

  it('asks for the identities in one question, and stores them only once the export is written', async () => {
    const exports = setup()
    await menuItem(exports.exportMenuItems, 'Circulatory Autogen').command()
    expect(ask).toHaveBeenCalledTimes(1)
    const [requests, problemsOf] = ask.mock.calls[0]
    expect(requests.map((request) => [request.smId, request.name, request.reason, request.suggestion])).toEqual([
      ['sm_1', 'pump', 'new', { module_type: 'pump', module_subtype: 'phlynx_v1' }],
    ])
    // The prompt checks what is typed.
    expect(problemsOf(new Map([['sm_1', { module_type: 'pump', module_subtype: 'phlynx_v1' }]])).get('sm_1')).toBeNull()
    expect(problemsOf(new Map([['sm_1', { module_type: 'a pump', module_subtype: 'phlynx_v1' }]])).get('sm_1')).toBeTruthy()
    expect(onExportConfirm).toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()

    await exports.currentExportMode.value.action('model')
    const { arrayFormat, hierarchy } = generateExportZip.mock.calls.at(-1)[5]
    expect(arrayFormat).toBe('json')
    expect(hierarchy.edges).toBe(store.edges)
    // Written with the identity given, before it is stored.
    expect(hierarchy.nodes.find((node) => node.id === 'sm_1').data.supermodule.ca).toEqual({ module_type: 'pump', module_subtype: 'phlynx_v1' })
    expect(save).toHaveBeenCalledWith(new Map([['sm_1', { module_type: 'pump', module_subtype: 'phlynx_v1' }]]))
  })

  it('stores no identity when the export fails', async () => {
    const exports = setup()
    await menuItem(exports.exportMenuItems, 'Circulatory Autogen').command()
    generateExportZip.mockRejectedValueOnce(new Error('stopped'))
    await expect(exports.currentExportMode.value.action('model')).rejects.toThrow('stopped')
    expect(save).not.toHaveBeenCalled()
  })

  it('cancels the export when the question is cancelled, storing none', async () => {
    ask.mockResolvedValue(null)
    await menuItem(setup().exportMenuItems, 'Circulatory Autogen').command()
    expect(save).not.toHaveBeenCalled()
    expect(onExportConfirm).not.toHaveBeenCalled()
  })

  it('exports flat when asked to, storing none', async () => {
    ask.mockResolvedValue(new Map())
    const exports = setup()
    await menuItem(exports.exportMenuItems, 'Circulatory Autogen').command()
    expect(onExportConfirm).toHaveBeenCalled()
    await exports.currentExportMode.value.action('model')
    expect(generateExportZip.mock.calls.at(-1)[5].hierarchy.nodes).toBe(store.nodes)
    expect(save).not.toHaveBeenCalled()
  })

  it('asks nothing of a model the export would stop on', async () => {
    const exports = setup({ modelErrors: ref([{ severity: 'error', message: 'Super instance "pump" is broken.' }]) })
    await menuItem(exports.exportMenuItems, 'Circulatory Autogen').command()
    expect(ask).not.toHaveBeenCalled()
    expect(onExportConfirm).not.toHaveBeenCalled()
    expect(notify.error).toHaveBeenCalledTimes(1)
  })

  it("shows the export's warnings and notes as one summary, escaped and sticky when several", async () => {
    generateExportZip.mockImplementationOnce(async (...args) => {
      const { report } = args[5]
      report.warnings.push({ title: 'Missing Units', items: ['<b>mmHg</b>'] })
      report.infos.push({ title: 'Module Variants', items: ['lv differs.'] })
      return new Blob(['zip'])
    })
    const exports = setup()
    await menuItem(exports.exportMenuItems, 'Circulatory Autogen (flat)').command()
    await exports.currentExportMode.value.action('model')
    expect(notify.info).not.toHaveBeenCalled()
    expect(notify.warning).toHaveBeenCalledTimes(1)
    expect(notify.warning).toHaveBeenCalledWith(
      expect.objectContaining({ items: ['Missing Units: <b>mmHg</b>', 'Module Variants: lv differs.'], sticky: true })
    )
  })

  it('asks nothing for the flat export, and writes the model', async () => {
    const exports = setup()
    await menuItem(exports.exportMenuItems, 'Circulatory Autogen (flat)').command()
    expect(ask).not.toHaveBeenCalled()
    await exports.currentExportMode.value.action('model')
    expect(generateExportZip.mock.calls.at(-1)[5]).toEqual({ arrayFormat: 'json', hierarchy: null, report: expect.any(Object) })
  })
})
