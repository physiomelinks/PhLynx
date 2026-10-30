// @vitest-environment happy-dom
import { defineComponent, h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import Select from 'primevue/select'
import Checkbox from 'primevue/checkbox'
import { beforeAll, describe, expect, it } from 'vitest'

import ApplyAnnotationsDialog from '../../../src/components/ApplyAnnotationsDialog.vue'
import {
  attachedModules,
  matchSidecarToMath,
  planInstances,
  readSidecarComponent,
} from '../../../src/services/annotations/generate.js'
import { loadToy, readToy } from '../services/annotations/toyModel.js'

const DialogStub = defineComponent({
  setup(_, { slots }) {
    return () => h('div', [slots.default?.(), slots.footer?.()])
  },
})
const global = { plugins: [PrimeVue], stubs: { Dialog: DialogStub }, directives: { tooltip: {} } }

const MATHS = ['pool.cellml:pool', 'porter.cellml:porter', 'wall.cellml:wall']
const RIVAL = `
@prefix bqbiol: <http://biomodels.net/biology-qualifiers/> .
@prefix uniprot: <http://identifiers.org/uniprot/> .
@prefix m: <./rival.cellml#> .
m:rival bqbiol:is uniprot:Q0TOY1 .
`

describe('ApplyAnnotationsDialog', () => {
  let toy

  beforeAll(async () => {
    toy = await loadToy()
  })

  /** A prepared import as readAnnotationFiles gives it, for the toy's sidecars and instance file. */
  async function prepare({ names = ['pool', 'porter', 'wall'], extra = [], mathRefs = MATHS } = {}) {
    const files = [...names.map((name) => ({ filename: `${name}.ttl`, text: readToy(`${name}.ttl`) })), ...extra]
    const sidecars = await Promise.all(
      files.map(async ({ filename, text }) => {
        const component = await readSidecarComponent(text)
        return {
          filename,
          text,
          component,
          sidecar: toy.sidecars.get(component.componentName) ?? null,
          match: matchSidecarToMath(component, mathRefs),
          error: null,
        }
      })
    )
    return {
      sidecars,
      instanceFile: { location: 'toy-apicoords.ttl', format: 'turtle', text: '' },
      apiCoords: { instances: toy.instances, warnings: [] },
    }
  }

  const mountDialog = (prepared, nodes = []) =>
    mount(ApplyAnnotationsDialog, {
      props: {
        modelValue: true,
        prepared,
        planRows: (plan, targets) =>
          planInstances({ instances: plan.apiCoords.instances, modules: attachedModules(plan.sidecars, targets), nodes }),
      },
      global,
    })

  const instanceRows = (wrapper) => wrapper.find('[data-test="instances"]').findAll('tbody tr')
  const applyButton = (wrapper) => wrapper.find('[data-test="apply"]')
  const lastApply = (wrapper) => wrapper.emitted('apply').at(-1)[0]

  it('lists each instance with its kind, module and binding, and applies them all as new', async () => {
    const wrapper = mountDialog(await prepare())
    const rows = instanceRows(wrapper)
    expect(rows.map((row) => row.findAll('td')[0].text())).toEqual([
      'outside',
      'cell',
      'wall',
      'porter_in',
      'porter_out',
      'vessel',
    ])
    expect(rows[3].text()).toContain('deployment')
    expect(rows[3].text()).toContain('porter.cellml:porter')
    expect(rows[4].text()).toContain('porter.cellml:porter')
    expect(rows.every((row) => row.text().includes('New'))).toBe(true)
    expect(applyButton(wrapper).text()).toBe('Apply (add 6)')
    expect(wrapper.text()).toContain('the sidecars and the instance file stay stored')

    await applyButton(wrapper).trigger('click')
    const { targets, rows: applied } = lastApply(wrapper)
    expect(targets).toEqual({ 'pool.ttl': 'pool.cellml:pool', 'porter.ttl': 'porter.cellml:porter', 'wall.ttl': 'wall.cellml:wall' })
    expect(applied.map((row) => row.heldConstant)).toEqual([false, false, false, false, false, false])
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
  })

  it('ticks held constant per instance', async () => {
    const wrapper = mountDialog(await prepare())
    const boxes = wrapper.findAllComponents(Checkbox)
    boxes[0].vm.$emit('update:modelValue', true)
    boxes[5].vm.$emit('update:modelValue', true)
    await flushPromises()
    await applyButton(wrapper).trigger('click')
    const held = lastApply(wrapper).rows.filter((row) => row.heldConstant).map((row) => row.name)
    expect(held).toEqual(['outside', 'vessel'])
  })

  it('asks for a module when two fit, and skips an instance none fits', async () => {
    const prepared = await prepare({
      names: ['pool', 'porter'],
      extra: [{ filename: 'rival.ttl', text: RIVAL }],
      mathRefs: [...MATHS, 'rival.cellml:rival'],
    })
    const wrapper = mountDialog(prepared)
    const rows = instanceRows(wrapper)
    expect(rows[2].find('[data-test="unresolved"]').exists()).toBe(true)
    expect(rows[2].findComponent(Checkbox).props('disabled')).toBe(true)
    const selects = wrapper.findAll('[data-test="module-select"]')
    expect(selects).toHaveLength(2)
    expect(applyButton(wrapper).text()).toBe('Apply (add 3)')

    const select = rows[3].findComponent(Select)
    expect(select.props('options')).toEqual(['porter.cellml:porter', 'rival.cellml:rival'])
    select.vm.$emit('update:modelValue', 'rival.cellml:rival')
    await flushPromises()
    expect(applyButton(wrapper).text()).toBe('Apply (add 4)')
    await applyButton(wrapper).trigger('click')
    const porterIn = lastApply(wrapper).rows.find((row) => row.name === 'porter_in')
    expect(porterIn.mathRef).toBe('rival.cellml:rival')
    expect(lastApply(wrapper).rows.find((row) => row.name === 'wall').mathRef).toBeNull()
  })

  it('reports a sidecar without math, and lets the user pick one of the same component', async () => {
    const mathRefs = ['pool.cellml:pool', 'porter.cellml:porter', 'Lib.cellml:wall', 'Old.cellml:wall', 'Lib.cellml:x']
    const wrapper = mountDialog(await prepare({ mathRefs }))
    const sidecarRows = wrapper.find('[data-test="sidecars"]').findAll('tbody tr')
    expect(sidecarRows[0].find('[data-test="sidecar-exact"]').exists()).toBe(true)
    expect(sidecarRows[2].find('[data-test="sidecar-unmatched"]').text()).toContain('Not stored until a math is picked')
    expect(instanceRows(wrapper)[2].find('[data-test="unresolved"]').exists()).toBe(true)

    // Only maths of the sidecar's component: its subjects would annotate nothing in another.
    const select = sidecarRows[2].findComponent(Select)
    expect(select.props('options')).toEqual(['Lib.cellml:wall', 'Old.cellml:wall'])
    select.vm.$emit('update:modelValue', 'Lib.cellml:wall')
    await flushPromises()
    expect(wrapper.find('[data-test="sidecars"]').findAll('[data-test="sidecar-unmatched"]')).toHaveLength(0)
    expect(instanceRows(wrapper)[2].text()).toContain('Lib.cellml:wall')
  })

  it('offers no math for a sidecar whose component no math has', async () => {
    const wrapper = mountDialog(await prepare({ mathRefs: ['pool.cellml:pool', 'porter.cellml:porter'] }))
    const wall = wrapper.find('[data-test="sidecars"]').findAll('tbody tr')[2]
    expect(wall.findComponent(Select).exists()).toBe(false)
    expect(wall.find('[data-test="sidecar-unmatched"]').text()).toContain('No math has a wall component: not stored')
  })

  it('shows the existing node an instance binds to, with held constant pre-ticked', async () => {
    const nodes = [
      {
        id: 'n1',
        data: {
          name: 'outside',
          mathRef: 'pool.cellml:pool',
          variables: [{ name: 'v_A', type: 'constant', value: '0' }],
        },
      },
    ]
    const wrapper = mountDialog(await prepare(), nodes)
    const outside = instanceRows(wrapper)[0]
    expect(outside.find('[data-test="binds"]').text()).toBe('outside')
    expect(outside.findComponent(Checkbox).props('modelValue')).toBe(true)
    expect(applyButton(wrapper).text()).toBe('Apply (add 5, bind 1)')
  })
})
