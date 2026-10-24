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
const { NEW_MODULE_MATH_REF } = await import('../../../src/utils/constants.js')
const { cycleMultiportType } = await import('../../../src/utils/multiport.js')
const { useCelldlEditorHost } = await import('../../../src/composables/useCelldlEditorHost.js')
const { useLiveCelldlConvert } = await import('../../../src/composables/useLiveCelldlConvert.js')

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

    it('follows newer conversions, and shows the saved math again once the diagram is saved', async () => {
      await openEdited()
      useLiveCelldlConvert().cellml.value = { cellml: LIVE_CELLML.replaceAll('k_live', 'k_newer'), componentName: 'decay' }
      await flushPromises()
      expect(setModel).toHaveBeenLastCalledWith(expect.stringContaining('k_newer'))

      useCelldlEditorHost().isDirty.value = false
      await flushPromises()
      expect(setModel).toHaveBeenLastCalledWith(savedMath)
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
      expect(setModel).toHaveBeenLastCalledWith(savedMath)
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
        updateAll: false,
        siblings: [],
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
        choose.mockResolvedValueOnce('extra')
        // Converted under the module's name first, then again as the new component.
        convertCelldl
          .mockResolvedValueOnce(converted())
          .mockResolvedValue(converted({ components: [{ name: 'fast', math: FAST_XML }], documentUri: NEW_URI }))
      })

      /** Saves the edited diagram, choosing a new component, and waits for Save As to ask its name. */
      async function startSaveAs({ isAppliedToAll = false } = {}) {
        mountDialog()
        await wrapper.setProps({ modelValue: true })
        await vi.waitFor(() => expect(wrapper.findComponent(CelldlPaneStub).exists()).toBe(true))
        host.isDirty.value = true
        if (isAppliedToAll) await wrapper.find('#applyToAll').setValue(true)
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
        const isTaken = saveAs.props('isTaken')
        expect(isTaken('decay')).toBe('A component named "decay" already exists.')
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

      /** Opens the dialog on the diagram and renames its component, editing the diagram too unless told not to. */
      async function openRenamed(name = 'fast', { isEdited = true } = {}) {
        mountDialog()
        await wrapper.setProps({ modelValue: true })
        await vi.waitFor(() => expect(wrapper.findComponent(CelldlPaneStub).exists()).toBe(true))
        host.isDirty.value = isEdited
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

        it("asks, then overwrites it with this diagram under its documentUri and file, moving this instance to it", async () => {
          await openRenamed()
          await clickSave()

          expect(choose).toHaveBeenCalledWith(
            expect.objectContaining({ header: 'Overwrite Math?', acceptLabel: 'Overwrite', extraLabel: 'Save as new component' })
          )
          expect(choose.mock.calls[0][0].message).toBe(
            '"fast" already exists. This will affect 2 other instances. Overwrite it, or save your changes as a new component?'
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
            updateAll: false,
            siblings: [],
          })
          expect(useLibraryStore().getMathSource(MATH_REF)).toEqual(SOURCE)
        })

        it('saves as a new component under an unused name instead, when asked', async () => {
          choose.mockResolvedValueOnce('extra')
          await openRenamed()
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
          await openRenamed()
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

  it("saves CellML math as before: an overwrite asks and applies here unless ticked, a rename stays in its math's grouping", async () => {
    mountDialog()
    const editor = await open()
    await report(editor, 'init', XML)
    await report(editor, 'edit', EDITED_XML)
    await wrapper.findAll('button').find((button) => button.text() === 'Save').trigger('click')
    await flushPromises()

    expect(choose).toHaveBeenCalledWith(expect.objectContaining({ header: 'Overwrite Math?' }))
    expect(convertCelldl).not.toHaveBeenCalled()
    expect(wrapper.emitted('confirm')[0][0]).toMatchObject({ mathRef: MATH_REF, updateAll: false, siblings: [], source: null })

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

  it("asks before a rename onto another component of its grouping's, counting that component's instances", async () => {
    useLibraryStore().addMath('file:growth', XML.replaceAll('decay', 'growth'))
    flowNodes.value = [...flowNodes.value, { id: 'c', data: { name: 'c', mathRef: 'file:growth' } }]
    mountDialog()
    const editor = await open()
    await report(editor, 'init', XML)
    await report(editor, 'edit', EDITED_XML.replaceAll('decay', 'growth'))
    await wrapper.findAll('button').find((button) => button.text() === 'Save').trigger('click')
    await flushPromises()

    expect(choose.mock.calls[0][0].message).toBe(
      '"growth" already exists. This will affect 1 other instance. Overwrite it, or save your changes as a new component?'
    )
    expect(wrapper.emitted('confirm')[0][0]).toMatchObject({ mathRef: 'file:growth', previousMathRef: MATH_REF })
  })

  describe('saving CellML math as a new component', () => {
    /** Edits the math and saves it, choosing a new component, and waits for Save As to ask its name. */
    async function startSaveAs({ isAppliedToAll = false } = {}) {
      choose.mockResolvedValueOnce('extra')
      mountDialog()
      const editor = await open()
      await report(editor, 'init', XML)
      await report(editor, 'edit', EDITED_XML)
      if (isAppliedToAll) await wrapper.find('#applyToAll').setValue(true)
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

      expect(choose).toHaveBeenCalledWith(
        expect.objectContaining({ header: 'Overwrite Math?', acceptLabel: 'Overwrite', extraLabel: 'Save as new component' })
      )
      const isTaken = saveAs.props('isTaken')
      expect(isTaken('decay')).toBe('A component named "decay" already exists.')
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
