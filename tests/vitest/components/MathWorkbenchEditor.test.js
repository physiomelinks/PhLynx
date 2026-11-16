// @vitest-environment happy-dom
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EquationWorkbench } from 'vue3-math-editor'

import MathWorkbenchEditor from '../../../src/components/MathWorkbenchEditor.vue'
import { MATH_EDIT_DEBOUNCE_MS } from '../../../src/utils/constants'

const XML = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="decay">
  <component name="decay">
    <variable name="t" units="second" interface="public_and_private"/>
    <variable name="x" units="metre" initial_value="1"/>
    <variable name="k" units="per_second" initial_value="0.5"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/>
        <apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply>
        <apply><times/><apply><minus/><ci>k</ci></apply><ci>x</ci></apply>
      </apply>
    </math>
  </component>
</model>`

const DEFINITIONS = [
  { name: 't', units: 'second', interface: 'public_and_private' },
  { name: 'x', units: 'metre', initialValue: '1' },
  { name: 'k', units: 'per_second', initialValue: '0.5' },
]

const EQUATION = '<math xmlns="http://www.w3.org/1998/Math/MathML"><apply><eq/><ci>a</ci><ci>k</ci></apply></math>'
const OTHER_EQUATION = '<math xmlns="http://www.w3.org/1998/Math/MathML"><apply><eq/><ci>b</ci><ci>k</ci></apply></math>'
const line = (mathml, { complete = true, id = mathml } = {}) => ({ id, mathml, variables: [], units: [], complete })

// What the stub's next setMathML reports, and how many times it was called.
let nextImportProblems = []
let nextLineProblems = []
let loadCount = 0

/** Stands in for EquationWorkbench, so a test decides exactly which lines it reports. */
const WorkbenchStub = defineComponent({
  props: {
    issues: { type: Array, default: () => [] },
    readonly: Boolean,
    validate: { type: String, default: 'input' },
    autofocus: Boolean,
  },
  emits: ['equations-change', 'line-commit', 'variable-click'],
  setup(_, { emit, expose }) {
    expose({
      setMathML: (xml) => {
        loadCount++
        emit('equations-change', xml ? [line(xml, { id: 'loaded' })] : [line('', { complete: false })], {
          source: 'load',
        })
        return { equations: [], problems: nextImportProblems, lineProblems: nextLineProblems }
      },
      focus: () => {},
    })
    return () => h('div')
  },
})

let wrapper
afterEach(() => {
  wrapper?.unmount()
  nextImportProblems = []
  nextLineProblems = []
})

/** Mounts the editor and waits for its `init` report. */
async function mountEditor({ stub = true, props = {} } = {}) {
  wrapper = mount(MathWorkbenchEditor, {
    props: { modelValue: XML, variableDefinitions: DEFINITIONS, ...props },
    global: { plugins: [PrimeVue], ...(stub ? { stubs: { EquationWorkbench: WorkbenchStub } } : {}) },
  })
  await nextTick()
  await nextTick()
  return wrapper
}

const changes = () => (wrapper.emitted('change') ?? []).map(([change]) => change)
const workbench = () => wrapper.findComponent(WorkbenchStub)
const edit = (lines) => workbench().vm.$emit('equations-change', lines, { source: 'edit' })
const commit = (committed, reason = 'enter') => workbench().vm.$emit('line-commit', committed, { reason })

describe('MathWorkbenchEditor', () => {
  it('reports init with the model rebuilt from the loaded equations', async () => {
    await mountEditor()
    const [init] = changes()
    expect(init).toMatchObject({ source: 'init', format: 'mathml', valid: true })
    expect(init.xml).toContain('<component name="decay">')
    expect(init.xml).toContain('<variable name="k" units="per_second" initial_value="0.5"/>')
    expect(init.text).toContain('<ci>k</ci>')
  })

  it('asks the workbench to validate on commit and to take focus', async () => {
    await mountEditor()
    expect(workbench().props()).toMatchObject({ validate: 'commit', autofocus: true, readonly: false, issues: [] })
  })

  describe('reporting edits once typing pauses', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('reports an edit once, after the pause, and not again on commit', async () => {
      await mountEditor()
      const reported = changes().length
      // The workbench keeps a line's id while it is edited.
      edit([line(EQUATION, { id: 'loaded' })])
      vi.advanceTimersByTime(MATH_EDIT_DEBOUNCE_MS - 1)
      expect(changes()).toHaveLength(reported)

      vi.advanceTimersByTime(1)
      expect(changes()).toHaveLength(reported + 1)
      expect(changes().at(-1)).toMatchObject({ source: 'edit', valid: true })
      expect(changes().at(-1).xml).toContain('<ci>a</ci>')

      commit(line(EQUATION, { id: 'loaded' }), 'blur')
      vi.advanceTimersByTime(2000)
      expect(changes()).toHaveLength(reported + 1)
    })

    it('reports a commit at once, without a second report after the pause', async () => {
      await mountEditor()
      const reported = changes().length
      edit([line(EQUATION, { id: 'loaded' })])
      commit(line(EQUATION, { id: 'loaded' }))
      expect(changes()).toHaveLength(reported + 1)

      vi.advanceTimersByTime(2000)
      expect(changes()).toHaveLength(reported + 1)
    })

    it('does not report incomplete lines', async () => {
      await mountEditor()
      const reported = changes().length
      edit([line(EQUATION, { id: 'loaded' }), line(EQUATION, { complete: false, id: 'second' })])
      vi.advanceTimersByTime(2000)
      expect(changes()).toHaveLength(reported)
    })

    it('waits for typing to stop', async () => {
      await mountEditor()
      const reported = changes().length
      edit([line(EQUATION, { id: 'loaded' })])
      vi.advanceTimersByTime(MATH_EDIT_DEBOUNCE_MS - 100)
      edit([line(OTHER_EQUATION, { id: 'loaded' })])
      vi.advanceTimersByTime(MATH_EDIT_DEBOUNCE_MS - 100)
      expect(changes()).toHaveLength(reported)

      vi.advanceTimersByTime(100)
      expect(changes()).toHaveLength(reported + 1)
      expect(changes().at(-1).xml).toContain('<ci>b</ci>')
    })

    it('cancels the pause on flush, load and unmount', async () => {
      await mountEditor()
      const reported = changes().length
      edit([line(EQUATION, { id: 'loaded' })])
      wrapper.vm.flush()
      vi.advanceTimersByTime(2000)
      expect(changes()).toHaveLength(reported + 1)

      edit([line(OTHER_EQUATION, { id: 'loaded' })])
      await wrapper.vm.setModel(XML)
      vi.advanceTimersByTime(2000)
      expect(changes()).toHaveLength(reported + 1)

      edit([line(EQUATION, { id: 'loaded' })])
      const emitted = wrapper.emitted('change')
      wrapper.unmount()
      wrapper = null
      vi.advanceTimersByTime(2000)
      expect(emitted).toHaveLength(reported + 1)
    })

    it('reports nothing while the component is locked', async () => {
      nextImportProblems = ["<foo> isn't supported"]
      nextLineProblems = [["<foo> isn't supported"]]
      await mountEditor()
      const reported = changes().length
      edit([line(EQUATION, { id: 'loaded' })])
      vi.advanceTimersByTime(2000)
      expect(changes()).toHaveLength(reported)
    })

    it('does not report a half-typed line when new definitions arrive mid-edit', async () => {
      await mountEditor()
      // A new name is reported once typing pauses; the session then declares it.
      edit([line(EQUATION, { id: 'loaded' })])
      vi.advanceTimersByTime(MATH_EDIT_DEBOUNCE_MS)
      const reported = changes().length

      // Typing carries on, so the line is incomplete when the new definitions arrive.
      edit([line(EQUATION, { complete: false, id: 'loaded' })])
      await wrapper.setProps({ variableDefinitions: [...DEFINITIONS, { name: 'a', units: 'metre' }] })
      vi.advanceTimersByTime(2000)
      expect(changes()).toHaveLength(reported)

      // Once the line is complete, the edit is reported with the new definitions.
      edit([line(EQUATION, { id: 'loaded' })])
      vi.advanceTimersByTime(MATH_EDIT_DEBOUNCE_MS)
      expect(changes()).toHaveLength(reported + 1)
      expect(changes().at(-1)).toMatchObject({ source: 'edit', valid: true })
      expect(changes().at(-1).xml).toContain('<variable name="a" units="metre"/>')
    })
  })

  it('reports an uncommitted edit when flushed', async () => {
    await mountEditor()
    edit([line(EQUATION)])
    wrapper.vm.flush()
    expect(changes().at(-1)).toMatchObject({ source: 'edit', valid: true })
  })

  it('reports deleting a line at once, since that never commits one', async () => {
    await mountEditor()
    edit([line(EQUATION, { id: 'first' }), line(OTHER_EQUATION, { id: 'second' })])
    commit(line(OTHER_EQUATION, { id: 'second' }))
    const reported = changes().length

    edit([line(EQUATION, { id: 'first' })])
    expect(changes()).toHaveLength(reported + 1)
    expect(changes().at(-1).xml).not.toContain('<ci>b</ci>')
  })

  it('reports an incomplete line as an edit that does not parse, leaving the message to the workbench', async () => {
    await mountEditor()
    edit([line(EQUATION, { id: 'first' }), line(EQUATION, { complete: false, id: 'second' })])
    wrapper.vm.flush()

    expect(changes().at(-1)).toMatchObject({ source: 'edit', valid: false, xml: null })
    expect(wrapper.vm.getErrors()).toEqual([{ line: 2, message: 'This equation is incomplete.' }])
    await nextTick()
    expect(workbench().props('issues')).toEqual([])
  })

  it('reports a line that is not an equation', async () => {
    await mountEditor()
    const expression = '<math xmlns="http://www.w3.org/1998/Math/MathML"><apply><plus/><ci>a</ci><ci>b</ci></apply></math>'
    edit([line(expression)])
    wrapper.vm.flush()

    expect(changes().at(-1)).toMatchObject({ source: 'edit', valid: false })
    expect(wrapper.vm.getErrors()[0].line).toBe(1)
  })

  it('locks the component when the workbench could not import its math', async () => {
    nextImportProblems = ["<foo> isn't supported"]
    nextLineProblems = [["<foo> isn't supported"]]
    await mountEditor()
    expect(changes()[0]).toMatchObject({ source: 'init', valid: false, xml: null })
    expect(wrapper.vm.getErrors()).toEqual([{ line: null, message: nextImportProblems[0] }])

    await nextTick()
    expect(workbench().props('readonly')).toBe(true)
    expect(workbench().props('issues')).toEqual([
      { lineId: 'loaded', message: "The Math Editor can't edit this component. Use the CellML Text tab." },
    ])
  })

  it('declares new definitions and component names as external changes', async () => {
    await mountEditor()
    edit([line(EQUATION)])
    wrapper.vm.flush()

    await wrapper.setProps({ componentName: 'renamed', variableDefinitions: [...DEFINITIONS, { name: 'a', units: 'metre' }] })
    wrapper.vm.flush()

    const change = changes().at(-1)
    expect(change).toMatchObject({ source: 'external', valid: true })
    expect(change.xml).toContain('<component name="renamed">')
    expect(change.xml).toContain('<variable name="a" units="metre"/>')
  })

  it('declares kept names no equation uses, and rebuilds when they change', async () => {
    const definitions = [...DEFINITIONS, { name: 'cAMP', units: 'dimensionless' }]
    await mountEditor({ props: { variableDefinitions: definitions, keepVariables: ['cAMP'] } })
    expect(changes()[0].xml).toContain('<variable name="cAMP" units="dimensionless"/>')

    await wrapper.setProps({ keepVariables: [] })
    wrapper.vm.flush()
    expect(changes().at(-1)).toMatchObject({ source: 'external', valid: true })
    expect(changes().at(-1).xml).not.toContain('cAMP')
  })

  it('keeps its lines when the session replays the edit it just reported', async () => {
    await mountEditor()
    edit([line(EQUATION), line('', { complete: false, id: 'empty' })])
    wrapper.vm.flush()
    const loads = loadCount

    await wrapper.vm.setText(changes().at(-1).text)
    expect(loadCount).toBe(loads)
  })

  it('shows another editor’s model without reporting it', async () => {
    await mountEditor()
    const reported = changes().length
    await wrapper.vm.setModel(XML.replace(/\bk\b/g, 'rate'))

    expect(changes()).toHaveLength(reported)
    expect(wrapper.vm.getErrors()).toEqual([])
  })

  it('sends undo, redo and save to the dialog', async () => {
    await mountEditor()
    const container = wrapper.find('.container')
    await container.trigger('keydown', { key: 'z', ctrlKey: true })
    await container.trigger('keydown', { key: 'z', ctrlKey: true, shiftKey: true })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true }))

    expect(wrapper.emitted('undo')).toHaveLength(1)
    expect(wrapper.emitted('redo')).toHaveLength(1)
    expect(wrapper.emitted('save')).toHaveLength(1)
  })

  it('passes on the name of a variable clicked in the math', async () => {
    await mountEditor()
    workbench().vm.$emit('variable-click', { name: 'x', lineId: 'loaded' })

    expect(wrapper.emitted('variable-click')).toEqual([['x']])
  })

  it('shows the math read-only when asked, and still passes on clicked variables', async () => {
    await mountEditor({ props: { readonly: true } })
    expect(workbench().props('readonly')).toBe(true)
    workbench().vm.$emit('variable-click', { name: 'x', lineId: 'loaded' })

    expect(wrapper.emitted('variable-click')).toEqual([['x']])
  })

  it('round-trips a model through the real workbench', async () => {
    await mountEditor({ stub: false })
    expect(wrapper.findComponent(EquationWorkbench).exists()).toBe(true)

    const [init] = changes()
    expect(init).toMatchObject({ source: 'init', valid: true })
    expect(init.xml).toContain('<diff/>')
    expect(init.xml).toContain('<ci>k</ci>')
    expect(init.xml).toContain('<variable name="x" units="metre" initial_value="1"/>')
  })

  it('offers the workbench’s Copy as menu without its output panel', async () => {
    await mountEditor({ stub: false })
    expect(wrapper.find('[data-role="copy-as"]').exists()).toBe(true)
    expect(wrapper.find('[data-role="outputs"]').exists()).toBe(false)
  })
})
