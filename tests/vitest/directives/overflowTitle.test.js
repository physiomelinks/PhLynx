// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { vOverflowTitle } from '../../../src/directives/overflowTitle'

/**
 * Mounts a span with the directive, its width as the layout would leave it.
 *
 * @param {{scrollWidth: number, clientWidth: number}} size
 * @returns {import('@vue/test-utils').VueWrapper}
 */
function mountSpan({ scrollWidth, clientWidth }) {
  const wrapper = mount({ template: '<span v-overflow-title="text">a/V</span>', directives: { OverflowTitle: vOverflowTitle }, data: () => ({ text: 'a/V' }) })
  Object.defineProperty(wrapper.element, 'scrollWidth', { value: scrollWidth })
  Object.defineProperty(wrapper.element, 'clientWidth', { value: clientWidth })
  return wrapper
}

describe('vOverflowTitle', () => {
  it('titles an element whose text is clipped', async () => {
    const wrapper = mountSpan({ scrollWidth: 120, clientWidth: 80 })
    await wrapper.trigger('mouseenter')
    expect(wrapper.attributes('title')).toBe('a/V')
  })

  it('leaves a whole element without a title', async () => {
    const wrapper = mountSpan({ scrollWidth: 80, clientWidth: 80 })
    await wrapper.trigger('mouseenter')
    expect(wrapper.attributes('title')).toBeUndefined()
  })
})
