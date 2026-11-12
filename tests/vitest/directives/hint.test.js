// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HINT_SHOW_DELAY, vHint, withHintDelay } from '../../../src/directives/hint'

describe('withHintDelay', () => {
  it('turns a plain label into options with the hint delay', () => {
    expect(withHintDelay('Save workspace')).toEqual({ value: 'Save workspace', showDelay: HINT_SHOW_DELAY })
  })

  it('adds the delay to options, keeping theirs', () => {
    expect(withHintDelay({ value: 'Undo', class: 'x' })).toEqual({ value: 'Undo', class: 'x', showDelay: HINT_SHOW_DELAY })
  })

  it('leaves a delay the options set', () => {
    expect(withHintDelay({ value: 'Undo', showDelay: 0 })).toEqual({ value: 'Undo', showDelay: 0 })
  })

  it('leaves an empty value empty, so no hint shows', () => {
    expect(withHintDelay(null)).toBe(null)
    expect(withHintDelay('')).toBe('')
  })
})

describe('vHint', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('shows its text only once the pointer has rested on the control', async () => {
    const wrapper = mount(
      { template: '<button v-hint.top="\'Save workspace\'">Save</button>', directives: { hint: vHint } },
      { global: { plugins: [PrimeVue] }, attachTo: document.body },
    )
    await wrapper.trigger('mouseenter')
    vi.advanceTimersByTime(HINT_SHOW_DELAY - 1)
    expect(document.body.textContent).not.toContain('Save workspace')
    vi.advanceTimersByTime(1)
    expect(document.body.querySelector('.p-tooltip')?.textContent).toContain('Save workspace')
    wrapper.unmount()
  })
})
