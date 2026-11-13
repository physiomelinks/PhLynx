import Tooltip from 'primevue/tooltip'

import { useAppSettings } from '../composables/useAppSettings'

const { settings } = useAppSettings()

/** How long the pointer must rest on an element before its tooltip shows, so passing over it shows nothing. */
export const TOOLTIP_SHOW_DELAY = 300

/** The longer wait for a hint, which only names a control, so it shows only to someone who stops to look. */
export const HINT_SHOW_DELAY = 600

/**
 * Gives a tooltip value a show delay, unless the value sets its own.
 *
 * @param {string|object|null|undefined} value A `v-tooltip` value: its text, or its options.
 * @param {number} showDelay
 * @returns {string|object|null|undefined}
 */
export function withShowDelay(value, showDelay) {
  if (!value) return value
  if (typeof value === 'object') return { showDelay, ...value }
  return { value, showDelay }
}

/**
 * Has the tooltip on `el` ask `isEnabled` each time it is about to show, so a setting changed while the element is
 * on screen applies at once. PrimeVue reads the element's disabled flag at that moment; its own writes are ignored.
 *
 * @param {HTMLElement} el
 * @param {() => boolean} isEnabled
 */
function gateTooltip(el, isEnabled) {
  // As PrimeVue does, a tooltip on an input wrapper belongs to its input.
  const target = (el.classList.contains('p-inputwrapper') && el.querySelector('input')) || el
  Object.defineProperty(target, '$_ptooltipDisabled', {
    configurable: true,
    get: () => !isEnabled(),
    set: () => {},
  })
}

/**
 * PrimeVue's Tooltip directive, showing after a delay unless its value sets one.
 *
 * @param {number} showDelay
 * @param {() => boolean} [isEnabled] Asked before each show; the tooltip stays hidden while it is false.
 * @returns {object} A directive taking the same values and modifiers as PrimeVue's.
 */
export function delayedTooltip(showDelay, isEnabled) {
  const delayed = (value) => withShowDelay(value, showDelay)
  return Object.fromEntries(
    Object.entries(Tooltip)
      .filter(([name, hook]) => name !== 'extend' && typeof hook === 'function')
      .map(([name, hook]) => [
        name,
        (el, binding, vnode, prevVnode) => {
          // Before PrimeVue's own hooks, which set the flag; the element's children are in place by now.
          if (isEnabled && name === 'created') gateTooltip(el, isEnabled)
          return hook(el, { ...binding, value: delayed(binding.value), oldValue: delayed(binding.oldValue) }, vnode, prevVnode)
        },
      ]),
  )
}

/**
 * `v-tooltip`: a tooltip carrying what the app shows nowhere else, such as a clipped name, a warning, or why a
 * control is disabled.
 */
export const vTooltip = delayedTooltip(TOOLTIP_SHOW_DELAY)

/**
 * `v-hint`: a tooltip that only names or explains a control, such as "Save workspace", which someone who knows the
 * app has no need of, so the Show button hints setting turns them off. The control carries its name in an
 * `aria-label` too, so the hint is never its only label.
 */
export const vHint = delayedTooltip(HINT_SHOW_DELAY, () => settings.showHints)
