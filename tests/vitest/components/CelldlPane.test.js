import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { computed, nextTick, ref, shallowRef } from 'vue'
import PrimeVue from 'primevue/config'
import Tooltip from 'primevue/tooltip'

/** Stands in for the live conversion, which the tests set the state of. */
const live = vi.hoisted(() => ({}))
vi.mock('../../../src/composables/useLiveCelldlConvert.js', () => ({ useLiveCelldlConvert: () => live }))

import CelldlPane from '../../../src/components/celldl/CelldlPane.vue'
import { useCelldlEditorHost } from '../../../src/composables/useCelldlEditorHost.js'
import { useAppSettings } from '../../../src/composables/useAppSettings.js'

const ROWS = [{ name: 'v_1' }, { name: 'q_C' }]

function resetLive() {
  const latest = shallowRef(null)
  const result = computed(() => latest.value?.result ?? null)
  Object.assign(live, {
    isAvailable: true,
    error: ref(''),
    isPending: ref(false),
    isChecking: ref(false),
    latest,
    result,
    issues: computed(() => (result.value ? [...result.value.errors, ...result.value.warnings] : [])),
    start: vi.fn(async () => {}),
    setModule: vi.fn(),
  })
}

const converted = (pass, { errors = [], warnings = [], runnable, cellml = '<model name="rc"/>', elements = {} } = {}) => ({
  pass,
  result: { cellml, errors, warnings, runnable, elements },
})

describe('CelldlPane', () => {
  let wrapper

  beforeEach(resetLive)

  afterEach(() => {
    wrapper?.unmount()
  })

  const mountPane = (props = {}) => {
    wrapper = mount(CelldlPane, { props: { rows: ROWS, ...props }, global: { plugins: [PrimeVue], directives: { tooltip: Tooltip } } })
    return useCelldlEditorHost()
  }

  it("emits a selected element's primary variable", () => {
    const host = mountPane()
    host.onViewerEvent({ type: 'select', component: { id: 'J', info: { primary: 'v_1', variables: ['v_1'] } } })
    expect(wrapper.emitted('variable-click')).toEqual([['v_1']])
  })

  it('falls back to the first of its variables the instance has', () => {
    const host = mountPane()
    host.onViewerEvent({ type: 'select', component: { id: 'C', info: { primary: 'C', variables: ['C', 'q_C'] } } })
    expect(wrapper.emitted('variable-click')).toEqual([['q_C']])
  })

  it("emits an element's own variable, as unsaved, for an element added since the save", () => {
    const host = mountPane()
    const info = { primary: 'q_X', variables: ['C_X', 'q_X'] }
    host.onViewerEvent({ type: 'select', component: { id: 'X', info } })
    expect(wrapper.emitted('variable-click')).toEqual([['q_X', { isUnsaved: true }]])
  })

  it('emits nothing for an element with no info, or for other events', () => {
    const host = mountPane()
    host.onViewerEvent({ type: 'select', component: { id: 'new' } })
    host.onViewerEvent({ type: 'active', component: { id: 'J', info: { primary: 'v_1', variables: ['v_1'] } } })
    host.onViewerEvent({ type: 'unselect' })
    expect(wrapper.emitted('variable-click')).toBeUndefined()
  })

  it('switches location shading in the status bar, as an app setting', async () => {
    const { settings, saveAppSettings } = useAppSettings()
    saveAppSettings({ celldlLocationShading: true })
    mountPane()
    const toggle = wrapper.get('.celldl-shading-toggle input')
    expect(toggle.element.checked).toBe(true)
    await toggle.setValue(false)
    expect(settings.celldlLocationShading).toBe(false)
    saveAppSettings({ celldlLocationShading: true })
    await nextTick()
    expect(toggle.element.checked).toBe(true)
  })

  it('stops hearing the editor once unmounted', () => {
    const host = mountPane()
    wrapper.unmount()
    host.onViewerEvent({ type: 'select', component: { id: 'J', info: { primary: 'v_1' } } })
    expect(wrapper.emitted('variable-click')).toBeUndefined()
    wrapper = null
  })
})

describe('CelldlPane live conversion', () => {
  let wrapper

  beforeEach(resetLive)

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  const mountPane = (props = {}) => {
    wrapper = mount(CelldlPane, { props: { rows: ROWS, ...props }, global: { plugins: [PrimeVue], directives: { tooltip: Tooltip } } })
  }
  const status = () => wrapper.find('.celldl-live-status')

  it('starts converting, for the module the dialog edits', async () => {
    mountPane({ componentName: 'rc', mathRef: 'rc.cellml:rc' })
    expect(live.start).toHaveBeenCalled()
    expect(live.setModule).toHaveBeenLastCalledWith({ componentName: 'rc', mathRef: 'rc.cellml:rc' })
    await wrapper.setProps({ componentName: 'rc_2' })
    expect(live.setModule).toHaveBeenLastCalledWith({ componentName: 'rc_2', mathRef: 'rc.cellml:rc' })
  })

  it('says it is converting until the latest diagram has a result', async () => {
    mountPane()
    expect(status().text()).toBe('Converting…')
    live.latest.value = converted('cheap')
    await nextTick()
    expect(status().text()).toBe('Converts')
    live.isPending.value = true
    await nextTick()
    expect(status().text()).toBe('Converting…')
  })

  it('says whether the checked model runs', async () => {
    mountPane()
    live.latest.value = converted('full', { runnable: true })
    await nextTick()
    expect(status().text()).toBe('Converts and runs')
    expect(status().attributes('title')).toBe('Checked with libCellML')
  })

  it('says a diagram with unsaved edits is not yet saved, since runs use the saved module', async () => {
    mountPane()
    useCelldlEditorHost().isDirty.value = true
    live.latest.value = converted('full', { runnable: true })
    await nextTick()
    expect(status().text()).toBe('Converts, not yet saved')
    expect(status().attributes('title')).toBe('Checked with libCellML: it runs once saved')
    useCelldlEditorHost().isDirty.value = false
    await nextTick()
    expect(status().text()).toBe('Converts and runs')
  })

  it('counts issues quietly, as save checks again', async () => {
    mountPane()
    live.latest.value = converted('full', {
      errors: [{ message: 'a' }, { message: 'b' }],
      warnings: [{ message: 'c' }],
    })
    await nextTick()
    expect(status().text()).toBe('3 issues, checked again on save')
    expect(wrapper.find('.celldl-live').attributes('data-state')).toBe('errors')
    live.latest.value = converted('cheap', { warnings: [{ message: 'c' }] })
    await nextTick()
    expect(status().text()).toBe('Converts, with 1 warning')
  })

  it('says when live conversion is off', async () => {
    live.error.value = 'no wasm'
    mountPane()
    expect(status().text()).toBe('Live conversion is unavailable')
    expect(status().attributes('title')).toBe('no wasm')
  })

  it('shows no CellML, which the math editors show', async () => {
    mountPane()
    live.latest.value = converted('cheap', { errors: [{ message: 'no template', elementId: 'X' }] })
    await nextTick()
    expect(wrapper.text()).not.toContain('Live CellML')
    expect(wrapper.text()).not.toContain('<model')
  })

  it('shows nothing of it for a diagram that failed to open', async () => {
    mountPane()
    const host = useCelldlEditorHost()
    host.error.value = 'Cannot open'
    await nextTick()
    expect(wrapper.find('.celldl-live').exists()).toBe(false)
    host.error.value = ''
  })

  it('shows nothing of it where the build has no worker', () => {
    live.isAvailable = false
    mountPane()
    expect(wrapper.find('.celldl-live').exists()).toBe(false)
    expect(live.start).toHaveBeenCalled()
  })
})

describe('CelldlPane issue list', () => {
  let wrapper
  let host

  beforeEach(() => {
    resetLive()
    host = useCelldlEditorHost()
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  const ISSUES = {
    warnings: [{ message: 'unused', elementId: 'ID-2' }],
    errors: [{ message: 'no template', elementId: 'ID-1' }, ...Array.from({ length: 6 }, (_, index) => ({ message: `e${index}` }))],
    elements: { 'ID-1': { symbol: 'q_A' } },
  }

  async function openList(issues = ISSUES) {
    wrapper = mount(CelldlPane, { props: { rows: ROWS }, global: { plugins: [PrimeVue], directives: { tooltip: Tooltip } }, attachTo: document.body })
    live.latest.value = converted('cheap', issues)
    await nextTick()
    await wrapper.find('.celldl-live-issues').trigger('click')
    await flushPromises()
    return [...document.body.querySelectorAll('.celldl-issue-list li')]
  }

  it('opens from the issue count, listing every issue, errors first, by the element each names', async () => {
    const items = await openList()
    expect(wrapper.find('.celldl-live-issues').text()).toBe('8 issues, checked again on save')
    expect(wrapper.find('.celldl-live-issues').attributes('aria-expanded')).toBe('true')
    expect(items).toHaveLength(8)
    expect(items[0].dataset.severity).toBe('error')
    expect(items[0].querySelector('.celldl-issue-element').textContent.trim()).toBe('q_A')
    // The first link takes focus as the list opens.
    expect(items[0].querySelector('.celldl-issue-element').hasAttribute('autofocus')).toBe(true)
    // Issues naming no element are plain text.
    expect(items[1].querySelector('button')).toBeNull()
    expect(items.at(-1).dataset.severity).toBe('warning')
    // Labelled from the diagram's ids, when the conversion has no manifest entry.
    expect(items.at(-1).querySelector('.celldl-issue-element').textContent.trim()).toBe('ID-2')
  })

  it('closes the list once no issues are left', async () => {
    await openList()
    live.latest.value = converted('cheap')
    await nextTick()
    await flushPromises()
    expect(wrapper.find('.celldl-live-issues').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'Popover' }).vm.visible).toBe(false)
  })

  it('shows no list for a diagram that converts cleanly', async () => {
    wrapper = mount(CelldlPane, { props: { rows: ROWS }, global: { plugins: [PrimeVue], directives: { tooltip: Tooltip } } })
    live.latest.value = converted('cheap')
    await nextTick()
    expect(wrapper.find('.celldl-live-issues').exists()).toBe(false)
  })

  it("reveals an issue's element when clicked", async () => {
    const reveal = vi.spyOn(host, 'revealElement').mockResolvedValue({ ok: true })
    const items = await openList()
    items[0].querySelector('.celldl-issue-element').click()
    await flushPromises()
    expect(reveal).toHaveBeenCalledWith('ID-1')
    expect(document.body.querySelector('.celldl-issue-missing')).toBeNull()
  })

  it('notes quietly an element deleted since the conversion', async () => {
    vi.spyOn(host, 'revealElement').mockResolvedValue({ ok: false })
    const items = await openList()
    items[0].querySelector('.celldl-issue-element').click()
    await flushPromises()
    expect(items[0].querySelector('.celldl-issue-missing').textContent).toBe('No longer in the diagram')
  })
})

describe('CelldlPane Reorganise', () => {
  const MODES = [
    { id: 'balanced', label: 'Balanced', description: 'A balance of everything' },
    { id: 'compact', label: 'Short bonds', description: 'Keeps bonds short' },
  ]
  let wrapper
  let host

  beforeEach(() => {
    resetLive()
    window.localStorage.removeItem('phlynx.celldl.reorganiseMode')
    host = useCelldlEditorHost()
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    host.onReorganiseState({})
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  const mountPane = () => {
    wrapper = mount(CelldlPane, { props: { rows: ROWS }, global: { plugins: [PrimeVue], directives: { tooltip: Tooltip } } })
  }
  const select = () => wrapper.findComponent({ name: 'Select' })
  const button = () => wrapper.get('.celldl-reorganise-button')

  it('shows nothing of it until the editor lists its modes, then sits before the Shading switch', async () => {
    mountPane()
    expect(wrapper.find('.celldl-reorganise').exists()).toBe(false)
    host.onReorganiseState({ modes: MODES, enabled: true, busy: false })
    await nextTick()
    const actions = wrapper.get('.celldl-live-actions')
    expect(actions.element.firstElementChild.classList.contains('celldl-reorganise')).toBe(true)
    expect(actions.element.lastElementChild.classList.contains('celldl-shading-toggle')).toBe(true)
    expect(select().props('options')).toEqual(MODES)
    expect(select().props('modelValue')).toBe('balanced')
  })

  it('reorganises in the mode chosen, remembering it for this viewer, and says what changed', async () => {
    const reorganise = vi.spyOn(host, 'reorganise').mockResolvedValue({ ok: true, improved: true, status: 'Complexity 35 → 20' })
    host.onReorganiseState({ modes: MODES, enabled: true, busy: false })
    mountPane()
    await nextTick()
    select().vm.$emit('update:modelValue', 'compact')
    await nextTick()
    expect(window.localStorage.getItem('phlynx.celldl.reorganiseMode')).toBe('compact')
    await button().trigger('click')
    await flushPromises()
    expect(reorganise).toHaveBeenCalledWith('compact')
    expect(wrapper.get('.celldl-reorganise-note').text()).toBe('Complexity 35 → 20')

    // A pane opened later starts at the mode last chosen.
    wrapper.unmount()
    mountPane()
    await nextTick()
    expect(select().props('modelValue')).toBe('compact')
  })

  it('falls back to the first mode for a remembered one the editor no longer has', async () => {
    window.localStorage.setItem('phlynx.celldl.reorganiseMode', 'gone')
    host.onReorganiseState({ modes: MODES, enabled: true, busy: false })
    mountPane()
    await nextTick()
    expect(select().props('modelValue')).toBe('balanced')
  })

  it("is disabled while the editor can't reorganise, and while one runs", async () => {
    let finish
    vi.spyOn(host, 'reorganise').mockReturnValue(new Promise((resolve) => (finish = resolve)))
    host.onReorganiseState({ modes: MODES, enabled: false, busy: false })
    mountPane()
    await nextTick()
    expect(button().attributes('disabled')).toBeDefined()
    expect(select().props('disabled')).toBe(true)

    host.onReorganiseState({ modes: MODES, enabled: true, busy: false })
    await nextTick()
    expect(button().attributes('disabled')).toBeUndefined()
    await button().trigger('click')
    expect(button().attributes('disabled')).toBeDefined()
    expect(button().text()).toBe('Reorganising…')
    finish({ ok: false, error: 'A reorganise is already running' })
    await flushPromises()
    expect(button().attributes('disabled')).toBeUndefined()
    expect(wrapper.get('.celldl-reorganise-note').text()).toBe('A reorganise is already running')

    host.onReorganiseState({ modes: MODES, enabled: false, busy: true })
    await nextTick()
    expect(button().attributes('disabled')).toBeDefined()
  })

  it('still works where the browser keeps nothing', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    host.onReorganiseState({ modes: MODES, enabled: true, busy: false })
    mountPane()
    await nextTick()
    select().vm.$emit('update:modelValue', 'compact')
    await nextTick()
    expect(select().props('modelValue')).toBe('compact')
  })

  it('engages the editor across the whole pane, so Undo follows the Reorganise button', () => {
    const claim = vi.spyOn(host, 'claim')
    mountPane()
    expect(claim).toHaveBeenCalledWith(expect.any(HTMLElement), expect.any(Function), wrapper.element)
  })
})
