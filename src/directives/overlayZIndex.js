import { ZIndex } from '@primeuix/utils/zindex'

/**
 * Stacks an element on PrimeVue's overlay z-index layer while its value is truthy, so it stays above any open dialog.
 */
export const vOverlayZIndex = {
  mounted(el, { value, instance }) {
    if (!value) return
    ZIndex.set('overlay', el, instance?.$primevue?.config?.zIndex?.overlay ?? 1000)
  },
  beforeUnmount(el) {
    if (!el.style.zIndex) return
    const zIndex = el.style.zIndex
    ZIndex.clear(el)
    // Keep the leave transition on top.
    el.style.zIndex = zIndex
  },
}
