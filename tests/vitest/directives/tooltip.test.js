// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAppSettings } from '../../../src/composables/useAppSettings'
import { HINT_SHOW_DELAY, TOOLTIP_SHOW_DELAY, vHint, vTooltip, withShowDelay } from '../../../src/directives/tooltip'

const { saveAppSettings } = useAppSettings()

describe('withShowDelay', () => {
  it('turns plain text into options with the delay', () => {
    expect(withShowDelay('Save workspace', 600)).toEqual({ value: 'Save workspace', showDelay: 600 })
  })

  it('adds the delay to options, keeping theirs', () => {
    expect(withShowDelay({ value: 'Undo', class: 'x' }, 600)).toEqual({ value: 'Undo', class: 'x', showDelay: 600 })
  })

  it('leaves a delay the options set', () => {
    expect(withShowDelay({ value: 'Undo', showDelay: 0 }, 600)).toEqual({ value: 'Undo', showDelay: 0 })
  })

  it('leaves an empty value empty, so nothing shows', () => {
    expect(withShowDelay(null, 600)).toBe(null)
    expect(withShowDelay('', 600)).toBe('')
  })
})

describe.each([
  ['vTooltip', vTooltip, TOOLTIP_SHOW_DELAY],
  ['vHint', vHint, HINT_SHOW_DELAY],
])('%s', (_name, directive, delay) => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it(`shows its text only once the pointer has rested on the element for ${delay} ms`, async () => {
    const wrapper = mount(
      { template: '<button v-tip.top="\'Save workspace\'">Save</button>', directives: { tip: directive } },
      { global: { plugins: [PrimeVue] }, attachTo: document.body },
    )
    await wrapper.trigger('mouseenter')
    vi.advanceTimersByTime(delay - 1)
    expect(document.body.querySelector('.p-tooltip')).toBeNull()
    vi.advanceTimersByTime(1)
    expect(document.body.querySelector('.p-tooltip')?.textContent).toContain('Save workspace')
    wrapper.unmount()
  })
})

describe('the Show button hints setting', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    saveAppSettings({ showHints: true })
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  /** Rests the pointer on a control with both a hint and, beside it, a tooltip, and reports which showed. */
  async function shown() {
    const wrapper = mount(
      {
        template: '<div><button v-hint="\'Save workspace\'">Save</button><span v-tooltip="\'Library not ready\'">!</span></div>',
        directives: { hint: vHint, tooltip: vTooltip },
      },
      { global: { plugins: [PrimeVue] }, attachTo: document.body },
    )
    return async () => {
      await wrapper.find('button').trigger('mouseenter')
      await wrapper.find('span').trigger('mouseenter')
      vi.advanceTimersByTime(HINT_SHOW_DELAY)
      const texts = [...document.body.querySelectorAll('.p-tooltip')].map((tip) => tip.textContent)
      wrapper.find('button').trigger('mouseleave')
      wrapper.find('span').trigger('mouseleave')
      vi.advanceTimersByTime(1)
      return texts
    }
  }

  it('hides hints but not tooltips while off, including on controls already on screen', async () => {
    const hover = await shown()
    saveAppSettings({ showHints: false })
    const texts = await hover()
    expect(texts.join()).not.toContain('Save workspace')
    expect(texts.join()).toContain('Library not ready')
  })

  it('shows hints again once turned back on', async () => {
    saveAppSettings({ showHints: false })
    const hover = await shown()
    saveAppSettings({ showHints: true })
    expect((await hover()).join()).toContain('Save workspace')
  })
})
