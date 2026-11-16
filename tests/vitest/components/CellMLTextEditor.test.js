// @vitest-environment happy-dom
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorView } from '@codemirror/view'
import { CellMLTextParser } from 'cellml-text-editor'

import CellMLTextEditor from '../../../src/components/CellMLTextEditor.vue'

const modelWith = (rightHandSide) => `<model xmlns="http://www.cellml.org/cellml/2.0#" name="m">
  <component name="c">
    <variable name="x" units="metre"/>
    <variable name="y" units="metre"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/><ci>y</ci>${rightHandSide}</apply>
    </math>
  </component>
</model>`

const DEFINITIONS = [
  { name: 'x', units: 'metre' },
  { name: 'y', units: 'metre' },
]

let wrapper
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

/** Lays the text out without a layout engine: each character 10px wide, at the position a click's x names. */
function mockLayout() {
  vi.spyOn(EditorView.prototype, 'posAtCoords').mockImplementation(({ x }) => Math.floor(x / 10))
  vi.spyOn(EditorView.prototype, 'coordsAtPos').mockImplementation((position) => ({ left: position * 10, right: position * 10, top: 0, bottom: 10 }))
}

/**
 * Clicks just inside the character at a position.
 *
 * @param {number} position
 * @param {Object} [init] - The click's event options beyond a plain click.
 */
function clickAt(position, init = {}) {
  wrapper.find('.cm-content').element.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, detail: 1, clientX: position * 10 + 2, ...init }))
}

/** Mounts the editor (Simple Mode unless told otherwise) and waits for its `init` report. */
async function mountEditor(xml, props = {}) {
  wrapper = mount(CellMLTextEditor, {
    props: { modelValue: xml, simple: true, componentName: 'c', variableDefinitions: DEFINITIONS, ...props },
    global: { plugins: [PrimeVue] },
    attachTo: document.body,
  })
  await nextTick()
  await nextTick()
  return wrapper
}

const changes = () => (wrapper.emitted('change') ?? []).map(([change]) => change)
const isEditable = () => wrapper.find('.cm-content').attributes('contenteditable') === 'true'

describe('CellMLTextEditor', () => {
  it('edits math the text can hold', async () => {
    await mountEditor(modelWith('<apply><root/><ci>x</ci></apply>'))
    expect(isEditable()).toBe(true)
    expect(wrapper.vm.getErrors()).toEqual([])
    expect(changes()[0]).toMatchObject({ source: 'init', valid: true })
    expect(changes()[0].xml).toContain('<root/>')
  })

  it('locks the text when it cannot hold all the math', async () => {
    await mountEditor(modelWith('<apply><factorial/><ci>x</ci></apply>'))
    expect(isEditable()).toBe(false)

    const [lead, ...details] = wrapper.vm.getErrors()
    expect(lead.message).toContain('Use the Math Editor tab')
    expect(details.map((err) => err.message)).toEqual(['<factorial> is not supported in CellML Text'])
    expect(wrapper.find('.error-banner').text()).toContain('<factorial> is not supported in CellML Text')

    // The marked text doesn't parse, so nothing is reported as a valid model or as an edit.
    expect(changes().map(({ source, valid }) => ({ source, valid }))).toEqual([{ source: 'init', valid: false }])
  })

  it('declares kept names no equation uses in Simple Mode, and rebuilds when they change', async () => {
    const definitions = [...DEFINITIONS, { name: 'cAMP', units: 'dimensionless' }]
    await mountEditor(modelWith('<ci>x</ci>'), { variableDefinitions: definitions, keepVariables: ['cAMP'] })
    expect(changes()[0].xml).toContain('<variable name="cAMP" units="dimensionless"')

    await wrapper.setProps({ keepVariables: [] })
    wrapper.vm.flush()
    expect(changes().at(-1)).toMatchObject({ source: 'external', valid: true })
    expect(changes().at(-1).xml).not.toContain('cAMP')
  })

  it('renames every use of a variable and reports it as an edit', async () => {
    await mountEditor(modelWith('<apply><plus/><ci>x</ci><apply><sin/><ci>x</ci></apply></apply>'))
    const text = changes()[0].text
    expect(text).toMatch(/\bx\b.*\bx\b/)

    await wrapper.vm.renameVariable('x', 'z')
    const last = changes().at(-1)
    expect(last).toMatchObject({ source: 'edit', valid: true })
    expect(last.text).toBe(text.replace(/\bx\b/g, 'z'))
    expect(last.text).toContain('sin(') // function names are left alone
  })

  it('shows the comments in the layout it is given, and reports the layout', async () => {
    const xml = modelWith('<apply><plus/><ci>x</ci><ci>x</ci></apply>')
    const parser = new CellMLTextParser({ simplified: true })
    const layout = parser.parse('// Twice x\ny = x + x;\n', { baseXml: xml, componentName: 'c' }).layout
    await mountEditor(xml, { layout })
    expect(changes()[0].text).toBe('// Twice x\ny = x + x;\n')
    expect(JSON.stringify(changes()[0].layout)).toContain('// Twice x')
  })

  it('keeps Advanced Mode variable comments through a Simple Mode edit', async () => {
    await mountEditor(modelWith('<ci>x</ci>'), { simple: false })
    const advanced = changes()[0].text.replace(/(var x: [^\n]*;)/, '$1 // length')
    await wrapper.vm.setText(advanced, { report: true, source: 'edit' })

    await wrapper.setProps({ simple: true })
    await nextTick()
    const simple = changes().at(-1).text
    expect(simple).not.toContain('var x')
    await wrapper.vm.setText(`// Copy\n${simple}`, { report: true, source: 'edit' })
    const layout = JSON.stringify(changes().at(-1).layout)
    expect(layout).toContain('// Copy')
    expect(layout).toContain('// length')

    await wrapper.setProps({ simple: false })
    await nextTick()
    expect(changes().at(-1).text).toMatch(/var x: [^\n]*; \/\/ length/)
    expect(changes().at(-1).text).toContain('// Copy')
  })

  it('reports a variable clicked in the text, and nothing for a function, a modified click or the space beside a name', async () => {
    await mountEditor(modelWith('<apply><plus/><ci>x</ci><apply><sin/><ci>x</ci></apply></apply>'))
    const text = changes()[0].text
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    mockLayout()
    const x = text.indexOf('x')

    clickAt(text.indexOf('sin'))
    clickAt(x, { ctrlKey: true })
    clickAt(x, { shiftKey: true })
    // Just past the name's end, where the word still resolves to it.
    wrapper.find('.cm-content').element.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, detail: 1, clientX: (x + 1) * 10 + 5 }))
    vi.runAllTimers()
    expect(wrapper.emitted('variable-click')).toBeUndefined()

    clickAt(x)
    expect(wrapper.emitted('variable-click')).toBeUndefined()
    vi.runAllTimers()
    expect(wrapper.emitted('variable-click')).toEqual([['x']])
  })

  it('reports nothing for a name double-clicked to select it', async () => {
    await mountEditor(modelWith('<apply><plus/><ci>x</ci><ci>x</ci></apply>'))
    const text = changes()[0].text
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    mockLayout()

    clickAt(text.indexOf('x'))
    clickAt(text.indexOf('x'), { detail: 2 })
    vi.runAllTimers()
    expect(wrapper.emitted('variable-click')).toBeUndefined()
  })

  it('shows the math read-only, still lets Simple Mode be switched, and reports clicked variables', async () => {
    await mountEditor(modelWith('<apply><plus/><ci>x</ci><ci>x</ci></apply>'), { readonly: true })
    expect(isEditable()).toBe(false)
    const toggle = wrapper.findComponent({ name: 'ToggleSwitch' })
    expect(toggle.props('disabled')).toBeFalsy()
    toggle.vm.$emit('update:modelValue', true)
    expect(wrapper.emitted('update:simple')).toEqual([[true]])

    const text = changes()[0].text
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    mockLayout()
    clickAt(text.indexOf('x'))
    vi.runAllTimers()
    expect(wrapper.emitted('variable-click')).toEqual([['x']])
  })
})
