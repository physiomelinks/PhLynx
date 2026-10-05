// @vitest-environment happy-dom
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import { afterEach, describe, expect, it } from 'vitest'
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
afterEach(() => wrapper?.unmount())

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
})
