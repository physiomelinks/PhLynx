// @vitest-environment happy-dom
import { reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import Select from 'primevue/select'
import PrimeVue from 'primevue/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const confirm = vi.fn()
vi.mock('../../../src/composables/useConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm }) }))

const { default: ParameterTable } = await import('../../../src/components/ParameterTable.vue')

let wrapper
afterEach(() => wrapper?.unmount())

const NEW_INITIALISER_VALUE = '__new_initialiser__'

/** Mounts the table with state `x` initialised from `k`, and `x_init` free to take over. */
function mountTable(mathReferences, { kValue = '1', extraRows = [] } = {}) {
  const rows = reactive([
    { name: 'x', units: 'metre', type: 'variable', stateRole: 'state', initialiser: 'k', access: 'access' },
    { name: 'k', units: 'metre', type: 'constant', value: kValue, access: 'access' },
    { name: 'x_init', units: 'metre', type: 'constant', value: '2', access: 'no_access' },
    ...extraRows,
  ])
  wrapper = mount(ParameterTable, {
    props: {
      rows,
      isMissingUnits: () => false,
      getUnitsNotice: () => '',
      issueFilter: { activeKeys: { value: [] }, toggle: () => {}, isShown: () => true },
      mathReferences,
    },
    global: { plugins: [PrimeVue] },
  })
  return rows
}

const names = (rows) => rows.map((row) => row.name)

describe('ParameterTable initialiser reassignment', () => {
  beforeEach(() => {
    confirm.mockReset()
    confirm.mockResolvedValue(true)
  })

  it('switches without asking when the equations still use the old initialiser', async () => {
    const rows = mountTable(new Set(['t', 'x', 'k']))
    await wrapper.vm.onInitialiserPick(rows[0], 'x_init')

    expect(rows[0].initialiser).toBe('x_init')
    expect(confirm).not.toHaveBeenCalled()
    expect(names(rows)).toContain('k')
  })

  it('switches without asking when another state still uses the old initialiser', async () => {
    const other = { name: 'y', units: 'metre', type: 'variable', stateRole: 'state', initialiser: 'k', access: 'access' }
    const rows = mountTable(new Set(['t', 'x', 'y']), { extraRows: [other] })
    await wrapper.vm.onInitialiserPick(rows[0], 'x_init')

    expect(confirm).not.toHaveBeenCalled()
    expect(names(rows)).toContain('k')
  })

  it('removes the old initialiser on Proceed, after saying so', async () => {
    const rows = mountTable(new Set(['t', 'x']))
    await wrapper.vm.onInitialiserPick(rows[0], 'x_init')

    expect(confirm).toHaveBeenCalledOnce()
    expect(confirm.mock.calls[0][0]).toMatchObject({ acceptLabel: 'Proceed', rejectLabel: 'Revert' })
    expect(confirm.mock.calls[0][0].message).toContain('removes "k" and its value (1)')
    expect(rows[0].initialiser).toBe('x_init')
    expect(names(rows)).not.toContain('k')
  })

  it('changes nothing on Revert, even after picking New', async () => {
    confirm.mockResolvedValue(false)
    const rows = mountTable(new Set(['t', 'x']))
    const before = names(rows)

    await wrapper.vm.onInitialiserPick(rows[0], 'x_init')
    await wrapper.vm.onInitialiserPick(rows[0], NEW_INITIALISER_VALUE)

    expect(confirm).toHaveBeenCalledTimes(2)
    expect(rows[0].initialiser).toBe('k')
    expect(names(rows)).toEqual(before)
  })

  it('shows the original initialiser again in the picker on Revert', async () => {
    confirm.mockResolvedValue(false)
    const rows = mountTable(new Set(['t', 'x']))
    await flushPromises() // the table re-renders its cells once after mounting
    // The only Select bound to the initialiser: the prop stays `k` while the shown value may drift.
    const statePicker = () => wrapper.findAllComponents(Select).find((select) => select.props('modelValue') === 'k')

    statePicker().vm.writeValue('x_init') // what choosing an option does
    await flushPromises()

    expect(confirm).toHaveBeenCalledOnce()
    expect(rows[0].initialiser).toBe('k')
    expect(statePicker().find('.p-select-label').text()).toBe('k')
  })

  it('removes a blank unused initialiser without asking', async () => {
    const rows = mountTable(new Set(['t', 'x']), { kValue: '' })
    await wrapper.vm.onInitialiserPick(rows[0], 'x_init')

    expect(confirm).not.toHaveBeenCalled()
    expect(rows[0].initialiser).toBe('x_init')
    expect(names(rows)).not.toContain('k')
  })
})

describe('ParameterTable initialiser picker', () => {
  it('offers a boundary condition as set by connection, and leaves out a time-varying row', async () => {
    const rows = reactive([
      { name: 'x', units: 'metre', type: 'variable', stateRole: 'state', initialiser: 'k', access: 'access' },
      { name: 'k', units: 'metre', type: 'constant', value: '1', access: 'access' },
      { name: 'b', units: 'metre', type: 'boundary_condition', value: '', access: 'access' },
      { name: 'a', units: 'metre', type: 'variable', access: 'access' },
    ])
    wrapper = mount(ParameterTable, {
      props: {
        rows,
        isMissingUnits: () => false,
        getUnitsNotice: () => '',
        issueFilter: { activeKeys: { value: [] }, toggle: () => {}, isShown: () => true },
        mathReferences: new Set(['x', 'b', 'a']),
        variableKinds: new Map([['x', 'state'], ['k', 'constant'], ['b', 'constant'], ['a', 'algebraic']]),
        connectionSupplied: new Set(['b']),
      },
      global: { plugins: [PrimeVue] },
    })
    await flushPromises()

    const labels = wrapper.vm.initialiserOptionsFor(rows[0]).map((option) => option.label)
    expect(labels).toContain('b (set by connection)')
    expect(labels).toContain('k')
    expect(labels.some((label) => label.startsWith('a'))).toBe(false)
  })
})

describe('ParameterTable units', () => {
  const SanitisedInput = { name: 'SanitisedInput' }

  /** Mounts the table in Simple Mode, so the Units cells are editable. */
  function mountUnits(rows) {
    wrapper = mount(ParameterTable, {
      props: {
        rows,
        isManaged: true,
        isMissingUnits: () => false,
        getUnitsNotice: () => '',
        issueFilter: { activeKeys: { value: [] }, toggle: () => {}, isShown: () => true },
        mathReferences: new Set(['x']),
      },
      global: { plugins: [PrimeVue] },
    })
  }

  /** The editable Units inputs, in row order. */
  const unitsInputs = () =>
    wrapper.findAllComponents(SanitisedInput).filter((input) => input.props('placeholder') === 'e.g. mV or mV/ms')

  it('keeps a state and its initialiser on the same units as each letter is typed', async () => {
    const rows = reactive([
      { name: 'x', units: '', type: 'variable', stateRole: 'state', initialiser: 'x_init', access: 'access' },
      { name: 'x_init', units: '', type: 'constant', value: '1', access: 'no_access' },
    ])
    mountUnits(rows)
    await flushPromises()

    const [stateInput] = unitsInputs()
    expect(unitsInputs()).toHaveLength(2)
    for (const typed of ['m', 'me', 'met', 'metr', 'metre']) {
      stateInput.vm.$emit('update:modelValue', typed)
      expect(rows.map((row) => row.units)).toEqual([typed, typed])
    }
  })

  it("updates a shared initialiser's states when its units are edited", async () => {
    const rows = reactive([
      { name: 'a', units: 'mM', type: 'variable', stateRole: 'state', initialiser: 'shared', access: 'access' },
      { name: 'b', units: 'mM', type: 'variable', stateRole: 'state', initialiser: 'shared', access: 'access' },
      { name: 'shared', units: 'mM', type: 'constant', value: '1', access: 'no_access' },
    ])
    mountUnits(rows)
    await flushPromises()

    unitsInputs().at(-1).vm.$emit('update:modelValue', 'uM')
    expect(rows.map((row) => row.units)).toEqual(['uM', 'uM', 'uM'])
  })
})
