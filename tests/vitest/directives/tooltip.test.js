// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HINT_SHOW_DELAY, TOOLTIP_SHOW_DELAY, vHint, vTooltip, withShowDelay } from '../../../src/directives/tooltip'

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
