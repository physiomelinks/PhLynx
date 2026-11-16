// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import BioPieceName from '../../../../src/components/bio/BioPieceName.vue'

let wrapper
let rename
const name = () => wrapper.find('[data-testid="bio-piece-name"]')
const field = () => wrapper.find('[data-testid="bio-piece-name-input"]')

beforeEach(() => {
  vi.useFakeTimers()
  rename = vi.fn()
  wrapper = mount(BioPieceName, { props: { id: 'tpl:t1/lumen', name: 'Compartment' }, global: { provide: { bioRenamePiece: rename } }, attachTo: document.body })
})
afterEach(() => {
  wrapper.unmount()
  vi.useRealTimers()
})

describe('a piece’s name in the physiology view', () => {
  it('becomes a field holding it a moment after a click, and names the piece on Enter', async () => {
    await name().trigger('click', { detail: 1 })
    expect(field().exists()).toBe(false)
    await vi.advanceTimersByTimeAsync(250)
    expect(field().element.value).toBe('Compartment')
    await field().setValue(' Lumen ')
    await field().trigger('keydown', { key: 'Enter' })
    expect(rename).toHaveBeenCalledWith('tpl:t1/lumen', 'Lumen')
    expect(name().exists()).toBe(true)
  })

  it('leaves a double-click to the view, and the name as it was on Escape or unchanged', async () => {
    await name().trigger('click', { detail: 1 })
    await name().trigger('dblclick')
    await vi.advanceTimersByTimeAsync(300)
    expect(field().exists()).toBe(false)

    await name().trigger('keydown', { key: 'Enter' })
    await field().setValue('Other')
    await field().trigger('keydown', { key: 'Escape' })
    await name().trigger('keydown', { key: 'Enter' })
    await field().trigger('blur')
    expect(rename).not.toHaveBeenCalled()
  })
})
