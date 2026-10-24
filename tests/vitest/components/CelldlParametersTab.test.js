// The CellDL Parameters tab, on the enzyme diagram as the CellDL editor lists it and bg2cellml converts it.
import fs from 'node:fs'
import path from 'node:path'

import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, shallowRef } from 'vue'

/** Stands in for the CellDL editor host, whose element commands the tests check. */
const host = vi.hoisted(() => ({}))
vi.mock('../../../src/composables/useCelldlEditorHost', () => ({ useCelldlEditorHost: () => host }))
vi.mock('../../../src/utils/notify', () => ({ notify: { error: vi.fn(), info: vi.fn() } }))

import CelldlParametersTab from '../../../src/components/celldl/CelldlParametersTab.vue'
import { buildElementTable } from '../../../src/services/celldl/elementTable.js'
import { notify } from '../../../src/utils/notify'

const read = (name) => JSON.parse(fs.readFileSync(path.resolve(__dirname, '../fixtures/celldl', name), 'utf8'))
const ELEMENTS = read('enzyme_canonical.elements.json')
const { manifest: MANIFEST, rows: ROWS, defaults: DEFAULTS } = read('enzyme_canonical.module.json')
const STORE_S = 'ID-00000001'
const JUNCTION_S = 'ID-00000002'

describe('CelldlParametersTab', () => {
  let wrapper

  beforeEach(() => {
    Object.assign(host, {
      selection: shallowRef({ id: null, isHostSelection: false }),
      setElement: vi.fn(async () => ({ ok: true })),
      selectElement: vi.fn(async () => ({ ok: true })),
      unitSystem: shallowRef('si'),
      setUnitSystem: vi.fn(async (id) => {
        host.unitSystem.value = id
        return { ok: true, unitSystem: id }
      }),
    })
    notify.error.mockClear()
    try {
      window.localStorage.clear()
    } catch {
      // no storage
    }
  })

  afterEach(() => wrapper?.unmount())

  function mountTab({ elements = ELEMENTS, rows = ROWS.map((row) => ({ ...row })), manifest = MANIFEST, ...props } = {}) {
    const table = buildElementTable({ elements, manifest, rows, savedDefaults: new Map(DEFAULTS) })
    wrapper = mount(CelldlParametersTab, {
      props: { table, savedDefaults: new Map(DEFAULTS), isDiagramShown: true, ...props },
      global: { plugins: [PrimeVue], directives: { tooltip: {} } },
      attachTo: document.body,
    })
    return wrapper
  }

  const mainRow = (id) => wrapper.find(`tr.element-row--main[data-element-id="${id}"]`)
  const valuesRow = (id) => wrapper.find(`tr.element-row--values[data-element-id="${id}"]`)
  const field = (id, label) => mainRow(id).find(`input[aria-label^="${label} of"]`)

  async function commit(input, value) {
    await input.trigger('focus')
    await input.setValue(value)
    await input.trigger('keydown', { key: 'Enter' })
    await input.trigger('blur')
  }

  it('shows each element under its section, with its junction under its store', () => {
    mountTab()
    const sections = wrapper.findAll('tbody').map((body) => body.attributes('data-section'))
    expect(sections).toEqual(['stores', 'reactions', 'junctions', 'constants'])
    const stores = wrapper.find('tbody[data-section="stores"]').findAll('tr.element-row--main')
    expect(stores.map((row) => row.attributes('data-element-id')).slice(0, 2)).toEqual([STORE_S, JUNCTION_S])
    expect(mainRow(JUNCTION_S).classes()).toContain('element-row--junction')
    expect(mainRow(STORE_S).find('.element-names').text()).toBe('q_S_c, K_q_S_c')
  })

  it("sends nothing as it renders, or for a value left as it was", async () => {
    mountTab()
    await nextTick()
    expect(host.setElement).not.toHaveBeenCalled()
    await commit(field(STORE_S, 'Species'), 'S')
    expect(host.setElement).not.toHaveBeenCalled()
  })

  it("renames a store's junction with it, in one edit, unless following is off", async () => {
    mountTab()
    await commit(field(STORE_S, 'Species'), 'Glc')
    expect(host.setElement).toHaveBeenCalledWith([
      { id: STORE_S, field: 'species', value: 'Glc' },
      { id: JUNCTION_S, field: 'species', value: 'Glc' },
    ])

    await wrapper.find('#celldl-follow-store').setValue(false)
    await commit(field(STORE_S, 'Location'), 'm')
    expect(host.setElement).toHaveBeenLastCalledWith([{ id: STORE_S, field: 'location', value: 'm' }])
  })

  it("refuses a name the diagram can't take, and says why an edit failed", async () => {
    mountTab()
    await commit(field(STORE_S, 'Species'), '2x')
    expect(host.setElement).not.toHaveBeenCalled()

    host.setElement.mockResolvedValueOnce({ ok: false, errors: [{ id: STORE_S, field: 'species', message: "Can't typeset" }] })
    await commit(field(STORE_S, 'Species'), 'Glc')
    await vi.waitFor(() => expect(notify.error).toHaveBeenCalledWith({ message: "Can't typeset" }))
  })

  it("changes an element's type in the diagram", async () => {
    mountTab()
    wrapper.vm.$.setupState.onTypeChange(
      ELEMENTS.find((element) => element.id === 'ID-00000006'),
      'https://bg-rdf.org/ontologies/bondgraph-framework#NKETransporter'
    )
    expect(host.setElement).toHaveBeenCalledWith([
      { id: 'ID-00000006', field: 'type', value: 'https://bg-rdf.org/ontologies/bondgraph-framework#NKETransporter' },
    ])
  })

  it("offers a store every domain's template but not its base kind, and names the kind until one is chosen", async () => {
    const BGF = 'https://bg-rdf.org/ontologies/bondgraph-framework#'
    const store = ELEMENTS.find((element) => element.id === STORE_S)
    const untyped = {
      ...store,
      kind: `${BGF}ZeroStorageNode`,
      kindName: 'Zero storage node',
      template: null,
      templateName: undefined,
      templates: [
        { type: `${BGF}ZeroStorageNode`, name: 'Zero storage node' },
        { type: `${BGF}ChemicalStorageNode`, name: 'Chemical storage with Zero Node', domain: `${BGF}Chemical` },
        { type: `${BGF}ElectricalCapacitiveNode`, name: 'Electrical storage with Zero Node', domain: `${BGF}Electrical` },
      ],
    }
    mountTab({ elements: ELEMENTS.map((element) => (element === store ? untyped : element)) })
    const select = mainRow(STORE_S).find('.type-select')
    expect(select.text()).toContain('Zero storage node')
    expect(select.classes()).toContain('p-invalid')
    await select.find('.p-select-label').trigger('click')
    await nextTick()
    const offered = [...document.body.querySelectorAll('.p-select-option')].map((option) => option.textContent.trim())
    expect(offered).toEqual(['Chemical storage with Zero Node', 'Electrical storage with Zero Node'])

    wrapper.vm.$.setupState.onTypeChange(untyped, `${BGF}ElectricalCapacitiveNode`)
    expect(host.setElement).toHaveBeenCalledWith([{ id: STORE_S, field: 'type', value: `${BGF}ElectricalCapacitiveNode` }])
  })

  it('shows the kind as text when it has no templates to choose from', () => {
    const store = ELEMENTS.find((element) => element.id === STORE_S)
    const bare = { ...store, template: undefined, templateName: undefined, templates: store.templates.slice(0, 1) }
    mountTab({ elements: ELEMENTS.map((element) => (element === store ? bare : element)) })
    expect(mainRow(STORE_S).find('.type-select').exists()).toBe(false)
    expect(mainRow(STORE_S).find('.cell-type').text()).toBe(store.kindName)
  })

  it("edits this instance's values only, showing the diagram's as greyed defaults", async () => {
    mountTab()
    const K = valuesRow(STORE_S).find('[data-variable="K_q_S_c"] input')
    expect(K.element.value).toBe('')
    expect(K.attributes('placeholder')).toBe('1')
    expect(valuesRow(STORE_S).find('[data-variable="K_q_S_c"] .default-hint').exists()).toBe(true)

    await commit(K, '5')
    expect(wrapper.emitted('set-value')).toEqual([[expect.objectContaining({ name: 'K_q_S_c' }), '5']])
    expect(host.setElement).not.toHaveBeenCalled()

    await commit(valuesRow(STORE_S).find('[data-variable="K_q_S_c"] input'), 'abc')
    expect(wrapper.emitted('set-value')).toHaveLength(1)
  })

  it("shows an instance's own value, without the default hint", () => {
    const rows = ROWS.map((row) => (row.name === 'K_q_S_c' ? { ...row, value: '5' } : { ...row }))
    mountTab({ rows })
    const cell = valuesRow(STORE_S).find('[data-variable="K_q_S_c"]')
    expect(cell.find('input').element.value).toBe('5')
    expect(cell.find('.default-hint').exists()).toBe(false)
  })

  it('flags unset and clashing rows, and shows only them on asking', async () => {
    const elements = ELEMENTS.map((element) => (element.id === 'ID-00000014' ? { ...element, location: 'j' } : element))
    mountTab({ elements, manifest: null })
    expect(mainRow('ID-00000014').classes()).toContain('element-row--unset')
    const chips = wrapper.findAll('.issue-chip')
    expect(chips.map((chip) => chip.text())).toEqual(['1 row to set'])
    await chips[0].trigger('click')
    expect(wrapper.findAll('tr.element-row--main').map((row) => row.attributes('data-element-id'))).toEqual(['ID-00000014'])
  })

  it('selects a clicked row in the diagram, and highlights the element selected there', async () => {
    mountTab()
    await mainRow(STORE_S).find('.element-kind').trigger('click')
    expect(host.selectElement).toHaveBeenCalledWith(STORE_S, 'if-hidden')

    host.selection.value = { id: 'ID-00000006', isHostSelection: false }
    await nextTick()
    expect(mainRow('ID-00000006').classes()).toContain('element-row--selected')
  })

  it("leaves the diagram's structure alone while the diagram isn't shown", async () => {
    mountTab({ isDiagramShown: false })
    expect(field(STORE_S, 'Species').attributes('disabled')).toBeDefined()
    await mainRow(STORE_S).find('.element-kind').trigger('click')
    expect(host.selectElement).not.toHaveBeenCalled()
    await mainRow(STORE_S).find('button[aria-label="Show in diagram"]').trigger('click')
    expect(wrapper.emitted('show-in-diagram')).toEqual([[STORE_S]])
  })

  describe('unit system', () => {
    const unitSystem = () => wrapper.find('.unit-system')
    const choose = async (id) => {
      await wrapper.vm.$.setupState.onUnitSystemChange(id)
      await nextTick()
    }

    it("shows the diagram's unit system, and sets another as a diagram edit", async () => {
      mountTab()
      expect(unitSystem().text()).toContain('SI (mol, L)')
      await unitSystem().find('.p-select-label').trigger('click')
      await nextTick()
      const offered = [...document.body.querySelectorAll('.p-select-option')].map((option) => option.textContent.trim())
      expect(offered).toEqual(['Cellular (fmol, pL)', 'SI (mol, L)'])
      await choose('cellular')
      expect(host.setUnitSystem).toHaveBeenCalledWith('cellular')
      expect(unitSystem().text()).toContain('Cellular (fmol, pL)')
      // Choosing the system it has already sends nothing.
      await choose('cellular')
      expect(host.setUnitSystem).toHaveBeenCalledTimes(1)
    })

    it('says why the unit system was not set', async () => {
      host.setUnitSystem.mockResolvedValueOnce({ ok: false, unitSystem: 'si', error: "Unknown unit system 'x'" })
      mountTab()
      await choose('cellular')
      expect(notify.error).toHaveBeenCalledWith({ message: "Unknown unit system 'x'" })
    })

    it("can't be changed while the diagram isn't shown", async () => {
      mountTab({ isDiagramShown: false })
      expect(unitSystem().find('.p-select').classes()).toContain('p-disabled')
      await choose('cellular')
      expect(host.setUnitSystem).not.toHaveBeenCalled()
    })
  })
})
