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
function mountTable(mathReferences, { kValue = '1', extraRows = [], ignoredNotices = new Map() } = {}) {
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
      ignoredNotices,
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

describe('ParameterTable values ignored on export', () => {
  it('strikes through a value a connection supplies, saying why', async () => {
    const notice = 'Set by a connection: this value is ignored on export'
    mountTable(new Set(['t', 'x', 'k']), { ignoredNotices: new Map([['x_init', notice]]) })
    await flushPromises()

    const ignoredRows = wrapper.findAll('tr.parameter-row--ignored')
    expect(ignoredRows).toHaveLength(1)
    const input = ignoredRows[0].find('input.value-input--ignored')
    expect(input.element.value).toBe('2')
    expect(input.attributes('title')).toBe(notice)
    expect(wrapper.findAll('input.value-input--ignored')).toHaveLength(1)
  })
})

describe('ParameterTable connection status', () => {
  const bc = (name, value = '') => ({ name, units: 'metre', type: 'boundary_condition', value, access: 'access' })

  /** Mounts the table with extra rows and connection statuses, and returns a finder for each row's table row. */
  async function mountStatus(extraRows, statuses) {
    mountTable(new Set(['t', 'x', 'k']), { extraRows })
    await wrapper.setProps({ connectionStatus: new Map(statuses) })
    await flushPromises()
    return (name) => wrapper.findAll('tr').find((tr) => tr.find('.cell-static-text').exists() && tr.find('.cell-static-text').text() === name)
  }

  it('shows where a connected boundary condition takes its value from', async () => {
    const rowFor = await mountStatus([bc('V')], [['V', { state: 'connected', from: ['axon_SN.V'] }]])
    const tr = rowFor('V')
    expect(tr.find('input.p-inputtext').attributes('placeholder')).toBe('from axon_SN.V')
    expect(tr.find('input.p-inputtext').attributes('title')).toBe('Set by axon_SN.V')
    expect(tr.find('.connection-flag').attributes('title')).toBe('From axon_SN.V')
    expect(tr.classes()).not.toContain('parameter-row--unresolved')
  })

  it('flags a blank boundary condition nothing is connected to', async () => {
    const rowFor = await mountStatus([bc('V')], [['V', { state: 'missing', from: [] }]])
    const tr = rowFor('V')
    expect(tr.find('input.p-inputtext').attributes('placeholder')).toBe('Not connected: value required')
    expect(tr.classes()).toContain('parameter-row--unresolved')
    expect(tr.find('.connection-flag').exists()).toBe(false)
  })

  it('says a boundary condition nothing is connected to uses its own value', async () => {
    const rowFor = await mountStatus([bc('V', '-60')], [['V', { state: 'own', from: [] }]])
    const tr = rowFor('V')
    expect(tr.find('input.p-inputtext').attributes('title')).toBe('Not connected: this value is used')
    expect(tr.find('.connection-flag').exists()).toBe(false)
    expect(tr.classes()).not.toContain('parameter-row--unresolved')
  })

  it('links a computed or state row shared with other instances', async () => {
    const computed = { name: 'I', units: 'metre', type: 'variable', access: 'access' }
    const rowFor = await mountStatus([computed], [
      ['I', { state: 'shares', from: ['b.I', 'c.I'] }],
      ['x', { state: 'shares', from: ['b.x'] }],
    ])
    expect(rowFor('I').find('.connection-flag.pi-link').attributes('title')).toBe('Shared with b.I, c.I')
    expect(rowFor('x').find('.connection-flag.pi-link').attributes('title')).toBe('Shared with b.x')
  })

  it('warns about boundary conditions coupled only to each other, or given different values', async () => {
    const rowFor = await mountStatus([bc('T'), bc('P', '1')], [
      ['T', { state: 'bcOnly', from: ['b.T'] }],
      ['P', { state: 'conflict', from: ['b.P'] }],
    ])
    expect(rowFor('T').find('.connection-flag.pi-exclamation-triangle').attributes('title')).toContain(
      'Coupled only to other boundary conditions (b.T)'
    )
    expect(rowFor('P').find('.connection-flag.pi-exclamation-triangle').attributes('title')).toBe('Given a different value by b.P')
  })

  it('warns about a variable set more than once', async () => {
    const computed = { name: 'V', units: 'metre', type: 'variable', access: 'access' }
    const rowFor = await mountStatus([computed], [['V', { state: 'overdetermined', from: ['axon.V'] }]])
    expect(rowFor('V').find('.connection-flag.pi-exclamation-triangle').attributes('title')).toBe(
      'Also set by axon.V: only one module can set a connected variable'
    )
  })

  it('labels initialiser options by their connection status', async () => {
    const rows = mountTable(new Set(['t', 'x', 'k']), { extraRows: [bc('b'), bc('c'), bc('d', '1')] })
    await wrapper.setProps({
      variableKinds: new Map([['x', 'state'], ['k', 'constant'], ['b', 'constant'], ['c', 'constant'], ['d', 'constant']]),
      connectionSupplied: new Set(['b', 'c', 'd']),
      connectionStatus: new Map([
        ['b', { state: 'connected', from: ['axon_SN.V'] }],
        ['c', { state: 'missing', from: [] }],
        ['d', { state: 'own', from: [] }],
      ]),
    })
    const labels = wrapper.vm.initialiserOptionsFor(rows[0]).map((option) => option.label)
    expect(labels).toEqual(expect.arrayContaining(['b (from axon_SN.V)', 'c (not connected)', 'd']))
  })
})
