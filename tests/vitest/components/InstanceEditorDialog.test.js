// @vitest-environment happy-dom
import { defineComponent, h, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { useFlowHistoryStore } from '../../../src/stores/historyStore.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

const confirm = vi.fn(async () => true)
const flowNodes = ref([])
const flowEdges = ref([])
vi.mock('../../../src/composables/useConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm }) }))
vi.mock('@vue-flow/core', async (importOriginal) => ({
  ...(await importOriginal()),
  useVueFlow: () => ({ nodes: flowNodes, edges: flowEdges }),
}))
vi.mock('../../../src/utils/layout', () => ({ waitUntilStable: () => Promise.resolve() }))

const { default: InstanceEditorDialog } = await import('../../../src/components/InstanceEditorDialog.vue')
const { default: ComponentSaveAsDialog } = await import('../../../src/components/dialogs/ComponentSaveAsDialog.vue')
const { NEW_MODULE_MATH_REF } = await import('../../../src/utils/constants.js')
const { cycleMultiportType } = await import('../../../src/utils/multiport.js')

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

/** Stands in for CellMLTextEditor: the test emits its events and watches what the session asks of it. */
const FakeEditor = defineComponent({
  emits: ['change', 'undo', 'redo'],
  setup(_, { expose }) {
    expose({ format: 'mathml', setText, setModel, flush: () => {}, getErrors: () => [], focus: () => {} })
    return () => h('div')
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

let wrapper
afterEach(() => wrapper?.unmount())

/**
 * Mounts the dialog closed, with the editors stubbed.
 *
 * @param {Object} [props] - Props beyond the defaults.
 * @returns {import('@vue/test-utils').VueWrapper}
 */
function mountDialog(props = {}) {
  wrapper = mount(InstanceEditorDialog, {
    props: { modelValue: false, id: 'a', initialName: 'a', mathRef: MATH_REF, ...props },
    global: {
      plugins: [PrimeVue],
      stubs: { Dialog: DialogStub, CellMLTextEditor: FakeEditor, MathWorkbenchEditor: FakeEditor, ParameterTable: ParameterTableStub },
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
    expect(save.mathRef).toBe(`${NEW_MODULE_MATH_REF.split(':')[0]}:my_comp`)
    expect(save.previousMathRef).toBe(NEW_MODULE_MATH_REF)
    expect(save.math).toContain('<component name="my_comp"')
    expect(save.math).not.toContain('<component name="new_module"')
    expect(useLibraryStore().availableMath.get(NEW_MODULE_MATH_REF)).not.toContain('<cn>1</cn>')
  })

  it('keeps the editor open when the rename is cancelled', async () => {
    const saveAs = await saveEditedTemplate()
    saveAs.vm.$emit('cancel')
    await flushPromises()

    expect(wrapper.emitted('confirm')).toBeUndefined()
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
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
