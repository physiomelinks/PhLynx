// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const onDragStart = vi.fn()
vi.mock('../../../src/composables/useDnD', () => ({ default: () => ({ onDragStart }) }))

const { default: LibraryArea } = await import('../../../src/components/LibraryArea.vue')
const { default: ModulePreviewDialog } = await import('../../../src/components/ModulePreviewDialog.vue')
const { useLibraryStore } = await import('../../../src/stores/libraryStore.js')
const { useDefaultParametersStore } = await import('../../../src/stores/defaultParametersStore.js')
const { NO_PARAMETER_SET } = await import('../../../src/utils/parameters/sets.js')
const { seedRefFor } = await import('../../../src/utils/parameters/seed.js')

const MATH_REF = 'compartment.cellml:compartment'
const param = (value, units = 'mM') => ({ value, units, data_reference: '', extra: {} })
const paramSet = (ref, values) => ({
  ref,
  source: { file: `${ref}_parameters.json`, importedAt: '' },
  globals: new Map([['F', param('96485', 'C_per_mol')]]),
  values: new Map(values),
})
const module = (subtype, defaultParameterisation) => ({
  moduleRef: `compartment:${subtype}`,
  mathRef: MATH_REF,
  ports: [],
  variables: [],
  ...(defaultParameterisation ? { defaultParameterisation } : {}),
})

let wrapper
afterEach(() => wrapper?.unmount())

/** Mounts the library with compartment's lumen and enterocyte configs, their group open. */
async function mountLibrary({ sets = ['lumen', 'enterocyte'], mathOnlyFirst = false } = {}) {
  const library = useLibraryStore()
  library.availableMath.set(MATH_REF, '<model/>')
  if (mathOnlyFirst) library.addModule(module('default'))
  library.addModule(module('lumen', 'lumen'))
  library.addModule(module('enterocyte', 'enterocyte'))
  const parameters = useDefaultParametersStore()
  for (const ref of sets) parameters.addSet(paramSet(ref, [['C', param(ref === 'lumen' ? '140' : '15')]]), { mathRef: MATH_REF })

  wrapper = mount(LibraryArea, {
    global: { plugins: [PrimeVue], stubs: { ModulePreviewDialog: true }, directives: { tooltip: {} } },
  })
  await wrapper.find('.mlc__group-header').trigger('click')
  await flushPromises()
  return wrapper
}

const selects = () => wrapper.findAllComponents({ name: 'Select' })
const parameterSelect = () => selects().find((select) => select.props('ariaLabel') === 'Parameter set')

/** Drags the card and gives the module the drag carries. */
async function drag() {
  onDragStart.mockClear()
  await wrapper.find('.mlc__card').trigger('dragstart', { dataTransfer: { setData: () => {} } })
  return onDragStart.mock.calls[0][1]
}

beforeEach(() => {
  setActivePinia(createPinia())
  onDragStart.mockClear()
})

describe('LibraryArea parameter sets', () => {
  it("lists the math's sets, marking and choosing the config's default", async () => {
    await mountLibrary()

    expect(parameterSelect().props('options')).toEqual([
      { label: 'None', value: NO_PARAMETER_SET },
      { label: 'lumen (default)', value: 'lumen' },
      { label: 'enterocyte', value: 'enterocyte' },
    ])
    expect(parameterSelect().props('modelValue')).toBe('lumen')
    expect((await drag()).parameterisation).toBe('lumen')
  })

  it("follows the newly shown config's default", async () => {
    await mountLibrary()

    selects()[0].vm.$emit('update:modelValue', 1)
    await flushPromises()

    expect(parameterSelect().props('modelValue')).toBe('enterocyte')
    expect(await drag()).toMatchObject({ moduleRef: 'compartment:enterocyte', parameterisation: 'enterocyte' })
  })

  it('drags the set chosen instead', async () => {
    await mountLibrary()

    parameterSelect().vm.$emit('update:modelValue', 'enterocyte')
    await flushPromises()

    expect(await drag()).toMatchObject({ moduleRef: 'compartment:lumen', parameterisation: 'enterocyte' })
  })

  it('hides the picker for a math with no sets, dragging no None so no set is made', async () => {
    await mountLibrary({ sets: [] })

    expect(parameterSelect()).toBeUndefined()
    const dragged = await drag()
    expect(dragged.parameterisation).toBeUndefined()
    expect(seedRefFor(dragged, dragged.parameterisation)).toBe('lumen')
  })

  it("previews the chosen set's values", async () => {
    await mountLibrary()

    await wrapper.find('.mlc__preview-btn:not(.mlc__remove-btn)').trigger('click')

    expect(wrapper.findComponent(ModulePreviewDialog).props('moduleData').parameters).toEqual({
      ref: 'lumen',
      file: 'lumen_parameters.json',
      rows: [
        { name: 'F', value: '96485', units: 'C_per_mol', kind: 'global' },
        { name: 'C', value: '140', units: 'mM', kind: 'value' },
      ],
    })
  })
})

describe('LibraryArea None option', () => {
  it('drags None, which seeds nothing, once chosen over the default', async () => {
    await mountLibrary()
    parameterSelect().vm.$emit('update:modelValue', NO_PARAMETER_SET)
    await flushPromises()

    const dragged = await drag()
    expect(parameterSelect().props('modelValue')).toBe(NO_PARAMETER_SET)
    expect(dragged.parameterisation).toBe(NO_PARAMETER_SET)
    expect(seedRefFor(dragged, dragged.parameterisation)).toBeNull()
  })

  it("shows None when the config's default set is not loaded", async () => {
    await mountLibrary({ sets: ['enterocyte'], mathOnlyFirst: true })
    selects()[0].vm.$emit('update:modelValue', 1)
    await flushPromises()

    expect(parameterSelect().props('modelValue')).toBe(NO_PARAMETER_SET)
    expect(parameterSelect().props('options')[0]).toEqual({ label: 'None', value: NO_PARAMETER_SET })
  })

  it('lists a set an instance dropped with None made, beside the imported ones', async () => {
    await mountLibrary()
    const rows = [{ name: 'C', type: 'constant', value: '9', units: 'mM' }]
    useDefaultParametersStore().addInstanceSet(MATH_REF, 'n1', 'compartment', rows)
    await flushPromises()

    expect(parameterSelect().props('options').map((option) => option.value)).toEqual([
      NO_PARAMETER_SET,
      'lumen',
      'enterocyte',
      'compartment',
    ])
    parameterSelect().vm.$emit('update:modelValue', 'compartment')
    await flushPromises()
    expect((await drag()).parameterisation).toBe('compartment')
  })

  it('previews no set for None', async () => {
    await mountLibrary()
    parameterSelect().vm.$emit('update:modelValue', NO_PARAMETER_SET)
    await flushPromises()
    await wrapper.find('.mlc__preview-btn:not(.mlc__remove-btn)').trigger('click')

    expect(wrapper.findComponent(ModulePreviewDialog).props('moduleData').parameters).toBeNull()
  })
})

describe('LibraryArea config preselection', () => {
  it('shows the first config whose default set is loaded, ahead of a math-only one', async () => {
    await mountLibrary({ mathOnlyFirst: true, sets: ['enterocyte', 'lumen'] })

    expect(selects()[0].props('modelValue')).toBe(1)
    expect(parameterSelect().props('modelValue')).toBe('lumen')
    expect(await drag()).toMatchObject({ moduleRef: 'compartment:lumen', parameterisation: 'lumen' })
  })

  it('skips configs whose default set is not loaded', async () => {
    await mountLibrary({ mathOnlyFirst: true, sets: ['enterocyte'] })

    expect(await drag()).toMatchObject({ moduleRef: 'compartment:enterocyte', parameterisation: 'enterocyte' })
  })

  it('keeps the first config when no default set is loaded', async () => {
    await mountLibrary({ mathOnlyFirst: true, sets: [] })

    expect(selects()[0].props('modelValue')).toBe(0)
    expect((await drag()).moduleRef).toBe('compartment:default')
  })

  it('moves to a config once its default set loads, but never off one the user chose', async () => {
    await mountLibrary({ mathOnlyFirst: true, sets: [] })
    useDefaultParametersStore().addSet(paramSet('enterocyte', [['C', param('15')]]), { mathRef: MATH_REF })
    await flushPromises()

    expect((await drag()).moduleRef).toBe('compartment:enterocyte')

    selects()[0].vm.$emit('update:modelValue', 0)
    await flushPromises()
    useDefaultParametersStore().addSet(paramSet('lumen', [['C', param('140')]]), { mathRef: MATH_REF })
    await flushPromises()

    expect((await drag()).moduleRef).toBe('compartment:default')
  })
})
