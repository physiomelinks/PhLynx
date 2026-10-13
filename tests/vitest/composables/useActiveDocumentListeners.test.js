// @vitest-environment happy-dom
import { KeepAlive, defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { useActiveDocumentListeners } from '../../../src/composables/useActiveDocumentListeners.js'

const onKeyDown = vi.fn()
const Listening = defineComponent({
  name: 'Listening',
  setup() {
    useActiveDocumentListeners({ keydown: onKeyDown })
    return () => h('div')
  },
})
const Other = defineComponent({ name: 'Other', render: () => h('div') })

/** Presses a key on the document. */
const press = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z' }))

describe('useActiveDocumentListeners', () => {
  it('listens once while shown, not while kept alive out of view, and not once unmounted', async () => {
    const isListeningShown = ref(true)
    const isMounted = ref(true)
    const wrapper = mount({
      render: () => (isMounted.value ? h(KeepAlive, null, [isListeningShown.value ? h(Listening) : h(Other)]) : null),
    })

    press()
    expect(onKeyDown).toHaveBeenCalledTimes(1)

    isListeningShown.value = false
    await nextTick()
    press()
    expect(onKeyDown).toHaveBeenCalledTimes(1)

    isListeningShown.value = true
    await nextTick()
    press()
    expect(onKeyDown).toHaveBeenCalledTimes(2)

    isMounted.value = false
    await nextTick()
    press()
    expect(onKeyDown).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })
})
