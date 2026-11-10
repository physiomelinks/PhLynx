// @vitest-environment happy-dom
import { defineComponent, h, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import ToastEventBus from 'primevue/toasteventbus'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { useFlowHistoryStore } from '../../../src/stores/historyStore.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

const confirm = vi.fn(async () => true)
const alert = vi.fn(async () => true)
const choose = vi.fn(async () => 'accept')
const flowNodes = ref([])
const flowEdges = ref([])
vi.mock('../../../src/composables/useConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm, alert, choose }) }))
vi.mock('@vue-flow/core', async (importOriginal) => {
  const { computed } = await import('vue')
  return {
    ...(await importOriginal()),
    useVueFlow: () => ({ nodes: flowNodes, edges: flowEdges, getSelectedNodes: computed(() => []) }),
  }
})
vi.mock('../../../src/utils/layout', () => ({ waitUntilStable: () => Promise.resolve() }))
const run = vi.hoisted(() => vi.fn())
// The shown results' staleness, which a test sets.
const simulation = vi.hoisted(() => ({ isStale: null }))
vi.mock('../../../src/composables/useSimulation', async () => {
  const { ref } = await import('vue')
  simulation.isStale = ref(false)
  return { useSimulation: () => ({ run, stop: vi.fn(), keepCurrent: vi.fn(), isStale: simulation.isStale }) }
})
const convertCelldl = vi.hoisted(() => vi.fn())
vi.mock('../../../src/services/celldl/convert.js', () => ({ convertCelldl, knownUnitsFor: () => [], knownUnitsForModule: () => [] }))
vi.mock('../../../src/services/simulation/libopencorLoader', () => ({ libopencor: { status: 'ready' } }))

const { default: InstanceEditorDialog } = await import('../../../src/components/InstanceEditorDialog.vue')
const { default: ComponentSaveAsDialog } = await import('../../../src/components/dialogs/ComponentSaveAsDialog.vue')
const { default: ModuleConfigSaveDialog } = await import('../../../src/components/dialogs/ModuleConfigSaveDialog.vue')
const { buildInstance } = await import('../../../src/services/import/buildWorkflow.js')
const { default: ParameterSetSaveDialog } = await import('../../../src/components/dialogs/ParameterSetSaveDialog.vue')
const { NEW_MODULE_MATH_REF } = await import('../../../src/utils/constants.js')
const { cycleMultiportType } = await import('../../../src/utils/multiport.js')
const { default: AnnotationTab } = await import('../../../src/components/annotations/AnnotationTab.vue')
const { default: AnnotationChips } = await import('../../../src/components/AnnotationChips.vue')
const { default: PortVariableSelect } = await import('../../../src/components/PortVariableSelect.vue')
const { findSidecarPortChanges } = await import('../../../src/services/annotations/reconcileNodes.js')
const { setDraftEntry, setDraftKind, setDraftSpaceKind } = await import('../../../src/services/annotations/draft.js')
const { parseSidecar } = await import('../../../src/services/annotations/sidecar.js')
const { stripIds, variableIdsOf } = await import('../../../src/services/math/variableIds.js')
const { notify } = await import('../../../src/utils/notify.js')
const { useCelldlEditorHost } = await import('../../../src/composables/useCelldlEditorHost.js')
const { useLiveCelldlConvert } = await import('../../../src/composables/useLiveCelldlConvert.js')
const { useDefaultParametersStore } = await import('../../../src/stores/defaultParametersStore.js')

const MATH_REF = 'file:decay'
const XML = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="decay">
  <component name="decay">
    <variable name="t" units="second" interface="public_and_private"/>
    <variable name="x" units="metre" initial_value="x0"/>
    <variable name="x0" units="metre" initial_value="1"/>
    <variable name="k" units="per_second" initial_value="0.5"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/>
        <apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply>
        <apply><times/><apply><minus/><ci>k</ci></apply><ci>x</ci></apply>
      </apply>
    </math>
  </component>
</model>`
const EDITED_XML = XML.replace('<apply><minus/><ci>k</ci></apply>', '<apply><minus/><cn>1</cn></apply>')
// The math with ids on its annotated variables, which sidecar subjects name.
const withId = (xml, name, id) => xml.replace(`<variable name="${name}"`, `<variable id="${id}" name="${name}"`)
const X_IDS_XML = withId(XML, 'x', 'vdecayx01')
const X_SUBJECT = 'https://phlynx.invalid/modules/file#vdecayx01'

const setText = vi.fn()
const setModel = vi.fn()
const getErrors = vi.fn(() => [])

/** Stands in for CellMLTextEditor: the test emits its events and watches what the session asks of it. */
const FakeEditor = defineComponent({
  emits: ['change', 'undo', 'redo', 'variable-click'],
  setup(_, { expose }) {
    expose({ format: 'mathml', setText, setModel, flush: () => {}, getErrors, focus: () => {} })
    return () => h('div')
  },
})

/** Stands in for CelldlPane, which shows the app's CellDL editor. */
const CelldlPaneStub = defineComponent({
  name: 'CelldlPane',
  emits: ['variable-click'],
  setup() {
    return () => h('div', { class: 'celldl-pane-stub' })
  },
})

/** Stands in for the CellDL Parameters tab, which the dialog shows for a diagram's module. */
const CelldlParametersTabStub = defineComponent({
  name: 'CelldlParametersTab',
  props: ['table', 'savedDefaults', 'isDiagramShown', 'isOpening'],
  emits: ['set-value', 'show-in-diagram'],
  setup() {
    return () => h('div', { class: 'celldl-parameters-stub' })
  },
})

const ParameterTableStub = defineComponent({
  setup(_, { expose }) {
    expose({ flushPendingRenames: () => {} })
    return () => h('div')
  },
})

const DialogStub = defineComponent({
  setup(_, { slots }) {
    return () => h('div', [slots.header?.(), slots.default?.(), slots.footer?.()])
  },
})

const ensureResults = vi.fn()

/** Stands in for SimulationPanel: the test reads the props the dialog gives it. */
const SimulationPanelStub = defineComponent({
  name: 'SimulationPanel',
  props: ['instanceId', 'plotConfig', 'isUnitFiltered'],
  emits: ['update:plotConfig'],
  setup(_, { expose, slots }) {
    expose({ ensureResults })
    return () => h('div', { class: 'simulation-panel-stub' }, slots.toolbar?.())
  },
})

let wrapper
afterEach(() => wrapper?.unmount())

/**
 * Mounts the dialog closed, with the editors stubbed.
 *
 * @param {Object} [props] - Props beyond the defaults.
 * @param {{isPanelReal?: boolean}} [options] - `isPanelReal` mounts the Plot tab's SimulationPanel rather than a stub.
 * @returns {import('@vue/test-utils').VueWrapper}
 */
function mountDialog(props = {}, { isPanelReal = false } = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
  wrapper = mount(InstanceEditorDialog, {
    props: { modelValue: false, id: 'a', initialName: 'a', mathRef: MATH_REF, ...props },
    global: {
      plugins: [PrimeVue, router],
      stubs: {
        Dialog: DialogStub,
        CellMLTextEditor: FakeEditor,
        MathWorkbenchEditor: FakeEditor,
        CelldlPane: CelldlPaneStub,
        ParameterTable: ParameterTableStub,
        CelldlParametersTab: CelldlParametersTabStub,
        ...(isPanelReal ? { SimulationPlot: true, FeaturePlot: true } : { SimulationPanel: SimulationPanelStub }),
      },
      directives: { tooltip: {} },
    },
  })
  return wrapper
}

/**
 * Opens the dialog and waits for its editor to mount.
 *
 * @returns {Promise<import('@vue/test-utils').VueWrapper>} The editor.
 */
async function open() {
  await wrapper.setProps({ modelValue: true })
  await vi.waitFor(() => expect(wrapper.findComponent(FakeEditor).exists()).toBe(true))
  return wrapper.findComponent(FakeEditor)
}

/**
 * Reports a change from the editor and waits for the session to record it.
 *
 * @param {import('@vue/test-utils').VueWrapper} editor
 * @param {'init'|'edit'} source
 * @param {string} xml
 */
async function report(editor, source, xml) {
  editor.vm.$emit('change', { source, format: 'mathml', text: xml, valid: true, xml })
  await flushPromises()
}

describe('InstanceEditorDialog undo (#605)', () => {
  beforeAll(async () => {
    await ensureLibCellmlReady()
  })

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useLibraryStore().addMath(MATH_REF, XML)
  })

  it('does not undo canvas actions', async () => {
    const canvasCommand = { undo: vi.fn(), redo: vi.fn() }
    await useFlowHistoryStore().executeAndAddCommand(canvasCommand)
    mountDialog()
    const editor = await open()
    await report(editor, 'init', XML)
    await report(editor, 'edit', EDITED_XML)

    editor.vm.$emit('undo')
    editor.vm.$emit('undo')
    await flushPromises()
    expect(canvasCommand.undo).not.toHaveBeenCalled()
    expect(useFlowHistoryStore().canUndo).toBe(true)
  })

  it('does not replay an earlier open’s edits', async () => {
    mountDialog()
    let editor = await open()
    await report(editor, 'init', XML)
    await report(editor, 'edit', EDITED_XML)
    await wrapper.setProps({ modelValue: false })

    editor = await open()
    await report(editor, 'init', XML)
    vi.clearAllMocks()
    editor.vm.$emit('undo')
    await flushPromises()
    expect(setModel).not.toHaveBeenCalled()
    expect(setText).not.toHaveBeenCalled()
  })

  it('leaves the library to the workspace on Save, sending the whole change', async () => {
    const library = useLibraryStore()
    const stored = library.availableMath.get(MATH_REF)
    const constant = { name: 'x0', units: 'metre', type: 'global_constant', data_reference: 'Smith2020' }
    mountDialog({ initialName: 'renamed', variables: [constant] })
    const editor = await open()
    await report(editor, 'init', XML)
    await report(editor, 'edit', EDITED_XML)

    await wrapper.findAll('button').find((button) => button.text() === 'Save').trigger('click')
    await flushPromises()

    expect(library.availableMath.get(MATH_REF)).toBe(stored)
    expect(library.getGlobalConstant('x0')).toBeUndefined()
    const [save] = wrapper.emitted('confirm')[0]
    expect(save).toMatchObject({
      id: 'a',
      name: 'renamed',
      mathRef: MATH_REF,
      previousMathRef: MATH_REF,
      isLayoutChanged: false,
      updateAll: true,
      ports: [],
      globalConstants: [{ name: 'x0', units: 'metre', data_reference: 'Smith2020', overwrite: true }],
    })
    expect(save.math).toContain('<cn>1</cn>')
    expect(save.variables.find((row) => row.name === 'x0')).toMatchObject({ type: 'global_constant' })
  })

  it('saves an annotated port, which has no label', async () => {
    const annotated = {
      portType: 'general_ports',
      label: '',
      variables: ['x'],
      multiportType: 'True',
      annotation: { subject: 'decay.cellml#decay.x', variable: 'x', role: 'owner', source: { kind: 'sidecar' } },
    }
    const blank = { portType: 'general_ports', label: '', variables: [] }
    mountDialog({ initialPorts: [annotated, blank] })
    const editor = await open()
    await report(editor, 'init', XML)

    await wrapper.findAll('button').find((button) => button.text() === 'Save').trigger('click')
    await flushPromises()

    const [save] = wrapper.emitted('confirm')[0]
    expect(save.ports).toEqual([annotated])
  })
})

describe('InstanceEditorDialog math shared with other instances', () => {
  const OTHER_REF = 'file:other'

  beforeAll(async () => {
    await ensureLibCellmlReady()
  })

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useLibraryStore().addMath(MATH_REF, XML)
    flowNodes.value = [
      { id: 'a', data: { name: 'a', mathRef: MATH_REF } },
      { id: 'b', data: { name: 'b', mathRef: MATH_REF } },
    ]
  })

  afterEach(() => {
    flowNodes.value = []
  })

  const checkbox = () => wrapper.find('#applyToAll')
  const saveAsDialog = () => wrapper.findComponent(ComponentSaveAsDialog)

  /**
   * Opens the dialog, edits the math, optionally unticks the box, and clicks Save.
   *
   * @param {{untick?: boolean, xml?: string}} [options]
   */
  async function editAndSave({ untick = false, xml = EDITED_XML } = {}) {
    mountDialog()
    const editor = await open()
    await report(editor, 'init', XML)
    await report(editor, 'edit', xml)
    if (untick) await checkbox().setValue(false)
    await wrapper.findAll('button').find((button) => button.text() === 'Save').trigger('click')
    await flushPromises()
  }

  it('ticks the box by default, and again on each open', async () => {
    mountDialog()
    await open()
    expect(checkbox().element.checked).toBe(true)
    await checkbox().setValue(false)
    await wrapper.setProps({ modelValue: false })
    await open()
    expect(checkbox().element.checked).toBe(true)
  })

  it('overwrites the math in place for every instance when ticked', async () => {
    await editAndSave()
    expect(choose).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('affect 1 other instance.') }))
    expect(saveAsDialog().exists()).toBe(false)
    const [save] = wrapper.emitted('confirm')[0]
    expect(save).toMatchObject({ mathRef: MATH_REF, updateAll: true, siblings: ['b'] })
  })

  it('asks for a new component when unticked, leaving the other instances on the old math', async () => {
    await editAndSave({ untick: true })
    expect(choose).not.toHaveBeenCalled()
    expect(saveAsDialog().props('message')).toContain('1 other instance uses decay')
    expect(saveAsDialog().props('isTaken')('decay')).toContain('used by the other instances')
    expect(wrapper.emitted('confirm')).toBeUndefined()

    saveAsDialog().vm.$emit('confirm', 'decay_a')
    await flushPromises()
    const [save] = wrapper.emitted('confirm')[0]
    expect(save).toMatchObject({ mathRef: 'file:decay_a', previousMathRef: MATH_REF, updateAll: false, siblings: [] })
    expect(save.math).toContain('<component name="decay_a"')
    expect(save.math).toContain('<cn>1</cn>')
  })

  it('saves nothing when the new component is cancelled', async () => {
    await editAndSave({ untick: true })
    saveAsDialog().vm.$emit('cancel')
    await flushPromises()
    expect(wrapper.emitted('confirm')).toBeUndefined()
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('asks for a new component when unticked and renamed to math other instances use', async () => {
    useLibraryStore().addMath(OTHER_REF, XML.replace(/"decay"/g, '"other"'))
    flowNodes.value = [...flowNodes.value, { id: 'c', data: { name: 'c', mathRef: OTHER_REF } }]
    await editAndSave({ untick: true, xml: EDITED_XML.replace(/"decay"/g, '"other"') })
    expect(saveAsDialog().props('message')).toContain('1 other instance uses other')
  })

  it('counts every instance an overwrite of other math changes', async () => {
    useLibraryStore().addMath(OTHER_REF, XML.replace(/"decay"/g, '"other"'))
    flowNodes.value = [...flowNodes.value, { id: 'c', data: { name: 'c', mathRef: OTHER_REF } }]
    await editAndSave({ xml: EDITED_XML.replace(/"decay"/g, '"other"') })
    expect(choose).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('affect 2 other instances.') }))
  })

  it('saves without asking when the math is unchanged', async () => {
    mountDialog()
    const editor = await open()
    await report(editor, 'init', useLibraryStore().availableMath.get(MATH_REF))
    await checkbox().setValue(false)
    await wrapper.findAll('button').find((button) => button.text() === 'Save').trigger('click')
    await flushPromises()
    expect(saveAsDialog().exists()).toBe(false)
    expect(wrapper.emitted('confirm')[0][0]).toMatchObject({ mathRef: MATH_REF, math: null })
  })
})

describe('InstanceEditorDialog module config', () => {
  const MODULE_REF = 'decay:base'
  const PORTS = [{ label: 'p', portType: 'general_ports', variables: ['x', 'k'] }]
  let rows

  beforeAll(async () => {
    await ensureLibCellmlReady()
  })

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    const library = useLibraryStore()
    library.addMath(MATH_REF, XML)
    const module = {
      moduleRef: MODULE_REF,
      mathRef: MATH_REF,
      ports: PORTS,
      variables: [
        { name: 'x', value: null, units: 'metre', access: 'access', type: 'variable' },
        { name: 'k', value: '0.5', units: 'per_second', access: 'access', type: 'boundary_condition' },
      ],
    }
    library.addModule(module)
    rows = buildInstance('a', 'a', null, module, [], null, library.getMathAnalysis(MATH_REF)).data.variables
    flowNodes.value = ['a', 'b'].map((id) => ({ id, data: { name: id, mathRef: MATH_REF, moduleRef: MODULE_REF } }))
  })

  afterEach(() => {
    flowNodes.value = []
  })

  const configDialog = () => wrapper.findComponent(ModuleConfigSaveDialog)

  /**
   * Opens the dialog on instance `a`, optionally edits the math, and clicks Save.
   *
   * @param {Object} [props] - Props beyond the instance's rows and ports.
   * @param {{xml?: string, untick?: boolean}} [options]
   */
  async function save(props = {}, { xml = null, untick = false } = {}) {
    mountDialog({ variables: rows, initialPorts: PORTS, ...props })
    const editor = await open()
    await report(editor, 'init', XML)
    if (xml) await report(editor, 'edit', xml)
    if (untick) await wrapper.find('#applyToAll').setValue(false)
    await wrapper.findAll('button').find((button) => button.text() === 'Save').trigger('click')
    await flushPromises()
  }

  it('saves without asking when only values change', async () => {
    await save({ variables: rows.map((row) => (row.name === 'k' ? { ...row, value: '9' } : row)) })
    expect(configDialog().exists()).toBe(false)
    expect(wrapper.emitted('confirm')[0][0].config).toBeNull()
  })

  it('saves math in place for every instance without asking', async () => {
    await save({}, { xml: EDITED_XML })
    expect(configDialog().exists()).toBe(false)
    expect(wrapper.emitted('confirm')[0][0]).toMatchObject({ mathRef: MATH_REF, updateAll: true, config: null })
  })

  it('saves math as a new component for this instance without asking', async () => {
    await save({}, { xml: EDITED_XML, untick: true })
    wrapper.findComponent(ComponentSaveAsDialog).vm.$emit('confirm', 'decay_a')
    await flushPromises()
    expect(configDialog().exists()).toBe(false)
    expect(wrapper.emitted('confirm')[0][0]).toMatchObject({ mathRef: 'file:decay_a', config: null })
  })

  it('asks before saving changed ports, and sends the choice', async () => {
    await save({ initialPorts: [{ ...PORTS[0], label: 'q' }] })
    expect(wrapper.emitted('confirm')).toBeUndefined()
    expect(configDialog().props()).toMatchObject({ moduleRef: MODULE_REF, otherCount: 1, canUpdate: true, newRef: 'decay:a' })

    configDialog().vm.$emit('confirm', { action: 'update' })
    await flushPromises()
    expect(wrapper.emitted('confirm')[0][0].config).toEqual({ action: 'update' })
  })

  it('asks before saving a changed variable type', async () => {
    await save({ variables: rows.map((row) => (row.name === 'k' ? { ...row, type: 'constant' } : row)) })
    expect(configDialog().exists()).toBe(true)
  })

  it('offers only a new config when this instance alone moves to other math', async () => {
    const otherRef = 'file:other'
    useLibraryStore().addMath(otherRef, XML.replace(/"decay"/g, '"other"'))
    useLibraryStore().addModule({ moduleRef: 'other:base', mathRef: otherRef, ports: [], variables: [] })
    await save({}, { xml: EDITED_XML.replace(/"decay"/g, '"other"'), untick: true })
    expect(configDialog().props('canUpdate')).toBe(false)

    configDialog().vm.$emit('confirm', { action: 'new', moduleRef: 'decay:base_a' })
    await flushPromises()
    expect(wrapper.emitted('confirm')[0][0]).toMatchObject({ mathRef: otherRef, config: { action: 'new', moduleRef: 'decay:base_a' } })
  })

  it('takes the module along to math every instance switches to when this instance saves a new config', async () => {
    const otherRef = 'file:other'
    useLibraryStore().addMath(otherRef, XML.replace(/"decay"/g, '"other"'))
    useLibraryStore().addModule({ moduleRef: 'other:base', mathRef: otherRef, ports: [], variables: [] })
    await save({ initialPorts: [{ ...PORTS[0], label: 'q' }] }, { xml: EDITED_XML.replace(/"decay"/g, '"other"') })
    expect(configDialog().props('canUpdate')).toBe(true)

    configDialog().vm.$emit('confirm', { action: 'new', moduleRef: 'decay:base_a' })
    await flushPromises()
    expect(wrapper.emitted('confirm')[0][0]).toMatchObject({
      mathRef: otherRef,
      updateAll: true,
      config: { action: 'new', moduleRef: 'decay:base_a', follow: true },
    })
  })

  it('asks about a library module even when no other instance uses it', async () => {
    flowNodes.value[1].data.moduleRef = 'decay:other'
    await save({ initialPorts: [{ ...PORTS[0], label: 'q' }] })
    expect(configDialog().props()).toMatchObject({ moduleRef: MODULE_REF, otherCount: 0, canUpdate: true, newRef: 'decay:a' })
  })

  it('names the new config past one of the instance’s name already taken', async () => {
    const library = useLibraryStore()
    library.addModule({ ...JSON.parse(JSON.stringify(library.availableModules.get(MODULE_REF))), moduleRef: 'decay:a' })
    await save({ initialPorts: [{ ...PORTS[0], label: 'q' }] })
    expect(configDialog().props('newRef')).toBe('decay:a_2')
  })

  it('updates a config the instance made, and alone uses, without asking', async () => {
    const library = useLibraryStore()
    library.replaceModule({ ...JSON.parse(JSON.stringify(library.availableModules.get(MODULE_REF))), source: { kind: 'instance', nodeId: 'a' } })
    flowNodes.value[1].data.moduleRef = 'decay:other'
    await save({ initialPorts: [{ ...PORTS[0], label: 'q' }] })
    expect(configDialog().exists()).toBe(false)
    expect(wrapper.emitted('confirm')[0][0].config).toEqual({ action: 'update' })
  })

  it('asks about a config the instance made once another instance uses it', async () => {
    const library = useLibraryStore()
    library.replaceModule({ ...JSON.parse(JSON.stringify(library.availableModules.get(MODULE_REF))), source: { kind: 'instance', nodeId: 'a' } })
    await save({ initialPorts: [{ ...PORTS[0], label: 'q' }] })
    expect(configDialog().props()).toMatchObject({ moduleRef: MODULE_REF, otherCount: 1 })
  })

  it('asks about the new component\'s module when the instances switching to it would differ', async () => {
    const newXml = EDITED_XML.replace(/"decay"/g, '"decay2"')
    await save({ initialPorts: [{ ...PORTS[0], label: 'q' }] }, { xml: newXml })
    expect(configDialog().props()).toMatchObject({
      moduleRef: 'decay2:default',
      matchRef: MODULE_REF,
      otherCount: 1,
      canUpdate: true,
      newRef: 'decay2:a',
    })

    configDialog().vm.$emit('confirm', { action: 'new', moduleRef: 'decay2:a' })
    await flushPromises()
    expect(wrapper.emitted('confirm')[0][0]).toMatchObject({ mathRef: 'file:decay2', config: { action: 'new', moduleRef: 'decay2:a' } })
  })

  it('saves a new component without asking when no instance on the module switches to it', async () => {
    flowNodes.value[1].data.moduleRef = 'decay:other'
    await save({ initialPorts: [{ ...PORTS[0], label: 'q' }] }, { xml: EDITED_XML.replace(/"decay"/g, '"decay2"') })
    expect(configDialog().exists()).toBe(false)
    expect(wrapper.emitted('confirm')[0][0]).toMatchObject({ mathRef: 'file:decay2', config: null })
  })

  it('saves nothing when the config prompt is cancelled', async () => {
    await save({ initialPorts: [{ ...PORTS[0], label: 'q' }] })
    configDialog().vm.$emit('cancel')
    await flushPromises()
    expect(wrapper.emitted('confirm')).toBeUndefined()
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  describe('when the ports would set a CellDL store from another instance', () => {
    const SOURCE_REF = 'file:source'
    const LINK = [{ label: 'link', portType: 'general_ports', variables: ['x'], multiportType: 'None' }]
    const drivesQuestions = () =>
      confirm.mock.calls.map(([options]) => options).filter((options) => /^Set (a store|stores) from/.test(options.header))

    beforeEach(() => {
      const library = useLibraryStore()
      library.addMath(
        SOURCE_REF,
        `<model xmlns="http://www.cellml.org/cellml/2.0#" name="source"><component name="source">
          <variable name="t" units="second" interface="public_and_private"/>
          <variable name="X" units="metre"/>
          <math xmlns="http://www.w3.org/1998/Math/MathML" xmlns:cellml="http://www.cellml.org/cellml/2.0#">
            <apply><eq/><ci>X</ci><apply><times/><ci>t</ci><cn cellml:units="metre_per_second">1</cn></apply></apply>
          </math></component></model>`.replace('<component', '<units name="metre_per_second"><unit units="metre"/><unit units="second" exponent="-1"/></units><component')
      )
      const sourcePort = { label: 'link', portType: 'general_ports', variables: ['X'], multiportType: 'None' }
      const source = (id) => ({
        id,
        data: { name: id, mathRef: SOURCE_REF, moduleRef: 'source:base', ports: [sourcePort], variables: [{ name: 'X', units: 'metre', type: 'variable' }] },
      })
      flowNodes.value = [
        ...['a', 'b'].map((id) => ({ id, data: { name: id, mathRef: MATH_REF, moduleRef: MODULE_REF, ports: PORTS, variables: rows } })),
        source('s1'),
        source('s2'),
      ]
      flowEdges.value = [
        { id: 's1--a', source: 's1', target: 'a', data: { couplings: [] } },
        { id: 's2--b', source: 's2', target: 'b', data: { couplings: [] } },
      ]
    })

    afterEach(() => {
      flowEdges.value = []
    })

    /** Saves instance `a` with a port on its store, its math a diagram's by then, as one opened on the text editor. */
    async function saveLink() {
      mountDialog({ variables: rows, initialPorts: LINK })
      const editor = await open()
      await report(editor, 'init', XML)
      useLibraryStore().setMathSource(MATH_REF, { format: 'celldl', document: '<svg/>', documentUri: 'urn:test' })
      await wrapper.findAll('button').find((button) => button.text() === 'Save').trigger('click')
      await flushPromises()
    }

    it("asks once, listing every instance's edge, when updating the module spreads the ports", async () => {
      await saveLink()
      expect(drivesQuestions()).toHaveLength(0)
      configDialog().vm.$emit('confirm', { action: 'update' })
      await flushPromises()

      expect(drivesQuestions()).toEqual([
        expect.objectContaining({
          header: 'Set stores from connections',
          issues: [
            expect.objectContaining({ label: 'x of a', message: expect.stringContaining('s1 → a') }),
            expect.objectContaining({ label: 'x of b', message: expect.stringContaining('s2 → b') }),
          ],
        }),
      ])
      const save_ = wrapper.emitted('confirm')[0][0]
      expect(new Map(save_.drivenCouplings).get('s2--b')).toEqual([expect.objectContaining({ drivesState: true })])
    })

    it("asks only about this instance's edge when it saves a new config", async () => {
      await saveLink()
      configDialog().vm.$emit('confirm', { action: 'new', moduleRef: 'decay:base_a' })
      await flushPromises()

      expect(drivesQuestions()).toEqual([expect.objectContaining({ header: 'Set a store from a connection', message: expect.stringContaining('Set x of a') })])
      expect(new Map(wrapper.emitted('confirm')[0][0].drivenCouplings).has('s2--b')).toBe(false)
    })

    it('saves nothing when the question is declined', async () => {
      confirm.mockImplementationOnce(async () => false)
      await saveLink()
      configDialog().vm.$emit('confirm', { action: 'update' })
      await flushPromises()
      expect(drivesQuestions()).toHaveLength(1)
      expect(wrapper.emitted('confirm')).toBeUndefined()
    })
  })

  describe('with values changed from a shared parameter set', () => {
    const setPrompt = () => wrapper.findComponent(ParameterSetSaveDialog)
    const sharedSet = { ref: 'slow', source: { file: 'slow_parameters.json', importedAt: '' }, globals: new Map(), values: new Map([['k', { value: '0.5', units: '', data_reference: '', extra: {} }]]) }
    const portDeletedValueChanged = () => ({
      initialPorts: [],
      variables: rows.map((row) => (row.name === 'k' ? { ...row, value: '3' } : row)),
    })

    beforeEach(() => {
      useDefaultParametersStore().addSet(sharedSet, { mathRef: MATH_REF })
      flowNodes.value.forEach((node) => Object.assign(node.data, { parameterisation: 'slow', variables: rows }))
    })

    it('asks about the config first, then the parameter set, and saves both choices together', async () => {
      await save(portDeletedValueChanged())
      expect(configDialog().exists()).toBe(true)
      expect(setPrompt().exists()).toBe(false)

      configDialog().vm.$emit('confirm', { action: 'new', moduleRef: 'decay:base_a' })
      await flushPromises()
      expect(wrapper.emitted('confirm')).toBeUndefined()
      expect(setPrompt().props()).toMatchObject({ paramRef: 'slow', otherCount: 1 })

      setPrompt().vm.$emit('confirm', { action: 'update' })
      await flushPromises()
      const [saved] = wrapper.emitted('confirm')[0]
      expect(saved).toMatchObject({
        ports: [],
        config: { action: 'new', moduleRef: 'decay:base_a' },
        parameterSet: { action: 'update' },
        parameterisation: 'slow',
      })
    })

    it('saves nothing, and never asks about the set, when the config prompt is cancelled', async () => {
      await save(portDeletedValueChanged())
      configDialog().vm.$emit('cancel')
      await flushPromises()
      expect(setPrompt().exists()).toBe(false)
      expect(wrapper.emitted('confirm')).toBeUndefined()
    })

    it('saves nothing when the parameter set prompt is cancelled after the config prompt', async () => {
      await save(portDeletedValueChanged())
      configDialog().vm.$emit('confirm', { action: 'update' })
      await flushPromises()
      setPrompt().vm.$emit('cancel')
      await flushPromises()
      expect(wrapper.emitted('confirm')).toBeUndefined()
      expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    })
  })
})

describe('InstanceEditorDialog new module template (#634)', () => {
  const TEMPLATE_XML = XML.replace(/"decay"/g, '"new_module"')
  const EDITED_TEMPLATE_XML = EDITED_XML.replace(/"decay"/g, '"new_module"')

  beforeAll(async () => {
    await ensureLibCellmlReady()
  })

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useLibraryStore().addMath(NEW_MODULE_MATH_REF, TEMPLATE_XML)
  })

  async function saveEditedTemplate() {
    mountDialog({ mathRef: NEW_MODULE_MATH_REF, initialName: 'my_instance' })
    const editor = await open()
    await report(editor, 'init', TEMPLATE_XML)
    await report(editor, 'edit', EDITED_TEMPLATE_XML)
    await wrapper.findAll('button').find((button) => button.text() === 'Save').trigger('click')
    await flushPromises()
    return wrapper.findComponent(ComponentSaveAsDialog)
  }

  it('saves edited template math under the new component name', async () => {
    const saveAs = await saveEditedTemplate()
    expect(saveAs.exists()).toBe(true)
    expect(wrapper.emitted('confirm')).toBeUndefined()

    saveAs.vm.$emit('confirm', 'my_comp')
    await flushPromises()

    const [save] = wrapper.emitted('confirm')[0]
    expect(save.mathRef).toBe('User_Modules.cellml:my_comp')
    expect(saveAs.props('file')).toBe('User_Modules.cellml')
    expect(save.previousMathRef).toBe(NEW_MODULE_MATH_REF)
    expect(save.math).toContain('<component name="my_comp"')
    expect(save.math).not.toContain('<component name="new_module"')
    expect(useLibraryStore().availableMath.get(NEW_MODULE_MATH_REF)).not.toContain('<cn>1</cn>')
  })

  it("refuses a name User_Modules.cellml has, but not another grouping's", async () => {
    useLibraryStore().addMath('User_Modules.cellml:taken', XML.replaceAll('decay', 'taken'))
    useLibraryStore().addMath('User_Modules.celldl:free', XML.replaceAll('decay', 'free'))
    const saveAs = await saveEditedTemplate()

    expect(saveAs.props('file')).toBe('User_Modules.cellml')
    expect(saveAs.props('isTaken')('Taken')).toBe('A component named "Taken" already exists.')
    expect(saveAs.props('isTaken')('free')).toBe('')
  })

  it('keeps the editor open when the rename is cancelled', async () => {
    const saveAs = await saveEditedTemplate()
    saveAs.vm.$emit('cancel')
    await flushPromises()

    expect(wrapper.emitted('confirm')).toBeUndefined()
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('writes no source for a CellML save', async () => {
    const saveAs = await saveEditedTemplate()
    saveAs.vm.$emit('confirm', 'my_comp')
    await flushPromises()

    expect(wrapper.emitted('confirm')[0][0]).toMatchObject({ source: null, isSourceChanged: false, units: null })
  })

  describe('with other instances on the template', () => {
    beforeEach(() => {
      flowNodes.value = [
        { id: 'a', data: { name: 'a', mathRef: NEW_MODULE_MATH_REF } },
        { id: 'b', data: { name: 'b', mathRef: NEW_MODULE_MATH_REF } },
      ]
    })

    afterEach(() => {
      flowNodes.value = []
    })

    it('leaves Apply to all unticked, so only this instance moves to the new component', async () => {
      const saveAs = await saveEditedTemplate()
      expect(wrapper.find('#applyToAll').element.checked).toBe(false)
      saveAs.vm.$emit('confirm', 'my_comp')
      await flushPromises()

      expect(wrapper.emitted('confirm')[0][0]).toMatchObject({
        mathRef: 'User_Modules.cellml:my_comp',
        updateAll: false,
        siblings: [],
      })
    })

    it('moves the other instances too once ticked', async () => {
      mountDialog({ mathRef: NEW_MODULE_MATH_REF, initialName: 'my_instance' })
      const editor = await open()
      await report(editor, 'init', TEMPLATE_XML)
      await report(editor, 'edit', EDITED_TEMPLATE_XML)
      await wrapper.find('#applyToAll').setValue(true)
      await wrapper.findAll('button').find((button) => button.text() === 'Save').trigger('click')
      await flushPromises()
      wrapper.findComponent(ComponentSaveAsDialog).vm.$emit('confirm', 'my_comp')
      await flushPromises()

      expect(wrapper.emitted('confirm')[0][0]).toMatchObject({ updateAll: true, siblings: ['b'] })
    })

    it('unticks it again on each open of the template, but ticks it for other math', async () => {
      useLibraryStore().addMath(MATH_REF, XML)
      mountDialog({ mathRef: NEW_MODULE_MATH_REF, initialName: 'my_instance' })
      await open()
      await wrapper.find('#applyToAll').setValue(true)
      await wrapper.setProps({ modelValue: false })
      await open()
      expect(wrapper.find('#applyToAll').element.checked).toBe(false)

      flowNodes.value = [
        { id: 'a', data: { name: 'a', mathRef: MATH_REF } },
        { id: 'b', data: { name: 'b', mathRef: MATH_REF } },
      ]
      await wrapper.setProps({ modelValue: false, mathRef: MATH_REF })
      await open()
      expect(wrapper.find('#applyToAll').element.checked).toBe(true)
    })
  })

  describe('whichever editor is used first', () => {
    const DOCUMENT = '<svg>drawn</svg>'
    const GENERATED_XML = XML.replace(/"decay"/g, '"my_rc"')
    const stubProps = (component) => wrapper.findComponent(component).vm.$attrs
    const celldlOption = () => wrapper.vm.editorOptions.find((option) => option.value === 'celldl')
    let host

    beforeEach(() => {
      host = useCelldlEditorHost()
      flowNodes.value = [
        { id: 'a', data: { name: 'a', mathRef: NEW_MODULE_MATH_REF } },
        { id: 'b', data: { name: 'b', mathRef: NEW_MODULE_MATH_REF } },
      ]
    })

    afterEach(() => {
      vi.restoreAllMocks()
      flowNodes.value = []
      host.isDirty.value = false
    })

    /** Opens the template on the CellML Text editor, as it opens. */
    async function openTemplate() {
      mountDialog({ mathRef: NEW_MODULE_MATH_REF, initialName: 'my_instance' })
      const editor = await open()
      await report(editor, 'init', TEMPLATE_XML)
      return editor
    }

    it('offers every editor, with a blank diagram, while nothing is edited', async () => {
      const prepare = vi.spyOn(host, 'prepare')
      await openTemplate()

      expect(prepare).toHaveBeenCalledWith(null)
      expect(wrapper.vm.editorOptions.every((option) => !option.isLocked)).toBe(true)
      expect(stubProps(FakeEditor).readonly).toBe(false)
      expect(stubProps(ParameterTableStub)['values-only']).toBe(false)
      await wrapper.vm.switchEditor('celldl')
      expect(wrapper.findComponent(CelldlPaneStub).exists()).toBe(true)
    })

    it('locks the diagram once the CellML is edited, saying why, and offers it again once the edit is undone', async () => {
      const editor = await openTemplate()
      await report(editor, 'edit', EDITED_TEMPLATE_XML)

      expect(celldlOption()).toMatchObject({ isLocked: true, lockedNotice: expect.stringContaining('Undo the edits') })
      expect(wrapper.find('.editor-tab-locked').exists()).toBe(true)
      await wrapper.vm.switchEditor('celldl')
      expect(wrapper.vm.editorKind).toBe('text')

      editor.vm.$emit('undo')
      await flushPromises()
      expect(celldlOption().isLocked).toBe(false)
    })

    it('locks the diagram once its text no longer parses', async () => {
      const editor = await openTemplate()
      editor.vm.$emit('change', { source: 'edit', format: 'mathml', text: '<bad', valid: false, xml: null })
      await flushPromises()
      expect(celldlOption().isLocked).toBe(true)
    })

    it('leaves the diagram for the CellML Text editor once a Parameters edit changes the math', async () => {
      await openTemplate()
      await wrapper.vm.switchEditor('celldl')
      expect(wrapper.vm.editorKind).toBe('celldl')

      // As the table's definitions rewrite the math.
      wrapper.vm.handleEditorChange({ source: 'edit', format: 'mathml', text: EDITED_TEMPLATE_XML, valid: true, xml: EDITED_TEMPLATE_XML })
      await flushPromises()
      expect(wrapper.vm.editorKind).toBe('text')
      expect(wrapper.findComponent(FakeEditor).exists()).toBe(true)
    })

    it('makes the math read-only, with only values editable, once a diagram is drawn, until it is blank again', async () => {
      const editor = await openTemplate()
      host.isDirty.value = true
      await flushPromises()

      expect(stubProps(FakeEditor).readonly).toBe(true)
      // The Parameters tab is the diagram's.
      expect(wrapper.findComponent(CelldlParametersTabStub).exists()).toBe(true)
      expect(wrapper.findComponent(ParameterTableStub).exists()).toBe(false)
      expect(wrapper.vm.editorOptions.every((option) => !option.isLocked)).toBe(true)
      await report(editor, 'edit', EDITED_TEMPLATE_XML)
      expect(wrapper.vm.currentModel).not.toContain('<cn>1</cn>')

      host.isDirty.value = false
      await flushPromises()
      expect(stubProps(FakeEditor).readonly).toBe(false)
      expect(stubProps(ParameterTableStub)['values-only']).toBe(false)
      await report(editor, 'edit', EDITED_TEMPLATE_XML)
      expect(wrapper.vm.currentModel).toContain('<cn>1</cn>')
    })

    describe('saving a drawn diagram', () => {
      beforeEach(() => {
        vi.spyOn(host, 'compareWithBaseline').mockResolvedValue({ isChanged: true, document: DOCUMENT })
        vi.spyOn(host, 'markSaved').mockImplementation(() => {})
        convertCelldl.mockImplementation(async (document, { documentUri, componentName }) => ({
          ok: true,
          components: [{ name: componentName, math: GENERATED_XML }],
          unitsModel: '<model name="units"/>',
          elements: { R: { primary: 'v_R' } },
          documentUri,
          generator: { name: 'bg2cellml', version: '0.2.0' },
          frameworkVersion: '1.0',
          errors: [],
          warnings: [],
        }))
      })

      /** Draws on the template's diagram and saves, which asks for a new component name. */
      async function saveDrawn() {
        await openTemplate()
        await wrapper.vm.switchEditor('celldl')
        host.isDirty.value = true
        await wrapper.find('#applyToAll').setValue(false)
        await wrapper.findAll('button').find((button) => button.text() === 'Save').trigger('click')
        await flushPromises()
        return wrapper.findComponent(ComponentSaveAsDialog)
      }

      it('converts it as a new CellDL component in User_Modules.celldl, under a new documentUri', async () => {
        const saveAs = await saveDrawn()
        expect(convertCelldl).not.toHaveBeenCalled()
        saveAs.vm.$emit('confirm', 'my_rc')
        await vi.waitFor(() => expect(wrapper.emitted('confirm')).toHaveLength(1))

        const documentUri = 'https://bg-rdf.org/models/local/phlynx/User_Modules.celldl_my_rc.celldl'
        expect(convertCelldl).toHaveBeenCalledWith(DOCUMENT, expect.objectContaining({ documentUri, componentName: 'my_rc' }))
        const [save] = wrapper.emitted('confirm')[0]
        expect(save).toMatchObject({
          mathRef: 'User_Modules.celldl:my_rc',
          previousMathRef: NEW_MODULE_MATH_REF,
          math: GENERATED_XML,
          layout: null,
          isSourceChanged: true,
          source: { format: 'celldl', document: DOCUMENT, documentUri, elements: { R: { primary: 'v_R' } } },
          units: { componentFile: 'User_Modules.celldl', model: '<model name="units"/>' },
          updateAll: false,
          siblings: [],
        })
        expect(useLibraryStore().getMathSource(NEW_MODULE_MATH_REF)).toBeNull()
        expect(choose).not.toHaveBeenCalled()
      })

      it('stays on the diagram after an Apply, though the math it generated is not the template', async () => {
        host.markSaved.mockImplementation(() => (host.isDirty.value = false))
        await openTemplate()
        await wrapper.vm.switchEditor('celldl')
        host.isDirty.value = true
        await wrapper.findAll('button').find((button) => button.text() === 'Apply').trigger('click')
        await flushPromises()
        wrapper.findComponent(ComponentSaveAsDialog).vm.$emit('confirm', 'my_rc')
        await vi.waitFor(() => expect(wrapper.emitted('confirm')).toHaveLength(1))
        await flushPromises()

        expect(wrapper.vm.editorKind).toBe('celldl')
        expect(celldlOption().isLocked).toBe(false)
        expect(wrapper.findComponent(CelldlParametersTabStub).exists()).toBe(true)
      })

      it("previews the diagram against User_Modules.celldl, the grouping its save converts it in", async () => {
        await openTemplate()
        await wrapper.vm.switchEditor('celldl')

        expect(wrapper.findComponent(CelldlPaneStub).vm.$attrs['math-ref']).toBe('User_Modules.celldl:new_module')
      })

      it('saves nothing when the new name is cancelled', async () => {
        const saveAs = await saveDrawn()
        saveAs.vm.$emit('cancel')
        await flushPromises()

        expect(convertCelldl).not.toHaveBeenCalled()
        expect(wrapper.emitted('confirm')).toBeUndefined()
        expect(wrapper.emitted('update:modelValue')).toBeUndefined()
      })

      it("refuses a name User_Modules.celldl has, in any case, but not another grouping's", async () => {
        useLibraryStore().addMath('User_Modules.celldl:taken', XML.replaceAll('decay', 'taken'))
        useLibraryStore().addMath('User_Modules.cellml:free', XML.replaceAll('decay', 'free'))
        const saveAs = await saveDrawn()

        expect(saveAs.props('file')).toBe('User_Modules.celldl')
        expect(saveAs.props('isTaken')('Taken')).toBe('A component named "Taken" already exists.')
        expect(saveAs.props('isTaken')('free')).toBe('')
      })
    })
  })
})

describe('InstanceEditorDialog Plot tab', () => {
  beforeAll(async () => {
    await ensureLibCellmlReady()
  })

  beforeEach(async () => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useLibraryStore().addMath(MATH_REF, XML)
    const { useSimulationSettingsStore } = await import('../../../src/stores/simulationSettingsStore.js')
    useSimulationSettingsStore().setPlotConfig({
      groups: [
        { id: 'plot-1', name: 'Plot 1' },
        { id: 'plot-2', name: 'Plot 2' },
      ],
      selections: [{ key: 'a::x', nodeId: 'a', nodeName: 'a', variableName: 'x', units: 'metre', type: 'variable', plot: true, groupId: 'plot-2' }],
    })
  })

  /**
   * Opens the dialog on its Plot tab, with the math reported.
   *
   * @returns {Promise<import('@vue/test-utils').VueWrapper>} The Plot tab's simulation workbench.
   */
  async function openPlotTab() {
    mountDialog({ defaultTab: 'plot' })
    const editor = await open()
    await report(editor, 'init', XML)
    await flushPromises()
    return wrapper.findComponent({ name: 'SimulationPanel' })
  }

  it('keeps a declared variable no equation uses, and shows no save note on open', async () => {
    const withCamp = XML.replace('<variable name="k"', '<variable name="cAMP" units="dimensionless"/>\n    <variable name="k"')
    useLibraryStore().addMath(MATH_REF, withCamp)
    const cAMP = { name: 'cAMP', units: 'dimensionless', value: '0.01', type: 'constant' }
    mountDialog({ defaultTab: 'plot', variables: [cAMP] })
    const editor = await open()
    expect(editor.vm.$attrs['keep-variables']).toEqual(['cAMP'])

    // Even an editor whose first view drops the row doesn't show the opened instance as edited.
    await report(editor, 'init', XML)
    expect(wrapper.find('.plot-tab-note').exists()).toBe(false)

    await report(editor, 'edit', EDITED_XML)
    expect(wrapper.find('.plot-tab-note').exists()).toBe(true)
  })

  it('still shows a value edited before the editor mounts as unsaved', async () => {
    const withCamp = XML.replace('<variable name="k"', '<variable name="cAMP" units="dimensionless"/>\n    <variable name="k"')
    useLibraryStore().addMath(MATH_REF, withCamp)
    mountDialog({ defaultTab: 'plot', variables: [{ name: 'cAMP', units: 'dimensionless', value: '0.01', type: 'constant' }] })
    const editor = await open()

    // An edit made in the table before the editor's first view of the math is applied.
    wrapper.vm.parameterRows.find((row) => row.name === 'cAMP').value = '0.5'
    await report(editor, 'init', withCamp)
    expect(wrapper.find('.plot-tab-note').exists()).toBe(true)
  })

  it('simulates the instance from its Plot tab', async () => {
    const workbench = await openPlotTab()
    expect(workbench.props('instanceId')).toBe('a')
  })

  describe('its own plot', () => {
    const variables = [
      { name: 't', units: 'second', type: 'variable' },
      { name: 'x', units: 'metre', type: 'variable' },
      { name: 'k', units: 'per_second', type: 'constant', value: '0.5' },
    ]
    const plotTabLabel = () => wrapper.findAll('[role="tab"]').find((tab) => tab.text().startsWith('Plot')).text()
    const plottedKeys = () => wrapper.findComponent({ name: 'SimulationPanel' }).props('plotConfig').selections.map((selection) => selection.key)
    const clickVariable = async (name) => {
      wrapper.findComponent(FakeEditor).vm.$emit('variable-click', name)
      await flushPromises()
    }

    beforeEach(() => {
      flowNodes.value = [{ id: 'a', data: { name: 'a', variables } }]
    })

    afterEach(() => {
      flowNodes.value = []
    })

    it('starts as one empty plot on each open, apart from the workspace’s plots', async () => {
      const { useSimulationSettingsStore } = await import('../../../src/stores/simulationSettingsStore.js')
      const before = JSON.stringify(useSimulationSettingsStore().plotConfig)
      const workbench = await openPlotTab()
      expect(workbench.props('plotConfig').groups).toHaveLength(1)
      expect(plottedKeys()).toEqual([])
      expect(plotTabLabel()).toBe('Plot (0)')

      await clickVariable('x')
      expect(plotTabLabel()).toBe('Plot (1)')
      expect(JSON.stringify(useSimulationSettingsStore().plotConfig)).toBe(before)

      await wrapper.setProps({ modelValue: false })
      await open()
      expect(plottedKeys()).toEqual([])
    })

    it('plots a variable clicked in the math in place of the plotted ones, running when nothing is shown', async () => {
      await openPlotTab()
      await clickVariable('x')
      expect(plottedKeys()).toEqual(['a::x'])
      expect(ensureResults).toHaveBeenCalledTimes(1)

      await clickVariable('t')
      expect(plottedKeys()).toEqual(['a::t'])
    })

    it('keeps what the plot tab’s own picker adds', async () => {
      const workbench = await openPlotTab()
      await clickVariable('x')
      const config = workbench.props('plotConfig')
      workbench.vm.$emit('update:plotConfig', { ...config, selections: [...config.selections, { ...config.selections[0], key: 'a::t', variableName: 't' }] })
      await flushPromises()
      expect(plotTabLabel()).toBe('Plot (2)')
    })

    it('plots nothing clicked with Auto-update off, or with another tab shown', async () => {
      await openPlotTab()
      wrapper.find('.plot-tab-auto-label').findComponent({ name: 'ToggleSwitch' }).vm.$emit('update:modelValue', false)
      await clickVariable('x')
      expect(plottedKeys()).toEqual([])

      wrapper.find('.plot-tab-auto-label').findComponent({ name: 'ToggleSwitch' }).vm.$emit('update:modelValue', true)
      wrapper.vm.showTab('parameters')
      await clickVariable('x')
      wrapper.vm.showTab('plot')
      await flushPromises()
      expect(plottedKeys()).toEqual([])
      expect(ensureResults).not.toHaveBeenCalled()
    })

    it('puts Auto-update in the run’s toolbar, and filters the plot’s picker by units while it is off', async () => {
      mountDialog({ defaultTab: 'plot' }, { isPanelReal: true })
      const editor = await open()
      await report(editor, 'init', XML)
      await flushPromises()
      const panel = wrapper.findComponent({ name: 'SimulationPanel' })
      // Its own span, so a narrow toolbar can hide it and leave the switch.
      expect(panel.find('[role="toolbar"] .plot-tab-auto-label .plot-tab-auto-text').text()).toBe('Auto-update')
      expect(panel.props('isUnitFiltered')).toBe(false)

      wrapper.find('.plot-tab-auto-label').findComponent({ name: 'ToggleSwitch' }).vm.$emit('update:modelValue', false)
      await flushPromises()
      expect(panel.props('isUnitFiltered')).toBe(true)
      expect(panel.findComponent({ name: 'SimulationControls' }).props('isUnitFiltered')).toBe(true)
    })

    it('asks for a save to plot a variable the saved instance doesn’t have', async () => {
      flowNodes.value = [{ id: 'a', data: { name: 'a', variables: variables.filter((row) => row.name !== 'x') } }]
      await openPlotTab()
      await clickVariable('x')
      expect(plottedKeys()).toEqual([])
      expect(wrapper.find('.plot-tab-auto-notice').text()).toBe('Save to plot x')
      expect(ensureResults).not.toHaveBeenCalled()
    })

    it('asks for a save to plot an unsaved diagram element’s variable', async () => {
      await openPlotTab()
      await clickVariable('nowhere')
      expect(wrapper.find('.plot-tab-auto-notice').exists()).toBe(false)
      wrapper.findComponent(FakeEditor).vm.$emit('variable-click', 'q_X', { isUnsaved: true })
      await flushPromises()
      expect(wrapper.find('.plot-tab-auto-notice').text()).toBe('Save to plot q_X')
      expect(plottedKeys()).toEqual([])
    })

    it('plots a clicked constant or boundary condition as this instance’s own', async () => {
      flowNodes.value = [
        { id: 'a', data: { name: 'a', variables: [...variables, { name: 'p', units: 'metre', type: 'boundary_condition' }] } },
        { id: 'b', data: { name: 'b', variables } },
      ]
      await openPlotTab()
      await clickVariable('k')
      expect(plottedKeys()).toEqual(['a::k'])
      expect(wrapper.find('.plot-tab-auto-notice').exists()).toBe(false)
      expect(ensureResults).toHaveBeenCalledTimes(1)

      await clickVariable('p')
      expect(plottedKeys()).toEqual(['a::p'])
    })

    it('runs the whole model, offers only the instance’s variables to plot, and has no float or page buttons', async () => {
      flowNodes.value = [
        { id: 'a', data: { name: 'a', variables } },
        { id: 'b', data: { name: 'b', variables } },
      ]
      mountDialog({ defaultTab: 'plot' }, { isPanelReal: true })
      const editor = await open()
      await report(editor, 'init', XML)
      await flushPromises()

      const panel = wrapper.findComponent({ name: 'SimulationPanel' })
      expect(panel.find('button[aria-label="Simulate the whole model"]').exists()).toBe(true)
      expect(panel.find('button[aria-label="Track this run"]').exists()).toBe(true)
      expect(panel.find('button[aria-label="Float the results over the canvas"]').exists()).toBe(false)
      expect(panel.find('button[aria-label="Open the simulation page"]').exists()).toBe(false)
      expect(panel.find('button[aria-label="Simulation settings"]').exists()).toBe(true)
      await panel.find('button[aria-label="Simulate the whole model"]').trigger('click')
      expect(run).toHaveBeenCalledWith(null)

      // One plot: none to add or choose between.
      expect(panel.find('[aria-label="Plot to add to"]').exists()).toBe(false)
      expect(panel.findAll('button').some((button) => button.text() === 'Add plot')).toBe(false)
      const picker = panel.findComponent({ name: 'VariablePathPicker' })
      const offered = picker.props('index').filter(picker.props('filter')).map((entry) => entry.path)
      expect(offered).toEqual(['a/k', 'a/t', 'a/x'])

      const { useSimulationSettingsStore } = await import('../../../src/stores/simulationSettingsStore.js')
      const before = JSON.stringify(useSimulationSettingsStore().plotConfig)
      for (const path of ['a/x', 'a/t']) {
        picker.vm.$emit('pick', picker.props('index').find((entry) => entry.path === path))
        await flushPromises()
      }
      expect(panel.props('plotConfig').selections.map((selection) => selection.key)).toEqual(['a::x', 'a::t'])
      expect(panel.props('plotConfig').groups).toHaveLength(1)
      expect(JSON.stringify(useSimulationSettingsStore().plotConfig)).toBe(before)

      // Removing a variable from the plot.
      await panel.find('button[aria-label="Stop plotting x"]').trigger('click')
      expect(panel.props('plotConfig').selections.map((selection) => selection.key)).toEqual(['a::t'])

      // The plot's menu sets what it plots against, and can't remove it.
      await panel.find('button[aria-label="More for Plot 1"]').trigger('click')
      await flushPromises()
      const menuLabels = [...document.body.querySelectorAll('.p-menu-item-label')].map((label) => label.textContent)
      expect(menuLabels).toEqual(['Plot against a variable…', 'Plot against time'])
    })

    it('runs when clicking a variable finds no current results of its scope, and only then', async () => {
      mountDialog({ defaultTab: 'plot' }, { isPanelReal: true })
      const editor = await open()
      await report(editor, 'init', XML)
      await flushPromises()
      const { useSimulationResultsStore } = await import('../../../src/stores/simulationResultsStore.js')
      const results = useSimulationResultsStore()

      await clickVariable('x')
      expect(run).toHaveBeenCalledExactlyOnceWith(null)

      results.finishRun({
        results: { voi: { name: 'environment/time', unit: 'second', values: Float64Array.of(0, 1) }, variables: new Map(), isStopped: false, issues: [] },
        mapping: new Map(),
        signature: 's',
      })
      await clickVariable('t')
      expect(run).toHaveBeenCalledOnce()

      simulation.isStale.value = true
      await clickVariable('x')
      expect(run).toHaveBeenCalledTimes(2)
      simulation.isStale.value = false

      // The instance's own run, while play runs the whole model.
      results.scopeNodeIds = ['a']
      await clickVariable('x')
      expect(run).toHaveBeenCalledTimes(3)
      expect(run).toHaveBeenLastCalledWith(null)
    })

    it('follows a variable an Apply renames, and drops one it removes', async () => {
      const { useSimulationSettingsStore } = await import('../../../src/stores/simulationSettingsStore.js')
      useSimulationSettingsStore().setPlotConfig({ groups: [{ id: 'plot-1', name: 'Plot 1' }], selections: [] })
      await openPlotTab()
      await clickVariable('x')
      await report(wrapper.findComponent(FakeEditor), 'edit', XML.replaceAll('name="x"', 'name="y"').replaceAll('<ci>x</ci>', '<ci>y</ci>'))

      await wrapper.findAll('button').find((button) => button.text() === 'Apply').trigger('click')
      await flushPromises()
      expect(wrapper.emitted('confirm')[0][0].plotVariables).toEqual([])
      // The workspace saves the instance, and the editor reloads it.
      const renamed = variables.map((row) => (row.name === 'x' ? { ...row, name: 'y' } : row))
      flowNodes.value = [{ id: 'a', data: { name: 'a', variables: renamed } }]
      await wrapper.setProps({ variables: renamed })
      await flushPromises()
      expect(plottedKeys()).toEqual(['a::y'])
      expect(plotTabLabel()).toBe('Plot (1)')

      await wrapper.findAll('button').find((button) => button.text() === 'Apply').trigger('click')
      await flushPromises()
      const removed = renamed.filter((row) => row.name !== 'y')
      flowNodes.value = [{ id: 'a', data: { name: 'a', variables: removed } }]
      await wrapper.setProps({ variables: removed })
      await flushPromises()
      expect(plottedKeys()).toEqual([])
      expect(plotTabLabel()).toBe('Plot (0)')
    })

    it('plots a variable clicked in the Math Editor', async () => {
      window.localStorage.setItem('instanceEditorDialog.editorKind', 'math')
      try {
        await openPlotTab()
        expect(wrapper.find('.plot-tab-auto-label').findComponent({ name: 'ToggleSwitch' }).props('disabled')).toBe(false)
        expect(wrapper.find('.plot-tab-auto-notice').exists()).toBe(false)

        await clickVariable('x')
        expect(plottedKeys()).toEqual(['a::x'])
      } finally {
        window.localStorage.clear()
      }
    })
  })

  it('sends the variables the instance plots with the save, as the workbench left them', async () => {
    await openPlotTab()
    const { useSimulationSettingsStore } = await import('../../../src/stores/simulationSettingsStore.js')
    const store = useSimulationSettingsStore()
    store.setPlotConfig({ ...store.plotConfig, selections: [...store.plotConfig.selections, { key: 'a::t', nodeId: 'a', nodeName: 'a', variableName: 't', units: 'second', type: 'variable', plot: true, groupId: 'plot-1' }] })

    await wrapper.findAll('button').find((button) => button.text() === 'Save').trigger('click')
    await flushPromises()

    const [save] = wrapper.emitted('confirm')[0]
    expect(save.plotVariables).toEqual([
      { name: 'x', groupId: 'plot-2' },
      { name: 't', groupId: 'plot-1' },
    ])
  })

  it('applies a save and stays open', async () => {
    await openPlotTab()
    await wrapper.findAll('button').find((button) => button.text() === 'Apply').trigger('click')
    await flushPromises()

    const [save] = wrapper.emitted('confirm')[0]
    expect(save.keepOpen).toBe(true)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('saves a plotted variable under its new name after a rename in the math', async () => {
    mountDialog({ defaultTab: 'plot' })
    const editor = await open()
    await report(editor, 'init', XML)
    await report(editor, 'edit', XML.replaceAll('name="x"', 'name="y"').replaceAll('<ci>x</ci>', '<ci>y</ci>'))

    await wrapper.findAll('button').find((button) => button.text() === 'Save').trigger('click')
    await flushPromises()

    const [save] = wrapper.emitted('confirm')[0]
    expect(save.plotVariables).toEqual([{ name: 'y', groupId: 'plot-2' }])
  })

  it('closes without asking when only plots changed, as they apply as they change', async () => {
    await openPlotTab()
    const { useSimulationSettingsStore } = await import('../../../src/stores/simulationSettingsStore.js')
    useSimulationSettingsStore().setPlotConfig({ groups: [{ id: 'plot-1', name: 'Plot 1' }], selections: [] })

    await wrapper.findAll('button').find((button) => button.text() === 'Cancel').trigger('click')
    await flushPromises()

    expect(confirm).not.toHaveBeenCalled()
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
  })
})

describe('InstanceEditorDialog multiport summary', () => {
  const port = (label, variables, multiportType, multiplyFactor) => ({ portType: 'general_ports', label, variables, multiportType, multiplyFactor })
  const ports = () => [port('pressure', ['k'], 'True'), port('flow', ['x'], 'Sum')]
  const leafPort = port('flow', ['x_out'], 'None')

  beforeAll(async () => {
    await ensureLibCellmlReady()
  })

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    window.localStorage.clear()
    useLibraryStore().addMath(MATH_REF, XML)
    const initialPorts = ports()
    flowNodes.value = [
      { id: 'a', data: { name: 'a', ports: initialPorts } },
      { id: 'leaf', data: { name: 'Leaf', ports: [leafPort] } },
    ]
    flowEdges.value = [{ id: 'a--leaf', source: 'a', target: 'leaf', data: { couplings: [{ sourcePort: initialPorts[1], targetPort: leafPort }] } }]
  })

  afterEach(() => {
    flowNodes.value = []
    flowEdges.value = []
  })

  const summaryText = () => wrapper.find('.multiport-summary__body').text().replace(/\s+/g, ' ')

  it.each(['text', 'math'])('shows the sum above the %s editor', async (kind) => {
    window.localStorage.setItem('instanceEditorDialog.editorKind', kind)
    mountDialog({ initialPorts: flowNodes.value[0].data.ports })
    await open()
    expect(summaryText()).toMatch(/x\s*=\s*x_out/)
  })

  it('follows the ports as they are edited, and leaves the saved ports and math alone', async () => {
    mountDialog({ initialPorts: flowNodes.value[0].data.ports })
    const editor = await open()
    await report(editor, 'init', XML)

    wrapper.vm.deletePort(0)
    await flushPromises()
    expect(summaryText()).toMatch(/x\s*=\s*x_out/)

    cycleMultiportType(wrapper.vm.editablePorts[0], 'x')
    await flushPromises()
    expect(summaryText()).toMatch(/x_out\s*=\s*x/)
    expect(summaryText()).not.toContain('Σ')

    await wrapper.findAll('button').find((button) => button.text() === 'Save').trigger('click')
    await flushPromises()
    const [save] = wrapper.emitted('confirm')[0]
    expect(save.ports).toEqual([{ ...port('flow', ['x'], 'Multiply', 1) }])
    expect(save.math).not.toContain('x_out')
  })
})

describe('InstanceEditorDialog connection status', () => {
  const kPort = { portType: 'general_ports', label: 'rate', variables: ['k'], multiportType: 'None' }
  const sourcePort = { portType: 'general_ports', label: 'rate', variables: ['k_src'], multiportType: 'None' }
  const variables = [
    { name: 't', units: 'second', type: 'variable', access: 'access' },
    { name: 'x', units: 'metre', type: 'variable', access: 'access', stateRole: 'state', initialiser: 'x0' },
    { name: 'x0', units: 'metre', type: 'constant', value: '1', access: 'access' },
    { name: 'k', units: 'per_second', type: 'boundary_condition', value: '', access: 'access' },
  ]

  beforeAll(async () => {
    await ensureLibCellmlReady()
  })

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useLibraryStore().addMath(MATH_REF, XML)
    flowNodes.value = [
      { id: 'src', data: { name: 'Src', variables: [{ name: 'k_src', units: 'per_second', type: 'variable' }], ports: [sourcePort] } },
      { id: 'a', data: { name: 'a', variables, ports: [kPort] } },
    ]
    flowEdges.value = [{ id: 'src--a', source: 'src', target: 'a', data: { couplings: [{ sourcePort, targetPort: kPort }] } }]
  })

  afterEach(() => {
    flowNodes.value = []
    flowEdges.value = []
  })

  it('names the supplier of a connected boundary condition, and warns once its port is deleted in the dialog', async () => {
    mountDialog({ variables, initialPorts: [kPort] })
    const editor = await open()
    await report(editor, 'init', XML)

    const kRow = () => wrapper.vm.parameterRows.find((row) => row.name === 'k')
    expect(kRow().type).toBe('boundary_condition')
    expect(wrapper.vm.connectionStatus.get('k')).toEqual({ state: 'connected', from: ['Src.k_src'] })
    expect(wrapper.vm.issueChips.map((chip) => chip.key)).not.toContain('unconnected')

    wrapper.vm.deletePort(0)
    await flushPromises()
    expect(wrapper.vm.connectionStatus.get('k')).toEqual({ state: 'missing', from: [] })
    expect(wrapper.vm.issueChips.find((chip) => chip.key === 'unconnected')?.label).toBe('1 boundary condition not connected')

    kRow().value = '0.5'
    await flushPromises()
    expect(wrapper.vm.connectionStatus.get('k')).toEqual({ state: 'own', from: [] })
    expect(wrapper.vm.issueChips.map((chip) => chip.key)).not.toContain('unconnected')
  })

  it('says which connection supplies a value export ignores', async () => {
    const valued = variables.map((row) => (row.name === 'k' ? { ...row, value: '2' } : row))
    mountDialog({ variables: valued, initialPorts: [kPort] })
    const editor = await open()
    await report(editor, 'init', XML)

    expect(wrapper.vm.ignoredNotices.get('k')).toBe('Set by Src.k_src: this value is ignored on export')
  })
})

describe('InstanceEditorDialog locked math', () => {
  const SOURCE = { format: 'celldl', document: '', documentUri: 'local:decay.celldl' }
  const stubProps = (component) => wrapper.findComponent(component).vm.$attrs

  beforeAll(async () => {
    await ensureLibCellmlReady()
  })

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useLibraryStore().addMath(MATH_REF, XML)
    flowNodes.value = [
      { id: 'a', data: { name: 'a', mathRef: MATH_REF } },
      { id: 'b', data: { name: 'b', mathRef: MATH_REF } },
    ]
  })

  afterEach(() => {
    flowNodes.value = []
    window.localStorage.clear()
    getErrors.mockImplementation(() => [])
    useCelldlEditorHost().isDirty.value = false
    useLiveCelldlConvert().cellml.value = null
  })

  /**
   * Opens a CellDL module's dialog, which shows its diagram, then switches to the CellML Text editor.
   *
   * @returns {Promise<import('@vue/test-utils').VueWrapper>} The editor.
   */
  async function openAsText() {
    await wrapper.setProps({ modelValue: true })
    await vi.waitFor(() => expect(wrapper.findComponent(CelldlPaneStub).exists()).toBe(true))
    await wrapper.vm.switchEditor('text')
    await flushPromises()
    return wrapper.findComponent(FakeEditor)
  }

  const editorTab = (label) => wrapper.findAll('.editor-tabs [role="tab"]').find((tab) => tab.text() === label)

  it('shows read-only math from a source in Simple Mode, and lets the user switch it, without managing it', async () => {
    useLibraryStore().setMathSource(MATH_REF, SOURCE)
    mountDialog()
    const editor = await openAsText()
    await report(editor, 'init', XML)

    expect(stubProps(FakeEditor).simple).toBe(true)
    editor.vm.$emit('update:simple', false)
    await flushPromises()
    expect(stubProps(FakeEditor).simple).toBe(false)
    expect(wrapper.vm.isManaged).toBe(false)
    editor.vm.$emit('update:simple', true)
    await flushPromises()
    expect(stubProps(FakeEditor).simple).toBe(true)
    expect(stubProps(FakeEditor).readonly).toBe(true)
  })

  it('shows math generated from a source read-only, with only its values editable', async () => {
    useLibraryStore().setMathSource(MATH_REF, SOURCE)
    mountDialog()
    const editor = await openAsText()
    await report(editor, 'init', XML)

    expect(stubProps(FakeEditor).readonly).toBe(true)
    // Its Parameters tab is the diagram's, with the math's text editor shown too.
    expect(wrapper.findComponent(CelldlParametersTabStub).exists()).toBe(true)
    expect(wrapper.findComponent(ParameterTableStub).exists()).toBe(false)
    expect(wrapper.findComponent(CelldlParametersTabStub).props('isDiagramShown')).toBe(false)
    expect(wrapper.vm.isManaged).toBe(false)
    // Its component can be renamed, and its math applied to the other instances, as for CellML.
    expect(wrapper.find('.header-group--secondary input').exists()).toBe(true)
    expect(wrapper.find('.apply-all-note').exists()).toBe(false)
    expect(wrapper.find('.apply-all-checkbox').text()).toContain('Apply math changes to all 2 instances')
  })

  it("edits this instance's value from the diagram's Parameters tab, a blank one taking the diagram's", async () => {
    useLibraryStore().setMathSource(MATH_REF, SOURCE)
    mountDialog()
    const editor = await openAsText()
    await report(editor, 'init', XML)
    const tab = wrapper.findComponent(CelldlParametersTabStub)
    tab.vm.$emit('set-value', { name: 'k', row: {} }, '2')
    tab.vm.$emit('set-value', { name: 'x0', row: {} }, '')
    await flushPromises()
    expect(wrapper.vm.hasUnsavedEdits).toBe(true)

    await wrapper.findAll('button').find((button) => button.text() === 'Save').trigger('click')
    await flushPromises()
    const [save] = wrapper.emitted('confirm')[0]
    expect(save.math).toBeNull()
    expect(save.variables.find((row) => row.name === 'k').value).toBe('2')
    expect(save.variables.find((row) => row.name === 'x0').value).toBe('1')
  })

  it('keeps Simple Mode off in the Math Editor, and saves to this instance unless told to apply to all', async () => {
    useLibraryStore().setMathSource(MATH_REF, SOURCE)
    mountDialog()
    const editor = await openAsText()
    await report(editor, 'init', XML)

    await wrapper.vm.switchEditor('math')
    wrapper.vm.onSimpleToggle(true)
    await flushPromises()
    expect(wrapper.vm.editorKind).toBe('math')
    expect(wrapper.vm.isManaged).toBe(false)
    expect(stubProps(FakeEditor).readonly).toBe(true)

    await wrapper.find('#applyToAll').setValue(false)
    await wrapper.findAll('button').find((button) => button.text() === 'Save').trigger('click')
    await flushPromises()
    const [save] = wrapper.emitted('confirm')[0]
    expect(save.updateAll).toBe(false)
    expect(save.math).toBeNull()
  })

  it("ignores the editor's errors, since its edits are never saved", async () => {
    useLibraryStore().setMathSource(MATH_REF, SOURCE)
    mountDialog()
    const editor = await openAsText()
    await report(editor, 'init', XML)
    getErrors.mockImplementation(() => [{ line: 1, message: 'This equation is incomplete.' }])

    await wrapper.vm.switchEditor('math')
    await wrapper.findAll('button').find((button) => button.text() === 'Save').trigger('click')
    await flushPromises()
    expect(confirm).not.toHaveBeenCalled()
    expect(wrapper.emitted('confirm')).toHaveLength(1)
  })

  it('opens a CellDL module on its diagram, which it prepares for the editor', async () => {
    const prepare = vi.spyOn(useCelldlEditorHost(), 'prepare')
    useLibraryStore().setMathSource(MATH_REF, SOURCE)
    mountDialog()
    await wrapper.setProps({ modelValue: true })
    await vi.waitFor(() => expect(wrapper.findComponent(CelldlPaneStub).exists()).toBe(true))

    expect(wrapper.vm.editorKind).toBe('celldl')
    expect(prepare).toHaveBeenCalledWith(SOURCE)
    expect(wrapper.findAll('.editor-tabs [role="tab"]').map((tab) => tab.text())).toEqual(['CellML Text', 'Math Editor', 'CellDL (beta)'])
    expect(editorTab('CellDL (beta)').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('.editor-tab-locked').exists()).toBe(false)
    prepare.mockRestore()
  })

  it("plots a diagram element's variable clicked with the Plot tab shown and auto-updating, and nothing otherwise", async () => {
    const variables = [
      { name: 't', units: 'second', type: 'variable' },
      { name: 'x', units: 'metre', type: 'variable' },
    ]
    flowNodes.value = [{ id: 'a', data: { name: 'a', mathRef: MATH_REF, variables } }]
    useLibraryStore().setMathSource(MATH_REF, SOURCE)
    mountDialog({ defaultTab: 'plot', variables })
    await wrapper.setProps({ modelValue: true })
    await vi.waitFor(() => expect(wrapper.findComponent(CelldlPaneStub).exists()).toBe(true))
    const pane = wrapper.findComponent(CelldlPaneStub)
    const plottedKeys = () => wrapper.findComponent({ name: 'SimulationPanel' }).props('plotConfig').selections.map((selection) => selection.key)

    expect(pane.vm.$attrs.rows.map((row) => row.name)).toEqual(expect.arrayContaining(['t', 'x']))
    pane.vm.$emit('variable-click', 'x')
    await flushPromises()
    expect(plottedKeys()).toEqual(['a::x'])

    wrapper.vm.showTab('parameters')
    pane.vm.$emit('variable-click', 't')
    await flushPromises()
    expect(wrapper.vm.activeTab).toBe('parameters')
    wrapper.vm.showTab('plot')
    await flushPromises()
    expect(plottedKeys()).toEqual(['a::x'])
  })

  it('locks the CellDL tab for CellML math, saying where diagrams start', async () => {
    const prepare = vi.spyOn(useCelldlEditorHost(), 'prepare')
    mountDialog()
    await open()

    expect(editorTab('CellDL (beta)').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.editor-tab-locked').exists()).toBe(true)
    await wrapper.vm.switchEditor('celldl')
    expect(wrapper.vm.editorKind).toBe('text')
    expect(prepare).not.toHaveBeenCalled()
    prepare.mockRestore()
  })

  it('counts diagram edits as unsaved, and asks before discarding them', async () => {
    useLibraryStore().setMathSource(MATH_REF, SOURCE)
    mountDialog({ defaultTab: 'plot' })
    await wrapper.setProps({ modelValue: true })
    await vi.waitFor(() => expect(wrapper.findComponent(CelldlPaneStub).exists()).toBe(true))
    expect(wrapper.vm.hasUnsavedEdits).toBe(false)
    expect(wrapper.find('.plot-tab-note').exists()).toBe(false)

    useCelldlEditorHost().isDirty.value = true
    await flushPromises()
    expect(wrapper.vm.hasUnsavedEdits).toBe(true)
    expect(wrapper.find('.plot-tab-note').exists()).toBe(true)

    confirm.mockResolvedValueOnce(false)
    await wrapper.findAll('button').find((button) => button.text() === 'Cancel').trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ header: 'Unsaved Changes' }))
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  describe('closing', () => {
    let mask, others

    /** Adds an element to the page, removed after the test. */
    const addToPage = (tag, className) => {
      const element = document.createElement(tag)
      if (className) element.className = className
      document.body.appendChild(element)
      others.push(element)
      return element
    }
    const press = (key, target = document.body) => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    const pointer = (type, target) => target.dispatchEvent(new Event(type, { bubbles: true }))
    // The guard acts once the event is done with.
    const settle = () => new Promise((resolve) => setTimeout(resolve)).then(flushPromises)
    const closed = () => (wrapper.emitted('update:modelValue') ?? []).some(([visible]) => visible === false)

    beforeEach(async () => {
      others = []
      useLibraryStore().setMathSource(MATH_REF, SOURCE)
      mountDialog()
      await wrapper.setProps({ modelValue: true })
      await vi.waitFor(() => expect(wrapper.findComponent(CelldlPaneStub).exists()).toBe(true))
      mask = addToPage('div', 'p-dialog-mask module-editor-mask')
    })

    afterEach(() => {
      others.forEach((element) => element.remove())
      useCelldlEditorHost().isEngaged.value = false
      useCelldlEditorHost().isDirty.value = false
    })

    it('leaves the closing to the guard, not the dialog', () => {
      const attrs = wrapper.findComponent(DialogStub).vm.$attrs
      expect(attrs.dismissableMask).toBe(false)
      expect(attrs.closeOnEscape).toBe(false)
    })

    it('closes on Escape, unless the diagram is in use', async () => {
      useCelldlEditorHost().isEngaged.value = true
      press('Escape')
      await settle()
      expect(closed()).toBe(false)

      useCelldlEditorHost().isEngaged.value = false
      press('Escape')
      await settle()
      expect(closed()).toBe(true)
    })

    it('leaves Escape to a popup, menu or dialog open above it', async () => {
      const popover = addToPage('div', 'p-popover')
      press('Escape')
      await settle()
      expect(closed()).toBe(false)

      popover.remove()
      addToPage('div', 'p-dialog-mask')
      press('Escape')
      await settle()
      expect(closed()).toBe(false)
    })

    it('leaves a focused search box on Escape, rather than closing', async () => {
      const search = addToPage('input')
      search.focus()
      press('Escape', search)
      await settle()
      expect(document.activeElement).not.toBe(search)
      expect(closed()).toBe(false)
    })

    it('leaves Escape to a field that uses it, e.g. to abandon a rename', async () => {
      const name = addToPage('input')
      name.addEventListener('keydown', (event) => event.stopPropagation())
      name.focus()
      press('Escape', name)
      await settle()
      expect(document.activeElement).toBe(name)
      expect(closed()).toBe(false)
    })

    it('leaves Escape to a popup that closes itself as the key reaches it', async () => {
      const popover = addToPage('div', 'p-popover')
      const item = document.createElement('button')
      popover.appendChild(item)
      item.addEventListener('keydown', () => popover.remove())
      press('Escape', item)
      await settle()
      expect(closed()).toBe(false)
    })

    it('closes on a click outside only while nothing is unsaved', async () => {
      useCelldlEditorHost().isDirty.value = true
      await flushPromises()
      pointer('pointerdown', mask)
      pointer('pointerup', mask)
      await settle()
      expect(closed()).toBe(false)
      expect(confirm).not.toHaveBeenCalled()

      useCelldlEditorHost().isDirty.value = false
      await flushPromises()
      pointer('pointerdown', mask)
      pointer('pointerup', mask)
      await settle()
      expect(closed()).toBe(true)
    })

    it('never takes a drag that ends outside, e.g. a pan of the diagram, for a click outside', async () => {
      const canvas = addToPage('div')
      pointer('pointerdown', canvas)
      pointer('pointerup', mask)
      await settle()
      expect(closed()).toBe(false)
    })

    it('keeps editing as the default answer when asked about unsaved edits', async () => {
      useCelldlEditorHost().isDirty.value = true
      await flushPromises()
      confirm.mockResolvedValueOnce(false)
      press('Escape')
      await settle()
      expect(confirm).toHaveBeenCalledWith(
        expect.objectContaining({ header: 'Unsaved Changes', acceptLabel: 'Discard & Close', isRejectDefault: true })
      )
      expect(closed()).toBe(false)
    })
  })

  it("ignores the CellDL editor's edits for CellML math", async () => {
    useCelldlEditorHost().isDirty.value = true
    mountDialog()
    await open()

    await wrapper.findAll('button').find((button) => button.text() === 'Cancel').trigger('click')
    await flushPromises()
    expect(confirm).not.toHaveBeenCalled()
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
  })

  describe('the live conversion', () => {
    // The decay model as an edited diagram converts it: k renamed.
    const LIVE_CELLML = XML.replaceAll('"k"', '"k_live"').replaceAll('<ci>k</ci>', '<ci>k_live</ci>')
    const shownModel = () => stubProps(FakeEditor)['model-value']
    // The decay math as stored, without its values.
    let savedMath

    /** Opens the CellDL module on its diagram and edits it, with the live conversion's CellML. */
    async function openEdited() {
      useLibraryStore().setMathSource(MATH_REF, SOURCE)
      mountDialog()
      await wrapper.setProps({ modelValue: true })
      await vi.waitFor(() => expect(wrapper.findComponent(CelldlPaneStub).exists()).toBe(true))
      savedMath = wrapper.vm.currentModel
      useCelldlEditorHost().isDirty.value = true
      useLiveCelldlConvert().cellml.value = { cellml: LIVE_CELLML, componentName: 'decay' }
      await wrapper.vm.switchEditor('text')
      await flushPromises()
      return wrapper.findComponent(FakeEditor)
    }

    it("shows the edited diagram's math read-only, leaving the session's math as saved", async () => {
      const editor = await openEdited()
      expect(shownModel()).toContain('k_live')
      expect(shownModel()).not.toContain('initial_value="0.5"')
      expect(stubProps(FakeEditor).readonly).toBe(true)

      // The editor reports the math it shows, as on mounting or a change of definitions.
      await report(editor, 'init', shownModel())
      await report(editor, 'external', shownModel())
      expect(wrapper.vm.currentModel).toBe(savedMath)
      expect(wrapper.vm.isMathEdited).toBe(false)
      expect(wrapper.vm.parameterRows.map((row) => row.name)).not.toContain('k_live')
    })

    it('follows newer conversions, with their sections, and shows the saved math again once the diagram is saved', async () => {
      await openEdited()
      const sections = [{ title: 'Conservation', variables: ['x'] }]
      useLiveCelldlConvert().cellml.value = { cellml: LIVE_CELLML.replaceAll('k_live', 'k_newer'), componentName: 'decay', sections }
      await flushPromises()
      const [shown, layout] = setModel.mock.lastCall
      expect(shown).toContain('k_newer')
      expect(layout.components[0].statements.find((statement) => statement.kind === 'eq').leading).toEqual(['', '// Conservation'])

      useCelldlEditorHost().isDirty.value = false
      await flushPromises()
      expect(setModel).toHaveBeenLastCalledWith(savedMath, null)
    })

    it('shows the saved math after a cancel, though the last conversion is kept', async () => {
      await openEdited()
      await wrapper.findAll('button').find((button) => button.text() === 'Cancel').trigger('click')
      await flushPromises()
      expect(wrapper.emitted('update:modelValue')).toEqual([[false]])

      await wrapper.setProps({ modelValue: false })
      await wrapper.setProps({ modelValue: true })
      await vi.waitFor(() => expect(wrapper.findComponent(CelldlPaneStub).exists()).toBe(true))
      await wrapper.vm.switchEditor('text')
      await flushPromises()
      expect(useLiveCelldlConvert().cellml.value).not.toBeNull()
      expect(shownModel()).toBe(savedMath)
    })

    it('shows the math of the module it was converted as, and nothing for another', async () => {
      useLiveCelldlConvert().cellml.value = null
      await openEdited()
      useLiveCelldlConvert().cellml.value = { cellml: LIVE_CELLML, componentName: 'other' }
      await flushPromises()
      expect(setModel).toHaveBeenLastCalledWith(savedMath, null)
    })
  })

  describe('saving an edited diagram', () => {
    const EDITED_DOCUMENT = '<svg>rc edited</svg>'
    // The decay math as the edited diagram gives it: a new parameter c, with its value.
    const GENERATED_XML = XML.replace(
      '<variable name="k"',
      '<variable name="c" units="metre" initial_value="3"/>\n    <variable name="k"'
    ).replace('<ci>k</ci></apply><ci>x</ci>', '<ci>k</ci></apply><apply><plus/><ci>x</ci><ci>c</ci></apply>')
    const converted = (overrides = {}) => ({
      ok: true,
      components: [{ name: 'decay', math: GENERATED_XML }],
      unitsModel: '<model name="units"/>',
      elements: { R: { primary: 'v_R' } },
      documentUri: SOURCE.documentUri,
      generator: { name: 'bg2cellml', version: '0.2.0' },
      frameworkVersion: '1.0',
      errors: [],
      warnings: [],
      ...overrides,
    })
    let host

    beforeEach(() => {
      host = useCelldlEditorHost()
      vi.spyOn(host, 'compareWithBaseline').mockResolvedValue({ isChanged: true, document: EDITED_DOCUMENT })
      vi.spyOn(host, 'highlight').mockImplementation(() => {})
      vi.spyOn(host, 'markSaved').mockImplementation(() => {})
      convertCelldl.mockResolvedValue(converted())
      useLibraryStore().setMathSource(MATH_REF, SOURCE)
    })

    afterEach(() => vi.restoreAllMocks())

    /** Opens the dialog on the diagram, edits it, and saves. */
    async function saveEdited(button = 'Save') {
      mountDialog()
      await wrapper.setProps({ modelValue: true })
      await vi.waitFor(() => expect(wrapper.findComponent(CelldlPaneStub).exists()).toBe(true))
      host.isDirty.value = true
      await clickSave(button)
    }

    /** Clicks a save button and waits for the save, which loads the converter, to finish. */
    async function clickSave(button = 'Save') {
      await wrapper.findAll('button').find((candidate) => candidate.text() === button).trigger('click')
      await vi.waitFor(() => expect(wrapper.vm.isSaving).toBe(false))
      await flushPromises()
    }

    it('converts the diagram under its documentUri and saves the source, math and units, after asking to overwrite', async () => {
      await saveEdited()

      expect(choose).toHaveBeenCalledWith(expect.objectContaining({ header: 'Overwrite Math?' }))
      expect(choose.mock.calls[0][0].message).toContain('This will affect 1 other instance.')

      expect(convertCelldl).toHaveBeenCalledWith(EDITED_DOCUMENT, expect.objectContaining({ documentUri: SOURCE.documentUri, componentName: 'decay' }))
      const [save] = wrapper.emitted('confirm')[0]
      expect(save).toMatchObject({
        mathRef: MATH_REF,
        math: GENERATED_XML,
        isSourceChanged: true,
        source: { format: 'celldl', document: EDITED_DOCUMENT, elements: { R: { primary: 'v_R' } }, frameworkVersion: '1.0' },
        units: { componentFile: 'file', model: '<model name="units"/>' },
        updateAll: true,
        siblings: ['b'],
      })
      expect(save.variables.find((row) => row.name === 'c').value).toBe('3')
      expect(host.markSaved).toHaveBeenCalledWith(save.source)
    })

    it("keeps the module's defaults for its variables, so the diagram's values only fill variables new to it", async () => {
      convertCelldl.mockResolvedValue(
        converted({ components: [{ name: 'decay', math: GENERATED_XML.replace('initial_value="0.5"', 'initial_value="0.9"') }] })
      )
      await saveEdited()

      const [save] = wrapper.emitted('confirm')[0]
      expect(save.variables.find((row) => row.name === 'k').value).toBe('0.5')
      expect(save.variables.find((row) => row.name === 'c').value).toBe('3')
      expect(new Map(save.previousDefaults).get('k')).toBe('0.5')
      expect(save).not.toHaveProperty('keptValues')
    })

    describe('when the diagram changes units', () => {
      const unitsXml = (definitions) => `<model xmlns="http://www.cellml.org/cellml/2.0#" name="units">${definitions}</model>`
      const PER_SECOND = '<units name="per_second"><unit units="second" exponent="-1"/></units>'
      const PER_MS = '<units name="per_ms"><unit prefix="milli" units="second" exponent="-1"/></units>'
      const IN_MS = GENERATED_XML.replace('name="k" units="per_second"', 'name="k" units="per_ms"')

      beforeEach(() => {
        useLibraryStore().addUnitsFile({ componentFile: 'file', model: unitsXml(PER_SECOND) })
        convertCelldl.mockResolvedValue(converted({ components: [{ name: 'decay', math: IN_MS }], unitsModel: unitsXml(PER_MS) }))
      })

      it("rescales the instance's values and the module's defaults to the new units, saying by how much", async () => {
        await saveEdited()

        const asked = confirm.mock.calls.find(([options]) => options.header === 'Units Changed')[0]
        expect(asked.message).toContain('every instance of the module')
        expect(asked.issues).toEqual([{ key: 'k', label: 'k', message: 'per_second → per_ms, ×0.001' }])
        const [save] = wrapper.emitted('confirm')[0]
        expect(save.variables.find((row) => row.name === 'k')).toMatchObject({ value: '0.0005', units: 'per_ms' })
        expect(save.unitRescales).toEqual([{ name: 'k', from: 'per_second', to: 'per_ms', factor: { coefficient: 1, power: -3 } }])
        expect(new Map(save.previousDefaults).get('k')).toBe('0.0005')
      })

      it('saves nothing when the rescale is declined', async () => {
        confirm.mockImplementation(async (options) => options.header !== 'Units Changed')
        await saveEdited()
        confirm.mockImplementation(async () => true)

        expect(wrapper.emitted('confirm')).toBeUndefined()
        const k = wrapper.vm.parameterRows.find((row) => row.name === 'k')
        expect(k.units).toBe('per_second')
        expect(k.value).not.toBe('0.0005')
      })

      it('relabels units that keep their scale without asking', async () => {
        const PER_S = '<units name="per_s"><unit units="second" exponent="-1"/></units>'
        convertCelldl.mockResolvedValue(
          converted({ components: [{ name: 'decay', math: IN_MS.replace('units="per_ms"', 'units="per_s"') }], unitsModel: unitsXml(PER_S) })
        )
        await saveEdited()

        expect(confirm.mock.calls.some(([options]) => options.header === 'Units Changed')).toBe(false)
        const [save] = wrapper.emitted('confirm')[0]
        expect(save.variables.find((row) => row.name === 'k')).toMatchObject({ value: '0.5', units: 'per_s' })
      })
    })

    describe('when only the diagram changed', () => {
      const UNITS_XML = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="units">
  <units name="per_second"><unit units="second" exponent="-1"/></units>
  <units name="per_metre"><unit units="metre" exponent="-1"/></units>
</model>`
      // The stored units, written in another order and spacing.
      const REORDERED_UNITS = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="units"><units name="per_metre"><unit exponent="-1" units="metre"/></units><units name="per_second"><unit units="second" exponent="-1"/></units></model>`

      beforeEach(() => {
        useLibraryStore().addUnitsFile({ componentFile: 'file', model: UNITS_XML })
        // The stored math, regenerated with its variables in another order and other values.
        const reordered = XML.replace('<variable name="t" units="second" interface="public_and_private"/>', '')
          .replace('<variable name="k" units="per_second" initial_value="0.5"/>', '<variable name="k" units="per_second" initial_value="0.9"/>\n    <variable name="t" units="second" interface="public_and_private"/>')
        convertCelldl.mockResolvedValue(converted({ components: [{ name: 'decay', math: reordered }], unitsModel: REORDERED_UNITS }))
      })

      it("saves the diagram without asking, keeping the module's math, units and the instance's values", async () => {
        const mathBefore = useLibraryStore().availableMath.get(MATH_REF)
        await saveEdited()

        expect(choose).not.toHaveBeenCalled()
        const [save] = wrapper.emitted('confirm')[0]
        expect(save).toMatchObject({
          mathRef: MATH_REF,
          previousMathRef: MATH_REF,
          math: null,
          isSourceChanged: true,
          source: { ...SOURCE, document: EDITED_DOCUMENT, elements: { R: { primary: 'v_R' } }, frameworkVersion: '1.0' },
          units: null,
          previousDefaults: null,
          renames: [],
        })
        expect(save.variables.find((row) => row.name === 'k').value).toBe('0.5')
        expect(useLibraryStore().availableMath.get(MATH_REF)).toBe(mathBefore)
        expect(host.markSaved).toHaveBeenCalledWith(save.source)
      })

      it('still asks to overwrite when the units change', async () => {
        convertCelldl.mockResolvedValue(
          converted({ components: [{ name: 'decay', math: XML }], unitsModel: UNITS_XML.replace('exponent="-1"/></units>\n</model>', 'exponent="-2"/></units>\n</model>') })
        )
        await saveEdited()

        expect(choose).toHaveBeenCalledWith(expect.objectContaining({ header: 'Overwrite Math?' }))
        expect(wrapper.emitted('confirm')[0][0]).toMatchObject({ math: XML, units: { componentFile: 'file' } })
      })

      it('still follows the rename rules when the component is renamed', async () => {
        const NEW_URI = 'https://bg-rdf.org/models/local/phlynx/file_fast.celldl'
        convertCelldl.mockResolvedValue(converted({ components: [{ name: 'fast', math: XML.replaceAll('decay', 'fast') }], documentUri: NEW_URI }))
        mountDialog()
        await wrapper.setProps({ modelValue: true })
        await vi.waitFor(() => expect(wrapper.findComponent(CelldlPaneStub).exists()).toBe(true))
        host.isDirty.value = true
        await wrapper.find('.header-group--secondary input').setValue('fast')
        await clickSave()

        const [save] = wrapper.emitted('confirm')[0]
        expect(save).toMatchObject({ mathRef: 'file:fast', isSourceChanged: true })
        expect(save.math).not.toBeNull()
      })
    })

    it('applies the overwrite to every instance when ticked', async () => {
      mountDialog()
      await wrapper.setProps({ modelValue: true })
      await vi.waitFor(() => expect(wrapper.findComponent(CelldlPaneStub).exists()).toBe(true))
      host.isDirty.value = true
      await wrapper.find('#applyToAll').setValue(true)
      await clickSave()

      expect(wrapper.emitted('confirm')[0][0]).toMatchObject({ mathRef: MATH_REF, updateAll: true, siblings: ['b'] })
    })

    describe('saved as a new component', () => {
      const NEW_URI = 'https://bg-rdf.org/models/local/phlynx/file_fast.celldl'
      const FAST_XML = GENERATED_XML.replaceAll('decay', 'fast')

      beforeEach(() => {
        // Converted under the module's name first, then again as the new component.
        convertCelldl
          .mockResolvedValueOnce(converted())
          .mockResolvedValue(converted({ components: [{ name: 'fast', math: FAST_XML }], documentUri: NEW_URI }))
      })

      /**
       * Saves the edited diagram as a new component, and waits for Save As to ask its name: ticked, chosen instead of
       * overwriting; unticked, asked straight away, as the other instance uses the module's math.
       */
      async function startSaveAs({ isAppliedToAll = false } = {}) {
        if (isAppliedToAll) choose.mockResolvedValueOnce('extra')
        mountDialog()
        await wrapper.setProps({ modelValue: true })
        await vi.waitFor(() => expect(wrapper.findComponent(CelldlPaneStub).exists()).toBe(true))
        host.isDirty.value = true
        await wrapper.find('#applyToAll').setValue(isAppliedToAll)
        await wrapper.findAll('button').find((candidate) => candidate.text() === 'Save').trigger('click')
        await vi.waitFor(() => expect(wrapper.findComponent(ComponentSaveAsDialog).exists()).toBe(true))
        return wrapper.findComponent(ComponentSaveAsDialog)
      }

      /** Answers Save As and waits for the save to finish. */
      async function answer(saveAs, name) {
        saveAs.vm.$emit(name ? 'confirm' : 'cancel', name)
        await vi.waitFor(() => expect(wrapper.vm.isSaving).toBe(false))
        await flushPromises()
      }

      it('refuses a used or template name, then saves a new module for this instance with its own diagram and documentUri', async () => {
        useLibraryStore().addMath('file:slow', XML.replaceAll('decay', 'slow'))
        // Names need only differ within a grouping.
        useLibraryStore().addMath('User_Modules.cellml:quick', XML.replaceAll('decay', 'quick'))
        const saveAs = await startSaveAs()
        expect(choose).not.toHaveBeenCalled()
        expect(saveAs.props('message')).toContain('1 other instance uses decay')
        const isTaken = saveAs.props('isTaken')
        expect(isTaken('decay')).toBe('"decay" is used by the other instances.')
        expect(isTaken('slow')).toBe('A component named "slow" already exists.')
        expect(isTaken('new_module')).toBe('"new_module" is a template and can\'t be overwritten.')
        expect(isTaken('Slow')).toBe('A component named "Slow" already exists.')
        expect(isTaken('Ghost')).toBe('"Ghost" is a template and can\'t be overwritten.')
        expect(isTaken('quick')).toBe('')
        expect(isTaken('fast')).toBe('')
        await answer(saveAs, 'fast')

        expect(convertCelldl).toHaveBeenCalledTimes(2)
        expect(convertCelldl).toHaveBeenLastCalledWith(EDITED_DOCUMENT, expect.objectContaining({ documentUri: NEW_URI, componentName: 'fast' }))
        expect(wrapper.emitted('confirm')[0][0]).toMatchObject({
          mathRef: 'file:fast',
          previousMathRef: MATH_REF,
          math: FAST_XML,
          source: { format: 'celldl', document: EDITED_DOCUMENT, documentUri: NEW_URI },
          units: { componentFile: 'file', model: '<model name="units"/>' },
          updateAll: false,
          siblings: [],
        })
        expect(useLibraryStore().getMathSource(MATH_REF)).toEqual(SOURCE)
      })

      it('moves the other instances to it too when ticked', async () => {
        await answer(await startSaveAs({ isAppliedToAll: true }), 'fast')

        expect(wrapper.emitted('confirm')[0][0]).toMatchObject({ mathRef: 'file:fast', updateAll: true, siblings: ['b'] })
      })

      it('saves nothing when Save As is cancelled', async () => {
        await answer(await startSaveAs(), null)

        expect(convertCelldl).toHaveBeenCalledTimes(1)
        expect(wrapper.emitted('confirm')).toBeUndefined()
        expect(host.markSaved).not.toHaveBeenCalled()
      })
    })

    describe('under a new component name', () => {
      const NEW_URI = 'https://bg-rdf.org/models/local/phlynx/file_fast.celldl'
      const FAST_XML = GENERATED_XML.replaceAll('decay', 'fast')

      beforeEach(() => {
        convertCelldl.mockResolvedValue(converted({ components: [{ name: 'fast', math: FAST_XML }], documentUri: NEW_URI }))
      })

      /**
       * Opens the dialog on the diagram and renames its component, editing the diagram too unless told not to, for this
       * instance alone unless told to apply to all.
       */
      async function openRenamed(name = 'fast', { isEdited = true, isAppliedToAll = false } = {}) {
        mountDialog()
        await wrapper.setProps({ modelValue: true })
        await vi.waitFor(() => expect(wrapper.findComponent(CelldlPaneStub).exists()).toBe(true))
        host.isDirty.value = isEdited
        await wrapper.find('#applyToAll').setValue(isAppliedToAll)
        await wrapper.find('.header-group--secondary input').setValue(name)
      }

      it('saves a new module for this instance, with its own copy of the diagram, file and documentUri', async () => {
        await openRenamed()
        await clickSave()

        expect(choose).not.toHaveBeenCalled()
        expect(convertCelldl).toHaveBeenCalledWith(EDITED_DOCUMENT, expect.objectContaining({ documentUri: NEW_URI, componentName: 'fast' }))
        const [save] = wrapper.emitted('confirm')[0]
        expect(save).toMatchObject({
          mathRef: 'file:fast',
          previousMathRef: MATH_REF,
          math: FAST_XML,
          source: { format: 'celldl', document: EDITED_DOCUMENT, documentUri: NEW_URI },
          units: { componentFile: 'file', model: '<model name="units"/>' },
          updateAll: false,
          siblings: [],
        })
        expect(useLibraryStore().getMathSource(MATH_REF)).toEqual(SOURCE)
      })

      it('previews the diagram under its own math, then under the name it is renamed to', async () => {
        await openRenamed(MATH_REF.split(':')[1], { isEdited: false })
        expect(wrapper.findComponent(CelldlPaneStub).vm.$attrs['math-ref']).toBe(MATH_REF)

        await wrapper.find('.header-group--secondary input').setValue('fast')
        expect(wrapper.findComponent(CelldlPaneStub).vm.$attrs['math-ref']).toBe('file:fast')
      })

      it('moves the other instances to it too when ticked', async () => {
        await openRenamed()
        await wrapper.find('#applyToAll').setValue(true)
        await clickSave()

        expect(wrapper.emitted('confirm')[0][0]).toMatchObject({ mathRef: 'file:fast', updateAll: true, siblings: ['b'] })
      })

      it('copies the stored diagram when only the name changed', async () => {
        useLibraryStore().setMathSource(MATH_REF, { ...SOURCE, document: '<svg>stored</svg>' })
        await openRenamed('fast', { isEdited: false })
        await clickSave()

        expect(host.compareWithBaseline).not.toHaveBeenCalled()
        expect(convertCelldl).toHaveBeenCalledWith('<svg>stored</svg>', expect.objectContaining({ documentUri: NEW_URI, componentName: 'fast' }))
        expect(wrapper.emitted('confirm')[0][0]).toMatchObject({ mathRef: 'file:fast', source: { document: '<svg>stored</svg>' } })
        expect(host.markSaved).not.toHaveBeenCalled()
      })

      it('reads a diagram naming its model under its absolute IRI under the new one', async () => {
        const absolute = 'https://example.org/decay.celldl'
        useLibraryStore().setMathSource(MATH_REF, { ...SOURCE, documentUri: absolute })
        host.compareWithBaseline.mockResolvedValue({ isChanged: true, document: `<svg about="${absolute}#model"/>` })
        await openRenamed()
        await clickSave()

        expect(convertCelldl).toHaveBeenCalledWith(`<svg about="${NEW_URI}#model"/>`, expect.objectContaining({ documentUri: NEW_URI }))
        expect(host.markSaved).not.toHaveBeenCalled()
      })

      it('keeps a renamed User_Modules.celldl module in User_Modules.celldl', async () => {
        const USER_REF = 'User_Modules.celldl:decay'
        useLibraryStore().addMath(USER_REF, XML)
        useLibraryStore().setMathSource(USER_REF, SOURCE)
        flowNodes.value = [{ id: 'a', data: { name: 'a', mathRef: USER_REF } }]
        mountDialog({ mathRef: USER_REF })
        await wrapper.setProps({ modelValue: true })
        await vi.waitFor(() => expect(wrapper.findComponent(CelldlPaneStub).exists()).toBe(true))
        host.isDirty.value = true
        await wrapper.find('.header-group--secondary input').setValue('fast')
        await clickSave()

        expect(wrapper.emitted('confirm')[0][0]).toMatchObject({
          mathRef: 'User_Modules.celldl:fast',
          previousMathRef: USER_REF,
          units: { componentFile: 'User_Modules.celldl' },
        })
      })

      it("keeps the units its grouping's other modules use, its source module's among them", async () => {
        const PER_SECOND = '<model xmlns="http://www.cellml.org/cellml/2.0#" name="units"><units name="per_second"><unit units="second" exponent="-1"/></units></model>'
        useLibraryStore().addUnitsFile({ componentFile: 'file', model: PER_SECOND })
        await openRenamed()
        await clickSave()

        const [save] = wrapper.emitted('confirm')[0]
        expect(save.units.componentFile).toBe('file')
        expect(save.units.model).toContain('per_second')
      })

      it('asks for another name when the new one is taken', async () => {
        useLibraryStore().addMath('file:fast', XML.replaceAll('decay', 'fast'))
        await openRenamed()
        await wrapper.findAll('button').find((candidate) => candidate.text() === 'Save').trigger('click')
        await vi.waitFor(() => expect(wrapper.findComponent(ComponentSaveAsDialog).exists()).toBe(true))
        expect(wrapper.findComponent(ComponentSaveAsDialog).props('message')).toContain('A component named "fast" already exists.')
        convertCelldl.mockResolvedValue(converted({ components: [{ name: 'faster', math: FAST_XML.replaceAll('fast', 'faster') }] }))
        wrapper.findComponent(ComponentSaveAsDialog).vm.$emit('confirm', 'faster')
        await vi.waitFor(() => expect(wrapper.vm.isSaving).toBe(false))
        await flushPromises()

        expect(wrapper.emitted('confirm')[0][0].mathRef).toBe('file:faster')
      })

      describe("onto another diagram's module", () => {
        const FAST_REF = 'file:fast'
        const FAST_SOURCE = { format: 'celldl', document: '<svg>fast</svg>', documentUri: 'local:fast.celldl', elements: {} }

        beforeEach(() => {
          const library = useLibraryStore()
          library.addMath(FAST_REF, XML.replaceAll('decay', 'fast'))
          library.setMathSource(FAST_REF, FAST_SOURCE)
          flowNodes.value = [...flowNodes.value, { id: 'c', data: { name: 'c', mathRef: FAST_REF } }, { id: 'd', data: { name: 'd', mathRef: FAST_REF } }]
          convertCelldl.mockResolvedValue(converted({ components: [{ name: 'fast', math: FAST_XML }], documentUri: FAST_SOURCE.documentUri }))
        })

        it("asks, then overwrites it with this diagram under its documentUri and file, moving the instances on this module to it when ticked", async () => {
          await openRenamed('fast', { isAppliedToAll: true })
          await clickSave()

          expect(choose).toHaveBeenCalledWith(
            expect.objectContaining({ header: 'Overwrite Math?', acceptLabel: 'Overwrite', extraLabel: 'Save as new component' })
          )
          expect(choose.mock.calls[0][0].message).toBe(
            '"fast" already exists. This will affect 3 other instances. Overwrite it, or save your changes as a new component?'
          )
          expect(convertCelldl).toHaveBeenCalledWith(EDITED_DOCUMENT, expect.objectContaining({ documentUri: FAST_SOURCE.documentUri, componentName: 'fast' }))
          const [save] = wrapper.emitted('confirm')[0]
          expect(save).toMatchObject({
            mathRef: FAST_REF,
            previousMathRef: MATH_REF,
            math: FAST_XML,
            isSourceChanged: true,
            source: { format: 'celldl', document: EDITED_DOCUMENT, documentUri: FAST_SOURCE.documentUri },
            units: { componentFile: 'file', model: '<model name="units"/>' },
            updateAll: true,
            siblings: ['b'],
          })
          expect(useLibraryStore().getMathSource(MATH_REF)).toEqual(SOURCE)
        })

        it('saves as a new component under an unused name instead, when asked', async () => {
          choose.mockResolvedValueOnce('extra')
          await openRenamed('fast', { isAppliedToAll: true })
          await wrapper.findAll('button').find((candidate) => candidate.text() === 'Save').trigger('click')
          await vi.waitFor(() => expect(wrapper.findComponent(ComponentSaveAsDialog).exists()).toBe(true))
          const saveAs = wrapper.findComponent(ComponentSaveAsDialog)
          expect(saveAs.props('initialName')).toBe('fast')
          expect(saveAs.props('isTaken')('fast')).toBe('A component named "fast" already exists.')
          expect(saveAs.props('isTaken')('new_module')).toBe('"new_module" is a template and can\'t be overwritten.')
          convertCelldl.mockResolvedValue(converted({ components: [{ name: 'faster', math: FAST_XML.replaceAll('fast', 'faster') }] }))
          saveAs.vm.$emit('confirm', 'faster')
          await vi.waitFor(() => expect(wrapper.vm.isSaving).toBe(false))
          await flushPromises()

          const [save] = wrapper.emitted('confirm')[0]
          expect(save).toMatchObject({ mathRef: 'file:faster', units: { componentFile: 'file' } })
          expect(save.source.documentUri).not.toBe(FAST_SOURCE.documentUri)
        })

        it('saves nothing when cancelled', async () => {
          choose.mockResolvedValueOnce('reject')
          await openRenamed('fast', { isAppliedToAll: true })
          await clickSave()

          expect(wrapper.emitted('confirm')).toBeUndefined()
        })

        it("goes straight to Save As for a CellML module's name", async () => {
          useLibraryStore().setMathSource(FAST_REF, null)
          await openRenamed()
          await wrapper.findAll('button').find((candidate) => candidate.text() === 'Save').trigger('click')
          await vi.waitFor(() => expect(wrapper.findComponent(ComponentSaveAsDialog).exists()).toBe(true))

          expect(choose).not.toHaveBeenCalled()
          expect(wrapper.findComponent(ComponentSaveAsDialog).props('message')).toContain('A component named "fast" already exists.')
        })

        it("goes straight to Save As for a template's name", async () => {
          await openRenamed('new_module')
          await wrapper.findAll('button').find((candidate) => candidate.text() === 'Save').trigger('click')
          await vi.waitFor(() => expect(wrapper.findComponent(ComponentSaveAsDialog).exists()).toBe(true))

          expect(choose).not.toHaveBeenCalled()
          expect(wrapper.findComponent(ComponentSaveAsDialog).props('message')).toContain('is a template')
        })
      })
    })

    it("gives a value typed for a variable the diagram adds to the row the save makes", async () => {
      mountDialog()
      await wrapper.setProps({ modelValue: true })
      await vi.waitFor(() => expect(wrapper.findComponent(CelldlPaneStub).exists()).toBe(true))
      host.isDirty.value = true
      const tab = wrapper.findComponent(CelldlParametersTabStub)
      tab.vm.$emit('set-value', { name: 'c', row: null }, '7')
      tab.vm.$emit('set-value', { name: 'k', row: {} }, '0.25')
      await clickSave()

      const [save] = wrapper.emitted('confirm')[0]
      expect(save.variables.find((row) => row.name === 'c').value).toBe('7')
      expect(save.variables.find((row) => row.name === 'k').value).toBe('0.25')
    })

    it('saves its own conversion, not the live one shown', async () => {
      useLiveCelldlConvert().cellml.value = { cellml: XML.replaceAll('"k"', '"k_live"'), componentName: 'decay' }
      await saveEdited()

      expect(convertCelldl).toHaveBeenCalledTimes(1)
      expect(wrapper.emitted('confirm')[0][0].math).toBe(GENERATED_XML)
    })

    it("blocks the save on errors, listing them and highlighting their elements, and keeps what's stored", async () => {
      convertCelldl.mockResolvedValue(
        converted({ ok: false, components: null, errors: [{ message: 'R has no value', elementId: 'R' }, { message: 'No model' }] })
      )
      await saveEdited()

      expect(alert).toHaveBeenCalledWith(expect.objectContaining({ header: 'Diagram Has Errors', severity: 'error' }))
      expect(alert.mock.calls[0][0].message).toBe("The diagram can't be converted, so nothing was saved:")
      expect(alert.mock.calls[0][0].issues).toEqual([
        { key: 'error-0', severity: 'error', message: 'R has no value', elementId: 'R', label: 'R' },
        { key: 'error-1', severity: 'error', message: 'No model', elementId: null, label: null },
      ])
      expect(host.highlight).toHaveBeenCalledWith(['R'])
      expect(wrapper.emitted('confirm')).toBeUndefined()
      expect(wrapper.emitted('update:modelValue')).toBeUndefined()
      expect(useLibraryStore().getMathSource(MATH_REF)).toEqual(SOURCE)
      expect(wrapper.vm.hasUnsavedEdits).toBe(true)
    })

    describe("following an error's element link", () => {
      let toasts
      let pane
      const onToast = (toast) => toasts.push(toast)

      beforeEach(() => {
        toasts = []
        ToastEventBus.on('add', onToast)
        convertCelldl.mockResolvedValue(
          converted({ ok: false, components: null, errors: [{ message: 'R has no value', elementId: 'R' }], elements: { R: { symbol: 'R_1' } } })
        )
      })

      /** Follows the first issue's link in the next alert or confirm, which closes it. */
      const followFirstIssue = (dialog) =>
        dialog.mockImplementationOnce(async ({ issues, onIssue }) => {
          onIssue(issues[0])
          return false
        })

      afterEach(() => {
        ToastEventBus.off('add', onToast)
        host.release(pane)
      })

      async function follow(reply, dialog = alert) {
        followFirstIssue(dialog)
        const reveal = vi.spyOn(host, 'revealElement').mockResolvedValue(reply)
        await saveEdited()
        // The CellDL tab shows the diagram once its pane holds the editor.
        pane = document.createElement('div')
        host.claim(pane)
        await vi.waitFor(() => expect(reveal).toHaveBeenCalledWith('R'))
        await flushPromises()
        return reveal
      }

      it('shows the CellDL tab and reveals the element, keeping the error highlight', async () => {
        await follow({ ok: true })
        expect(wrapper.vm.editorKind).toBe('celldl')
        expect(alert.mock.calls[0][0].issues[0].label).toBe('R_1')
        expect(host.highlight).toHaveBeenCalledTimes(1)
        expect(toasts).toEqual([])
        expect(wrapper.emitted('update:modelValue')).toBeUndefined()
      })

      it("cancels a save with warnings on following a warning's link", async () => {
        convertCelldl.mockResolvedValue(converted({ warnings: [{ message: 'Unused bond', elementId: 'R' }] }))
        await follow({ ok: true }, confirm)
        expect(wrapper.emitted('confirm')).toBeUndefined()
        expect(wrapper.vm.editorKind).toBe('celldl')
      })

      it('says quietly when the element has gone since', async () => {
        await follow({ ok: false })
        expect(toasts).toEqual([expect.objectContaining({ severity: 'info', detail: 'R_1 is no longer in the diagram.' })])
      })
    })

    it('asks before saving a diagram with warnings', async () => {
      convertCelldl.mockResolvedValue(converted({ warnings: [{ message: 'Unused bond', elementId: 'B' }] }))
      confirm.mockResolvedValueOnce(false)
      await saveEdited()

      expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ header: 'Diagram Warnings' }))
      expect(confirm.mock.calls[0][0].issues).toEqual([
        { key: 'warning-0', severity: 'warning', message: 'Unused bond', elementId: 'B', label: 'B' },
      ])
      expect(wrapper.emitted('confirm')).toBeUndefined()

      await clickSave()
      expect(wrapper.emitted('confirm')).toHaveLength(1)
    })

    it("doesn't convert a diagram that serialises as it was opened", async () => {
      host.compareWithBaseline.mockResolvedValue({ isChanged: false, document: SOURCE.document })
      await saveEdited()

      expect(convertCelldl).not.toHaveBeenCalled()
      const [save] = wrapper.emitted('confirm')[0]
      expect(save).toMatchObject({ math: null, isSourceChanged: false, source: null, units: null })
      expect(host.markSaved).not.toHaveBeenCalled()
    })

    it('stops the save, saying why, when the converter fails to start', async () => {
      convertCelldl.mockRejectedValue(new Error('no wasm'))
      vi.spyOn(console, 'error').mockImplementation(() => {})
      await saveEdited()

      expect(wrapper.emitted('confirm')).toBeUndefined()
    })

    it("doesn't save when the overwrite is declined, as for CellML", async () => {
      choose.mockResolvedValueOnce('reject')
      await saveEdited()

      expect(choose).toHaveBeenCalledWith(expect.objectContaining({ header: 'Overwrite Math?' }))
      expect(wrapper.emitted('confirm')).toBeUndefined()
      expect(host.markSaved).not.toHaveBeenCalled()

      wrapper.unmount()
      setActivePinia(createPinia())
      useLibraryStore().addMath(MATH_REF, XML)
      mountDialog()
      const editor = await open()
      await report(editor, 'init', XML)
      await report(editor, 'edit', EDITED_XML)
      choose.mockResolvedValueOnce('reject')
      await clickSave()

      expect(choose).toHaveBeenCalledWith(expect.objectContaining({ header: 'Overwrite Math?' }))
      expect(wrapper.emitted('confirm')).toBeUndefined()
    })

    it("drops the module's units when the diagram has none", async () => {
      convertCelldl.mockResolvedValue(converted({ unitsModel: null }))
      await saveEdited()

      expect(wrapper.emitted('confirm')[0][0].units).toEqual({ componentFile: 'file', model: null })
    })

    it("doesn't save once the dialog closes while the diagram converts", async () => {
      convertCelldl.mockImplementation(async () => {
        await wrapper.setProps({ modelValue: false })
        return converted()
      })
      await saveEdited()

      expect(wrapper.emitted('confirm')).toBeUndefined()
    })

    it('keeps the dialog open on Apply', async () => {
      await saveEdited('Apply')

      expect(wrapper.emitted('confirm')[0][0]).toMatchObject({ keepOpen: true, isSourceChanged: true })
      expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    })
  })

  it('opens on the CellML Text editor when the editor last chosen isn\'t offered', async () => {
    window.localStorage.setItem('instanceEditorDialog.editorKind', 'celldl')
    mountDialog()
    await open()
    expect(wrapper.vm.editorKind).toBe('text')
  })

  it('remembers a math editor chosen from a CellDL module, but not the diagram', async () => {
    useLibraryStore().setMathSource(MATH_REF, SOURCE)
    mountDialog()
    await openAsText()
    expect(window.localStorage.getItem('instanceEditorDialog.editorKind')).toBe('text')

    await wrapper.vm.switchEditor('celldl')
    expect(wrapper.vm.editorKind).toBe('celldl')
    expect(window.localStorage.getItem('instanceEditorDialog.editorKind')).toBe('text')
  })

  it("saves CellML math as before: an overwrite asks and, ticked by default, reaches every instance, a rename stays in its math's grouping", async () => {
    mountDialog()
    const editor = await open()
    await report(editor, 'init', XML)
    await report(editor, 'edit', EDITED_XML)
    await wrapper.findAll('button').find((button) => button.text() === 'Save').trigger('click')
    await flushPromises()

    expect(choose).toHaveBeenCalledWith(expect.objectContaining({ header: 'Overwrite Math?' }))
    expect(convertCelldl).not.toHaveBeenCalled()
    expect(wrapper.emitted('confirm')[0][0]).toMatchObject({ mathRef: MATH_REF, updateAll: true, siblings: ['b'], source: null })

    choose.mockClear()
    await report(editor, 'edit', EDITED_XML.replaceAll('decay', 'growth'))
    await wrapper.find('#applyToAll').setValue(true)
    await wrapper.findAll('button').find((button) => button.text() === 'Save').trigger('click')
    await flushPromises()

    expect(choose).not.toHaveBeenCalled()
    expect(wrapper.emitted('confirm')[1][0]).toMatchObject({
      mathRef: 'file:growth',
      updateAll: true,
      siblings: ['b'],
      units: null,
    })
  })

  it('renames past a component of the name in another grouping, which it leaves alone', async () => {
    useLibraryStore().addMath('User_Modules.cellml:growth', XML.replaceAll('decay', 'growth'))
    mountDialog()
    const editor = await open()
    await report(editor, 'init', XML)
    await report(editor, 'edit', EDITED_XML.replaceAll('decay', 'growth'))
    await wrapper.findAll('button').find((button) => button.text() === 'Save').trigger('click')
    await flushPromises()

    expect(choose).not.toHaveBeenCalled()
    expect(wrapper.emitted('confirm')[0][0]).toMatchObject({ mathRef: 'file:growth', previousMathRef: MATH_REF })
  })

  it("asks for another name when a rename matches a component of its grouping's in another case", async () => {
    useLibraryStore().addMath('file:Growth', XML.replaceAll('decay', 'Growth'))
    mountDialog()
    const editor = await open()
    await report(editor, 'init', XML)
    await report(editor, 'edit', EDITED_XML.replaceAll('decay', 'growth'))
    await wrapper.findAll('button').find((button) => button.text() === 'Save').trigger('click')
    await vi.waitFor(() => expect(wrapper.findComponent(ComponentSaveAsDialog).exists()).toBe(true))

    expect(choose).not.toHaveBeenCalled()
    expect(wrapper.findComponent(ComponentSaveAsDialog).props('message')).toContain('A component named "growth" already exists.')
    expect(wrapper.findComponent(ComponentSaveAsDialog).props('file')).toBe('file')
  })

  it("asks for another name, never overwriting, when a rename matches a diagram's module in its grouping", async () => {
    useLibraryStore().addMath('file:growth', XML.replaceAll('decay', 'growth'))
    useLibraryStore().setMathSource('file:growth', { format: 'celldl', document: '<svg/>', documentUri: 'local:growth.celldl' })
    mountDialog()
    const editor = await open()
    await report(editor, 'init', XML)
    await report(editor, 'edit', EDITED_XML.replaceAll('decay', 'growth'))
    await wrapper.findAll('button').find((button) => button.text() === 'Save').trigger('click')
    await vi.waitFor(() => expect(wrapper.findComponent(ComponentSaveAsDialog).exists()).toBe(true))

    expect(choose).not.toHaveBeenCalled()
    expect(wrapper.findComponent(ComponentSaveAsDialog).props('message')).toContain('A component named "growth" already exists.')
  })

  it("asks before a rename onto another component of its grouping's, counting that component's instances and the siblings moving to it", async () => {
    useLibraryStore().addMath('file:growth', XML.replaceAll('decay', 'growth'))
    flowNodes.value = [...flowNodes.value, { id: 'c', data: { name: 'c', mathRef: 'file:growth' } }]
    mountDialog()
    const editor = await open()
    await report(editor, 'init', XML)
    await report(editor, 'edit', EDITED_XML.replaceAll('decay', 'growth'))
    await wrapper.findAll('button').find((button) => button.text() === 'Save').trigger('click')
    await flushPromises()

    expect(choose.mock.calls[0][0].message).toBe(
      '"growth" already exists. This will affect 2 other instances. Overwrite it, or save your changes as a new component?'
    )
    expect(wrapper.emitted('confirm')[0][0]).toMatchObject({ mathRef: 'file:growth', previousMathRef: MATH_REF })
  })

  describe('saving CellML math as a new component', () => {
    /**
     * Edits the math and saves it as a new component, and waits for Save As to ask its name: ticked, chosen instead of
     * overwriting; unticked, asked straight away, as the other instance uses the math.
     */
    async function startSaveAs({ isAppliedToAll = false } = {}) {
      if (isAppliedToAll) choose.mockResolvedValueOnce('extra')
      mountDialog()
      const editor = await open()
      await report(editor, 'init', XML)
      await report(editor, 'edit', EDITED_XML)
      await wrapper.find('#applyToAll').setValue(isAppliedToAll)
      await wrapper.findAll('button').find((button) => button.text() === 'Save').trigger('click')
      await vi.waitFor(() => expect(wrapper.findComponent(ComponentSaveAsDialog).exists()).toBe(true))
      return wrapper.findComponent(ComponentSaveAsDialog)
    }

    /** Answers Save As and waits for the save to finish. */
    async function answer(saveAs, name) {
      saveAs.vm.$emit(name ? 'confirm' : 'cancel', name)
      await vi.waitFor(() => expect(wrapper.vm.isSaving).toBe(false))
      await flushPromises()
    }

    it('refuses a used or template name, then saves the renamed math as a new module for this instance', async () => {
      const library = useLibraryStore()
      const stored = library.availableMath.get(MATH_REF)
      library.addMath('file:growth', XML.replaceAll('decay', 'growth'))
      // Names need only differ within a grouping.
      library.addMath('User_Modules.cellml:quick', XML.replaceAll('decay', 'quick'))
      const saveAs = await startSaveAs()

      expect(choose).not.toHaveBeenCalled()
      expect(saveAs.props('message')).toContain('1 other instance uses decay')
      const isTaken = saveAs.props('isTaken')
      expect(isTaken('decay')).toBe('"decay" is used by the other instances.')
      expect(isTaken('growth')).toBe('A component named "growth" already exists.')
      expect(isTaken('new_module')).toBe('"new_module" is a template and can\'t be overwritten.')
      expect(isTaken('Growth')).toBe('A component named "Growth" already exists.')
      expect(isTaken('New_Module')).toBe('"New_Module" is a template and can\'t be overwritten.')
      expect(isTaken('quick')).toBe('')
      expect(isTaken('fresh')).toBe('')
      expect(saveAs.props('file')).toBe('file')
      await answer(saveAs, 'fresh')

      const [save] = wrapper.emitted('confirm')[0]
      expect(save).toMatchObject({ mathRef: 'file:fresh', previousMathRef: MATH_REF, updateAll: false, siblings: [], source: null })
      expect(save.math).toContain('<component name="fresh">')
      expect(save.math).toContain('<cn>1</cn>')
      expect(library.availableMath.get(MATH_REF)).toBe(stored)
    })

    it('moves the other instances to it too when ticked', async () => {
      await answer(await startSaveAs({ isAppliedToAll: true }), 'fresh')

      expect(choose).toHaveBeenCalledWith(
        expect.objectContaining({ header: 'Overwrite Math?', acceptLabel: 'Overwrite', extraLabel: 'Save as new component' })
      )
      expect(wrapper.emitted('confirm')[0][0]).toMatchObject({ mathRef: 'file:fresh', updateAll: true, siblings: ['b'] })
    })

    it('saves nothing when Save As is cancelled', async () => {
      await answer(await startSaveAs(), null)

      expect(wrapper.emitted('confirm')).toBeUndefined()
    })

    it("saves math renamed to a template's name as a new component, never asking to overwrite", async () => {
      mountDialog()
      const editor = await open()
      await report(editor, 'init', XML)
      await report(editor, 'edit', EDITED_XML.replaceAll('decay', 'new_module'))
      await wrapper.findAll('button').find((button) => button.text() === 'Save').trigger('click')
      await vi.waitFor(() => expect(wrapper.findComponent(ComponentSaveAsDialog).exists()).toBe(true))

      expect(choose).not.toHaveBeenCalled()
      await answer(wrapper.findComponent(ComponentSaveAsDialog), 'fresh')
      const [save] = wrapper.emitted('confirm')[0]
      expect(save.mathRef).toBe('file:fresh')
      expect(save.math).toContain('<component name="fresh">')
    })
  })

  it('leaves CellML math editable, with the choice to apply to every instance', async () => {
    mountDialog()
    const editor = await open()
    await report(editor, 'init', XML)

    expect(stubProps(FakeEditor).readonly).toBe(false)
    expect(stubProps(ParameterTableStub)['values-only']).toBe(false)
    expect(wrapper.find('.header-group--secondary input').exists()).toBe(true)
    expect(wrapper.find('.apply-all-note').exists()).toBe(false)
    expect(wrapper.find('.apply-all-checkbox').exists()).toBe(true)
  })
})

describe('InstanceEditorDialog parameter set', () => {
  // The math as the library holds it, its values in the rows; a value typed in the text would win over the rows'.
  const BARE_XML = XML.replace(' initial_value="0.5"', '').replace(' initial_value="1"', '')
  const param = (value) => ({ value, units: '', data_reference: 'paper', extra: {} })
  const paramSet = (ref, values) => ({ ref, source: { file: `${ref}_parameters.json`, importedAt: '' }, globals: new Map(), values: new Map(values) })
  const rows = () => [
    { name: 'k', value: '0.5', units: 'per_second', type: 'constant' },
    { name: 'x0', value: '1', units: 'metre', type: 'constant' },
  ]
  const tableRows = () => wrapper.findComponent(ParameterTableStub).vm.$attrs.rows
  const valueOf = (name) => tableRows().find((row) => row.name === name).value
  const setSelect = () => wrapper.findAllComponents({ name: 'Select' }).find((select) => select.props('ariaLabel') === 'Parameter set')

  beforeAll(async () => {
    await ensureLibCellmlReady()
  })

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useLibraryStore().addMath(MATH_REF, BARE_XML)
    const parameters = useDefaultParametersStore()
    parameters.addSet(paramSet('slow', [['k', param('0.5')]]), { mathRef: MATH_REF })
    parameters.addSet(paramSet('fast', [['k', param('2')], ['x0', param('1')]]), { mathRef: MATH_REF })
    flowNodes.value = [{ id: 'a', data: { name: 'a', mathRef: MATH_REF, parameterisation: 'slow', variables: rows() } }]
  })

  afterEach(() => {
    flowNodes.value = []
  })

  /** Opens the dialog on the instance seeded with `slow`. */
  async function openSeeded() {
    mountDialog({ variables: rows() })
    const editor = await open()
    await report(editor, 'init', BARE_XML)
    return editor
  }

  async function pick(ref) {
    setSelect().vm.$emit('update:modelValue', ref)
    await flushPromises()
  }

  it("lists the math's sets, showing the instance's own", async () => {
    await openSeeded()

    expect(setSelect().props('options').map((option) => option.value)).toEqual(['slow', 'fast'])
    expect(setSelect().props('modelValue')).toBe('slow')
  })

  it('lists the values a set changes, then applies it and saves it with the instance', async () => {
    await openSeeded()

    await pick('fast')

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ issues: [{ key: 'k', message: 'k: 0.5 → 2' }], acceptLabel: 'Apply' })
    )
    expect(valueOf('k')).toBe('2')
    expect(setSelect().props('modelValue')).toBe('fast')

    await wrapper.findAll('button').find((button) => button.text() === 'Save').trigger('click')
    await flushPromises()
    const [save] = wrapper.emitted('confirm')[0]
    expect(save.parameterisation).toBe('fast')
    expect(save.variables.find((row) => row.name === 'k')).toMatchObject({ value: '2', data_reference: 'paper' })
  })

  it('leaves the values as they are when cancelled', async () => {
    await openSeeded()
    confirm.mockResolvedValueOnce(false)

    await pick('fast')

    expect(valueOf('k')).toBe('0.5')
    expect(setSelect().props('modelValue')).toBe('slow')
  })

  it('shows the instance\'s set again once a pick is cancelled', async () => {
    await openSeeded()
    confirm.mockResolvedValueOnce(false)

    // As a click on an option does, the picker shows the option before the dialog hears of it.
    setSelect().vm.updateModel(null, 'fast')
    expect(setSelect().vm.d_value).toBe('fast')
    await flushPromises()

    expect(setSelect().vm.d_value).toBe('slow')
  })

  it('undoes the whole apply in one step', async () => {
    const editor = await openSeeded()
    await pick('fast')

    editor.vm.$emit('undo')
    await flushPromises()

    expect(valueOf('k')).toBe('0.5')
    expect(setSelect().props('modelValue')).toBe('slow')

    editor.vm.$emit('redo')
    await flushPromises()
    expect(valueOf('k')).toBe('2')
  })

  describe('saving changed values on a shared set', () => {
    const editK = (value) => (wrapper.vm.parameterRows.find((row) => row.name === 'k').value = value)
    const setPrompt = () => wrapper.findComponent(ParameterSetSaveDialog)
    async function save() {
      await wrapper.findAll('button').find((button) => button.text() === 'Save').trigger('click')
      await flushPromises()
    }

    beforeEach(() => {
      flowNodes.value.push({ id: 'b', data: { name: 'b', mathRef: MATH_REF, parameterisation: 'slow', variables: rows() } })
    })

    it("asks, listing the other instances' changes, and saves the choice", async () => {
      await openSeeded()
      editK('3')
      await save()

      expect(wrapper.emitted('confirm')).toBeUndefined()
      expect(setPrompt().props()).toMatchObject({
        paramRef: 'slow',
        ownerName: '',
        newRef: 'a',
        otherCount: 1,
        changes: [{ nodeId: 'b', nodeName: 'b', name: 'k', from: '0.5', to: '3' }],
      })

      setPrompt().vm.$emit('confirm', { action: 'update' })
      await flushPromises()
      const [saved] = wrapper.emitted('confirm')[0]
      expect(saved.parameterSet).toEqual({ action: 'update' })
      expect(saved.parameterisation).toBe('slow')
    })

    it('saves nothing when cancelled', async () => {
      await openSeeded()
      editK('3')
      await save()

      setPrompt().vm.$emit('cancel')
      await flushPromises()
      expect(wrapper.emitted('confirm')).toBeUndefined()
      expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    })

    it("names the instance that made a set it shares", async () => {
      const parameters = useDefaultParametersStore()
      parameters.addInstanceSet(MATH_REF, 'b', 'b', rows())
      flowNodes.value[0].data.parameterisation = 'b'
      await openSeeded()
      editK('3')
      await save()

      expect(setPrompt().props()).toMatchObject({ paramRef: 'b', ownerName: 'b', otherCount: 0, changes: [] })
    })

    it("asks about the instance's own set once another instance uses it", async () => {
      useDefaultParametersStore().addInstanceSet(MATH_REF, 'a', 'mine', rows())
      flowNodes.value[0].data.parameterisation = 'mine'
      flowNodes.value[1].data.parameterisation = 'mine'
      await openSeeded()
      editK('3')
      await save()

      expect(wrapper.emitted('confirm')).toBeUndefined()
      expect(setPrompt().props()).toMatchObject({
        paramRef: 'mine',
        isOwn: true,
        ownerName: '',
        newRef: 'a',
        otherCount: 1,
        changes: [{ nodeId: 'b', nodeName: 'b', name: 'k', from: '0.5', to: '3' }],
      })
      setPrompt().vm.$emit('confirm', { action: 'new' })
      await flushPromises()
      expect(wrapper.emitted('confirm')[0][0].parameterSet).toEqual({ action: 'new' })
    })

    it("never asks for the instance's own set, nor for edits that change no value", async () => {
      useDefaultParametersStore().addInstanceSet(MATH_REF, 'a', 'mine', rows())
      flowNodes.value[0].data.parameterisation = 'mine'
      await openSeeded()
      editK('3')
      await save()
      expect(setPrompt().exists()).toBe(false)
      expect(wrapper.emitted('confirm')[0][0].parameterSet).toBeNull()

      flowNodes.value[0].data.parameterisation = 'slow'
      wrapper.unmount()
      await openSeeded()
      await save()
      expect(setPrompt().exists()).toBe(false)
      expect(wrapper.emitted('confirm')[0][0].parameterSet).toBeNull()
    })
  })

  it('hides the picker for a math with no sets', async () => {
    useDefaultParametersStore().resetState()
    await openSeeded()

    expect(setSelect()).toBeUndefined()
  })
})

describe('InstanceEditorDialog Annotations tab', () => {
  const SIDECAR = `@prefix bqbiol: <http://biomodels.net/biology-qualifiers/> .
@prefix semsim: <http://bime.uw.edu/semsim/> .
@prefix opb: <https://identifiers.org/opb/OPB_> .
@prefix chebi: <https://identifiers.org/chebi/CHEBI:> .
@prefix go: <https://identifiers.org/go/GO:> .
@prefix sbo: <https://identifiers.org/sbo/SBO:> .
@prefix m: <./file#> .
@prefix local: <./decay.ttl#> .
m:decay bqbiol:is sbo:0000290 .
local:entity_self bqbiol:is sbo:0000290 .
m:vdecayx01 bqbiol:isVersionOf opb:00340 ; bqbiol:isPropertyOf [ bqbiol:is chebi:29101 ; bqbiol:isPartOf go:0005737 ] .
`
  const K_ENTRY = { property: 'OPB:00592', species: ['CHEBI:29103'], location: 'self' }

  beforeAll(async () => {
    await ensureLibCellmlReady()
  })

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    const library = useLibraryStore()
    library.addMath(MATH_REF, X_IDS_XML)
    library.setModuleAnnotations(MATH_REF, SIDECAR)
  })

  afterEach(() => {
    confirm.mockImplementation(async () => true)
    flowNodes.value = []
    flowEdges.value = []
  })

  /**
   * Opens the dialog on the Annotations tab, once its sidecar ports are in place.
   *
   * @param {Object} [props]
   * @returns {Promise<import('@vue/test-utils').VueWrapper>} The tab.
   */
  async function openTab(props = {}) {
    mountDialog({ defaultTab: 'annotations', ...props })
    const editor = await open()
    // As the editor gives back the stored math: without its ids.
    await report(editor, 'init', stripIds(useLibraryStore().availableMath.get(MATH_REF)))
    await flushPromises()
    return wrapper.findComponent(AnnotationTab)
  }

  /**
   * Edits the draft as the tab would.
   *
   * @param {import('@vue/test-utils').VueWrapper} tab
   * @param {(draft: Object, sidecar: Object) => Object} edit
   */
  async function editDraft(tab, edit) {
    tab.vm.$emit('update:draft', edit(tab.props('draft'), tab.props('sidecar')))
    await flushPromises()
  }

  const clickButton = async (label) => {
    await wrapper.findAll('button').find((button) => button.text() === label).trigger('click')
    await flushPromises()
  }

  it('holds the summed flows at 0 from the tab, saving the rows and the reservoir state together', async () => {
    useLibraryStore().setModuleAnnotations(
      MATH_REF,
      SIDECAR.replace(
        'm:vdecayx01 bqbiol:isVersionOf opb:00340 ; bqbiol:isPropertyOf [ bqbiol:is chebi:29101 ; bqbiol:isPartOf go:0005737 ] .',
        'm:vdecayx01 bqbiol:isVersionOf opb:00592 ; bqbiol:isPropertyOf local:Na_self .\n' +
          'local:Na_self bqbiol:is chebi:29101 ; bqbiol:isPartOf local:entity_self .'
      )
    )
    const tab = await openTab()
    expect(tab.props('heldConstant')).toBe(false)
    tab.vm.$emit('update:heldConstant', true)
    await flushPromises()
    expect(tab.props('heldConstant')).toBe(true)
    expect(wrapper.vm.parameterRows.find((row) => row.name === 'x')).toMatchObject({ type: 'constant', value: '0' })

    await clickButton('Save')
    const [held] = wrapper.emitted('confirm')[0]
    expect(held.annotationOverlay).toEqual({ heldConstant: true })
    expect(held.variables.find((row) => row.name === 'x')).toMatchObject({ type: 'constant', value: '0' })

    tab.vm.$emit('update:heldConstant', false)
    await flushPromises()
    expect(wrapper.vm.parameterRows.find((row) => row.name === 'x').type).toBe('boundary_condition')
  })

  it('counts annotated of annotatable variables on its tab, leaving out the VoI and constants', async () => {
    await openTab()
    expect(wrapper.text()).toContain('Annotations (1/1)')
  })

  it('saves an edit as the sidecar text, and shows its new port in the Ports tab before saving', async () => {
    const tab = await openTab()
    await editDraft(tab, (draft, sidecar) => setDraftEntry(draft, sidecar, 'k', K_ENTRY))

    const kPort = wrapper.vm.editablePorts.find((port) => port.annotation?.variable === 'k')
    expect(kPort).toMatchObject({ variables: ['k'], multiportType: 'Sum', annotation: { role: 'aggregator', species: ['CHEBI:29103'] } })
    expect(wrapper.vm.hasUnsavedEdits).toBe(true)

    await clickButton('Save')
    const [save] = wrapper.emitted('confirm')[0]
    expect(save).toMatchObject({ mathRef: MATH_REF, idsChanged: true })
    // Annotating k gave it an id, which the math carries and the sidecar subject names; the rest is as stored.
    const ids = variableIdsOf(save.math)
    expect(ids.get('k')).toMatch(/^b4da[0-9a-f]+$/)
    expect(ids.get('x')).toBe('vdecayx01')
    expect(stripIds(save.math)).toBe(stripIds(useLibraryStore().availableMath.get(MATH_REF)))
    expect(save.annotations.text).toContain(`m:${ids.get('k')} bqbiol:isVersionOf opb:00592`)
    expect(save.annotations.text).toContain('chebi:29103')
    expect(save.annotations.text).toMatch(/m:vdecayx01 bqbiol:isVersionOf opb:00340/)
    expect(save.ports.some((port) => port.annotation?.variable === 'k')).toBe(true)
  })

  it('says a port added since opening will be created, even after its annotation changes', async () => {
    const tab = await openTab()
    await editDraft(tab, (draft, sidecar) => setDraftEntry(draft, sidecar, 'k', K_ENTRY))
    await editDraft(tab, (draft, sidecar) => setDraftEntry(draft, sidecar, 'k', { ...K_ENTRY, location: 'GO:0005737' }))
    expect(wrapper.vm.editablePorts.find((port) => port.annotation?.variable === 'k').annotation.location).toBe('GO:0005737')
    expect(tab.props('portStatus').has('k')).toBe(false)
  })

  it('saves an imported sidecar in place of the stored one, with edits made after it', async () => {
    const tab = await openTab()
    const imported = SIDECAR.replace('opb:00340', 'opb:00425')
    await tab.vm.importFile(new File([imported], 'decay.ttl'))
    await flushPromises()
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ header: 'Import annotations' }))
    expect(wrapper.vm.hasUnsavedEdits).toBe(true)
    await editDraft(tab, (draft) => setDraftSpaceKind(draft, tab.props('draft').imported.sidecar, 'GO:0005737'))

    await clickButton('Save')
    const [save] = wrapper.emitted('confirm')[0]
    const saved = await parseSidecar(save.annotations.text, { mathRef: MATH_REF, cellml: save.math ?? X_IDS_XML })
    expect(saved.variables.find((entry) => entry.variable === 'x').property).toBe('OPB:00425')
    expect(saved.component.spaceKind).toBe('GO:0005737')
  })

  it('saves a compartment’s space kind on local:entity_self, and reads it back', async () => {
    const tab = await openTab()
    await editDraft(tab, (draft, sidecar) => setDraftSpaceKind(draft, sidecar, 'GO:0005737'))
    expect(wrapper.vm.hasUnsavedEdits).toBe(true)
    await clickButton('Save')
    const [save] = wrapper.emitted('confirm')[0]
    expect(save.annotations.text).toContain(
      'local:entity_self bqbiol:is sbo:0000290 ;\n    bqbiol:isVersionOf go:0005737 .'
    )
    const saved = await parseSidecar(save.annotations.text, { mathRef: MATH_REF, cellml: save.math ?? X_IDS_XML })
    expect(saved.component.spaceKind).toBe('GO:0005737')
  })

  it('annotates a variable renamed after its annotation was drafted under its new name', async () => {
    mountDialog({ defaultTab: 'annotations' })
    const editor = await open()
    const bare = stripIds(useLibraryStore().availableMath.get(MATH_REF))
    await report(editor, 'init', bare)
    await flushPromises()
    const tab = wrapper.findComponent(AnnotationTab)
    await editDraft(tab, (draft, sidecar) => setDraftEntry(draft, sidecar, 'k', K_ENTRY))
    await report(editor, 'edit', bare.replaceAll('name="k"', 'name="rate"').replaceAll('<ci>k</ci>', '<ci>rate</ci>'))

    await clickButton('Save')
    const [save] = wrapper.emitted('confirm')[0]
    const id = variableIdsOf(save.math).get('rate')
    expect(id).toMatch(/^b4da[0-9a-f]+$/)
    expect(save.annotations.text).toContain(`m:${id} bqbiol:isVersionOf opb:00592`)
  })

  it('writes no math when every annotated variable already has an id', async () => {
    const tab = await openTab()
    await editDraft(tab, (draft, sidecar) => setDraftEntry(draft, sidecar, 'x', { ...K_ENTRY, property: 'OPB:00340' }))

    await clickButton('Save')
    const [save] = wrapper.emitted('confirm')[0]
    expect(save).toMatchObject({ math: null, idsChanged: false })
    expect(save.annotations.text).toMatch(/m:vdecayx01 bqbiol:isVersionOf opb:00340/)
  })

  it('sends no annotations when the draft is unchanged, or an edit was put back', async () => {
    const tab = await openTab()
    await editDraft(tab, (draft, sidecar) => setDraftEntry(draft, sidecar, 'k', K_ENTRY))
    await editDraft(tab, (draft, sidecar) => setDraftEntry(draft, sidecar, 'k', null))
    expect(wrapper.vm.hasUnsavedEdits).toBe(false)

    await clickButton('Save')
    expect(wrapper.emitted('confirm')[0][0]).not.toHaveProperty('annotations')
  })

  it('warns of what else a process held when its flow becomes a level', async () => {
    const flow = SIDECAR.replace(
      /m:vdecayx01 [^\n]*\n/,
      `m:vdecayx01 bqbiol:isVersionOf opb:00592 ; bqbiol:isPropertyOf local:process_vdecayx01 .
local:process_vdecayx01 semsim:hasSinkParticipant local:sink_vdecayx01 ; bqbiol:isVersionOf go:0006096 .
local:sink_vdecayx01 semsim:hasPhysicalEntityReference local:entity_self .
`
    )
    useLibraryStore().setModuleAnnotations(MATH_REF, flow)
    const warning = vi.spyOn(notify, 'warning').mockImplementation(() => {})
    const tab = await openTab()
    const level = { property: 'OPB:00340', species: ['CHEBI:29101'], location: 'self' }
    await editDraft(tab, (draft, sidecar) => setDraftEntry(draft, sidecar, 'x', level))

    await clickButton('Save')
    expect(wrapper.emitted('confirm')[0][0].annotations.text).not.toContain('0006096')
    expect(warning).toHaveBeenCalledWith({
      title: 'Annotations',
      message: "'x' no longer has its process, so its bqbiol:isVersionOf GO:0006096 was dropped.".replaceAll("'", '&#39;'),
    })
    warning.mockRestore()
  })

  it('saves the module kind', async () => {
    const tab = await openTab()
    await editDraft(tab, (draft, sidecar) => setDraftKind(draft, sidecar, 'transporter', 'uniprot:P11168'))

    await clickButton('Save')
    const { text } = wrapper.emitted('confirm')[0][0].annotations
    expect(text).toContain('P11168')
    expect(text).not.toContain('sbo:0000290')
  })

  it('does not save a transporter without a UniProt accession', async () => {
    const tab = await openTab()
    await editDraft(tab, (draft, sidecar) => setDraftKind(draft, sidecar, 'transporter'))

    await clickButton('Save')
    expect(wrapper.emitted('confirm')).toBeUndefined()
  })

  it('asks before clearing an annotation whose port is connected', async () => {
    const xPort = {
      portType: 'general_ports',
      label: '',
      variables: ['x'],
      multiportType: 'None',
      annotation: {
        subject: X_SUBJECT,
        variable: 'x',
        property: 'OPB:00340',
        species: ['CHEBI:29101'],
        location: 'GO:0005737',
        role: 'reader',
        source: { kind: 'sidecar', mathRef: MATH_REF },
      },
    }
    const partner = { ...xPort, annotation: { ...xPort.annotation, subject: 'other#x', role: 'owner' } }
    flowNodes.value = [
      { id: 'a', data: { name: 'a', mathRef: MATH_REF, ports: [xPort] } },
      { id: 'b', data: { name: 'b', mathRef: 'file:other', ports: [] } },
    ]
    flowEdges.value = [{ id: 'e', source: 'a', target: 'b', data: { couplings: [{ sourcePort: xPort, targetPort: partner }] } }]
    const tab = await openTab({ initialPorts: [xPort] })
    expect(tab.props('portStatus').get('x')).toBe('connected')
    confirm.mockImplementation(async ({ header }) => header !== 'Remove Couplings?')

    await editDraft(tab, (draft, sidecar) => setDraftEntry(draft, sidecar, 'x', null))
    await clickButton('Save')

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: 'Removes 1 coupling on 1 connection.' }))
    expect(wrapper.emitted('confirm')).toBeUndefined()
  })

  it('asks before Cancel discards annotation edits', async () => {
    const tab = await openTab()
    await editDraft(tab, (draft, sidecar) => setDraftEntry(draft, sidecar, 'k', K_ENTRY))
    confirm.mockImplementation(async () => false)

    await clickButton('Cancel')
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ header: 'Unsaved Changes' }))
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('says how many instances share the annotations', async () => {
    flowNodes.value = [
      { id: 'a', data: { name: 'a', mathRef: MATH_REF } },
      { id: 'b', data: { name: 'b', mathRef: MATH_REF } },
    ]
    await openTab()
    expect(wrapper.find('[data-test="shared"]').text()).toBe('Shared by 2 instances · edits apply to its module')
  })

  it('saves annotations of template math as a new component', async () => {
    const templateXml = XML.replace(/"decay"/g, '"new_module"')
    useLibraryStore().addMath(NEW_MODULE_MATH_REF, templateXml)
    mountDialog({ defaultTab: 'annotations', mathRef: NEW_MODULE_MATH_REF, initialName: 'my_instance' })
    const editor = await open()
    await report(editor, 'init', templateXml)
    const tab = wrapper.findComponent(AnnotationTab)
    await editDraft(tab, (draft, sidecar) => setDraftEntry(draft, sidecar, 'k', K_ENTRY))

    await clickButton('Save')
    const saveAs = wrapper.findComponent(ComponentSaveAsDialog)
    expect(saveAs.exists()).toBe(true)
    saveAs.vm.$emit('confirm', 'my_comp')
    await flushPromises()

    const [save] = wrapper.emitted('confirm')[0]
    expect(save.mathRef).toBe('User_Modules.cellml:my_comp')
    expect(save.math).toContain('<component name="my_comp"')
    const kId = variableIdsOf(save.math).get('k')
    expect(save.annotations.text).toContain(`m:${kId} bqbiol:isVersionOf opb:00592`)
    expect(save.annotations.text).not.toContain('new_module')
  })
})

describe('InstanceEditorDialog variable ids', () => {
  const XML_WITH_IDS = XML.replace('<component name="decay"', '<component name="decay" id="vcomp0000"')
    .replace('<variable name="x"', '<variable name="x" id="vx0000000"')
    .replace('<variable name="k"', '<variable name="k" id="vk0000000"')
  const IDS = new Map([
    ['x', 'vx0000000'],
    ['k', 'vk0000000'],
  ])
  const RENAMED_IDS = new Map([
    ['y', 'vx0000000'],
    ['k', 'vk0000000'],
  ])
  const renameX = (xml) => xml.replaceAll('name="x"', 'name="y"').replaceAll('<ci>x</ci>', '<ci>y</ci>')
  // The stored math as the editor gives it back: without ids.
  let bare

  beforeAll(async () => {
    await ensureLibCellmlReady()
  })

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useLibraryStore().addMath(MATH_REF, XML_WITH_IDS)
    bare = stripIds(useLibraryStore().availableMath.get(MATH_REF))
  })

  afterEach(() => window.localStorage.removeItem('instanceEditorDialog.simpleMode'))

  /**
   * Opens the dialog, applies `edits` and saves.
   *
   * @param {Array<[string, string]>} edits - `[source, xml]` reports after the editor's `init`.
   * @param {Function} [between] - Given the editor; runs after the edits, before Save.
   * @returns {Promise<Object>} The save.
   */
  async function saveAfter(edits, between = async () => {}) {
    mountDialog()
    const editor = await open()
    await report(editor, 'init', bare)
    for (const [source, xml] of edits) await report(editor, source, xml)
    await between(editor)
    await wrapper.findAll('button').find((button) => button.text() === 'Save').trigger('click')
    await flushPromises()
    return wrapper.emitted('confirm')[0][0]
  }

  it('keeps the variable and component ids through an edit', async () => {
    const save = await saveAfter([['edit', bare.replace('<apply><minus/><ci>k</ci></apply>', '<cn>2</cn>')]])
    expect(save.math).toContain('<cn>2</cn>')
    expect(variableIdsOf(save.math)).toEqual(IDS)
    expect(save.math).toContain('id="vcomp0000"')
    expect(save.idsChanged).toBe(false)
  })

  it('moves a renamed variable’s id to its new name, whether the editor or the table renamed it', async () => {
    for (const source of ['edit', 'external']) {
      const save = await saveAfter([[source, renameX(bare)]])
      expect(variableIdsOf(save.math)).toEqual(RENAMED_IDS)
      wrapper.unmount()
    }
  })

  it('moves a renamed variable’s id in Advanced Mode', async () => {
    window.localStorage.setItem('instanceEditorDialog.simpleMode', 'false')
    const save = await saveAfter([['edit', renameX(bare)]])
    expect(wrapper.vm.isManaged).toBe(false)
    expect(variableIdsOf(save.math)).toEqual(RENAMED_IDS)
  })

  it('keeps the ids through undo and redo', async () => {
    const undoRedo = async (editor) => {
      editor.vm.$emit('undo')
      await flushPromises()
      editor.vm.$emit('redo')
      await flushPromises()
    }
    expect(variableIdsOf((await saveAfter([['edit', renameX(bare)]], undoRedo)).math)).toEqual(RENAMED_IDS)
  })

  it('counts math that differs only by ids as unchanged, so it saves no math and asks nothing', async () => {
    const save = await saveAfter([['edit', useLibraryStore().availableMath.get(MATH_REF)]])
    expect(confirm).not.toHaveBeenCalled()
    expect(save).toMatchObject({ mathRef: MATH_REF, math: null, idsChanged: false })
    expect(useLibraryStore().availableMath.get(MATH_REF)).toContain('vx0000000')
  })
})

describe('InstanceEditorDialog annotated ports', () => {
  const SIDECAR = `@prefix bqbiol: <http://biomodels.net/biology-qualifiers/> .
@prefix semsim: <http://bime.uw.edu/semsim/> .
@prefix opb: <https://identifiers.org/opb/OPB_> .
@prefix chebi: <https://identifiers.org/chebi/CHEBI:> .
@prefix go: <https://identifiers.org/go/GO:> .
@prefix sbo: <https://identifiers.org/sbo/SBO:> .
@prefix m: <./file#> .
@prefix local: <./decay.ttl#> .
m:decay bqbiol:is sbo:0000290 .
local:entity_self bqbiol:is sbo:0000290 .
m:vdecayx01 bqbiol:isVersionOf opb:00340 ; bqbiol:isPropertyOf [ bqbiol:is chebi:29101 ; bqbiol:isPartOf go:0005737 ] .
m:vdecayk01 bqbiol:isVersionOf opb:00592 ; bqbiol:isPropertyOf local:process_vdecayk01 .
local:process_vdecayk01 semsim:hasSinkParticipant local:sink_vdecayk01 .
local:sink_vdecayk01 semsim:hasPhysicalEntityReference local:entity_vdecayk01 .
local:entity_vdecayk01 bqbiol:is chebi:29101 ; bqbiol:isPartOf local:entity_self .
`
  const IDS_XML = withId(X_IDS_XML, 'k', 'vdecayk01')
  const xPort = () => ({
    portType: 'general_ports',
    label: '',
    variables: ['x'],
    multiportType: 'None',
    annotation: {
      subject: X_SUBJECT,
      variable: 'x',
      property: 'OPB:00340',
      species: ['CHEBI:29101'],
      location: 'GO:0005737',
      role: 'reader',
      source: { kind: 'sidecar', mathRef: MATH_REF },
    },
  })
  const copiedPort = () => ({
    portType: 'general_ports',
    label: '',
    variables: [],
    multiportType: 'Sum',
    annotation: {
      subject: 'https://phlynx.invalid/modules/other#other.v',
      variable: '',
      property: 'OPB:00592',
      species: ['CHEBI:29101'],
      location: 'self',
      role: 'aggregator',
      source: { kind: 'copied', mathRef: MATH_REF, copiedFrom: { subject: 'other#other.v', instance: 'Other' } },
    },
  })

  beforeAll(async () => {
    await ensureLibCellmlReady()
  })

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    const library = useLibraryStore()
    library.addMath(MATH_REF, IDS_XML)
    library.setModuleAnnotations(MATH_REF, SIDECAR)
  })

  it('shows an annotated port as read-only chips with its type and mode locked', async () => {
    mountDialog({ defaultTab: 'ports', initialPorts: [xPort()] })
    await open()
    await flushPromises()

    const row = wrapper.find('.ports-tab-body tbody tr')
    expect(row.findComponent(AnnotationChips).exists()).toBe(true)
    expect(row.find('input[placeholder="Enter label"]').exists()).toBe(false)
    expect(row.find('.port-type-cell').attributes('title')).toMatch(/^From annotation/)
    expect(row.find('button[aria-label="Multiport"]').attributes('disabled')).toBeDefined()
    expect(row.findComponent(PortVariableSelect).exists()).toBe(false)
  })

  it('gives each annotated variable a sidecar port, without counting it as an unsaved edit', async () => {
    mountDialog({ defaultTab: 'ports', initialPorts: [xPort()] })
    const editor = await open()
    await report(editor, 'init', XML)
    await flushPromises()

    const ports = wrapper.vm.editablePorts
    expect(ports.map((port) => port.annotation?.variable)).toEqual(['x', 'k'])
    expect(ports[1]).toMatchObject({ variables: ['k'], multiportType: 'Sum', annotation: { role: 'aggregator' } })
    expect(wrapper.vm.hasUnsavedEdits).toBe(false)
    expect(wrapper.find('[data-test="unported-annotation"]').exists()).toBe(false)
  })

  it('drops a sidecar port on a variable the math lacks', async () => {
    useLibraryStore().setModuleAnnotations(
      MATH_REF,
      `${SIDECAR}m:vgone0000 bqbiol:isVersionOf opb:00318 ; bqbiol:isPropertyOf [ bqbiol:is go:0005886 ] .\n`
    )
    const stale = {
      ...xPort(),
      variables: ['I_K'],
      annotation: { ...xPort().annotation, subject: 'https://phlynx.invalid/modules/file#vgone0000', variable: 'I_K' },
    }
    mountDialog({ defaultTab: 'ports', initialPorts: [xPort(), stale] })
    const editor = await open()
    await report(editor, 'init', XML)
    await flushPromises()

    expect(wrapper.vm.editablePorts.map((port) => port.variables[0])).toEqual(['x', 'k'])
  })

  it('keeps manual ports editable beside annotation ports, noting they are hidden on the canvas', async () => {
    const manual = { portType: 'general_ports', label: 'flow', variables: ['x'], multiportType: 'None' }
    mountDialog({ defaultTab: 'ports', initialPorts: [xPort(), manual] })
    await open()
    await flushPromises()

    expect(wrapper.find('[data-test="manual-ports-hidden"]').exists()).toBe(true)
    const rows = wrapper.findAll('.ports-tab-body tbody tr')
    const manualRow = rows.find((row) => row.find('input[placeholder="Enter label"]').exists())
    expect(manualRow.find('input[placeholder="Enter label"]').element.value).toBe('flow')
    expect(manualRow.find('[data-test="hidden-port"]').exists()).toBe(true)
    expect(rows.filter((row) => row.find('[data-test="hidden-port"]').exists())).toHaveLength(1)
  })

  it('notes no hidden ports without annotation ports', async () => {
    const manual = { portType: 'general_ports', label: 'flow', variables: ['x'], multiportType: 'None' }
    useLibraryStore().setModuleAnnotations(MATH_REF, null)
    mountDialog({ defaultTab: 'ports', initialPorts: [manual] })
    await open()
    await flushPromises()
    expect(wrapper.find('[data-test="manual-ports-hidden"]').exists()).toBe(false)
  })

  it('keeps an annotated variable its port when the math renames it', async () => {
    mountDialog({ defaultTab: 'ports', initialPorts: [xPort()] })
    const editor = await open()
    await report(editor, 'init', XML)
    await flushPromises()
    await report(editor, 'edit', XML.replaceAll('name="x"', 'name="y"').replaceAll('<ci>x</ci>', '<ci>y</ci>'))
    await flushPromises()

    const [port] = wrapper.vm.editablePorts
    expect(port).toMatchObject({ variables: ['y'], annotation: { subject: xPort().annotation.subject } })
  })

  it('saves a renamed annotated variable under its id, so its subject and sidecar stay as they are', async () => {
    mountDialog({ defaultTab: 'ports', initialPorts: [xPort()] })
    const editor = await open()
    await report(editor, 'init', XML)
    await flushPromises()
    await report(editor, 'edit', XML.replaceAll('name="x"', 'name="y"').replaceAll('<ci>x</ci>', '<ci>y</ci>'))
    await flushPromises()

    await wrapper.findAll('button').find((button) => button.text() === 'Save').trigger('click')
    await flushPromises()
    const [save] = wrapper.emitted('confirm')[0]
    expect(save).toMatchObject({ mathRef: MATH_REF, idsChanged: false })
    expect(save).not.toHaveProperty('annotations')
    expect(variableIdsOf(save.math).get('y')).toBe('vdecayx01')
    const yPort = save.ports.find((port) => port.annotation?.subject === X_SUBJECT)
    expect(yPort).toMatchObject({ variables: ['y'], annotation: { variable: 'y' } })
    const changes = findSidecarPortChanges([xPort()], save.ports)
    expect(changes.every(({ before, after }) => before.annotation.subject === after.annotation.subject)).toBe(true)
  })

  it('asks before a save that drops a connected annotated port, and saves nothing when cancelled', async () => {
    const other = { id: 'b', data: { name: 'b', mathRef: 'file:other', ports: [] } }
    const xPortRef = xPort()
    const partner = { ...xPort(), annotation: { ...xPort().annotation, subject: 'other#x', role: 'owner' } }
    flowNodes.value = [{ id: 'a', data: { name: 'a', mathRef: MATH_REF, ports: [xPortRef] } }, other]
    flowEdges.value = [{ id: 'e', source: 'a', target: 'b', data: { couplings: [{ sourcePort: xPortRef, targetPort: partner }] } }]
    useLibraryStore().setModuleAnnotations(MATH_REF, SIDECAR.replace(/m:vdecayx01 [^\n]*\n/, ''))
    confirm.mockImplementation(async ({ header }) => header !== 'Remove Couplings?')
    mountDialog({ defaultTab: 'ports', initialPorts: [xPortRef] })
    const editor = await open()
    await report(editor, 'init', XML)
    await flushPromises()

    await wrapper.findAll('button').find((button) => button.text() === 'Save').trigger('click')
    await flushPromises()

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: 'Removes 1 coupling on 1 connection.' }))
    expect(wrapper.emitted('confirm')).toBeUndefined()
    confirm.mockImplementation(async () => true)
    flowNodes.value = []
    flowEdges.value = []
  })

  it('lets a mirrored port pick its variable, and says it needs one rather than a label', async () => {
    mountDialog({ defaultTab: 'ports', initialPorts: [copiedPort()] })
    const editor = await open()
    await report(editor, 'init', XML)

    expect(wrapper.find('.ports-tab-body tbody tr').findComponent(PortVariableSelect).props('locked')).toBe(true)
    await wrapper.findAll('button').find((button) => button.text() === 'Save').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('confirm')).toBeUndefined()
    expect(wrapper.find('.ports-header').text()).toBe('1 annotated port needs a variable.')
  })
})
