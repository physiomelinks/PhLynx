import Tooltip from 'primevue/tooltip'

/** How long the pointer must rest on a control before its hint shows, so passing over it shows nothing. */
export const HINT_SHOW_DELAY = 600

/**
 * Gives a tooltip value the hint delay, unless the value sets its own.
 *
 * @param {string|object|null|undefined} value A `v-tooltip` value: its text, or its options.
 * @returns {string|object|null|undefined}
 */
export function withHintDelay(value) {
  if (!value) return value
  if (typeof value === 'object') return { showDelay: HINT_SHOW_DELAY, ...value }
  return { value, showDelay: HINT_SHOW_DELAY }
}

/**
 * A tooltip that only names or explains a control, such as "Save workspace", which someone who knows the app has
 * no need of. It takes the same value and modifiers as `v-tooltip`, but waits for the pointer to rest before showing.
 * Tooltips that carry what the app shows nowhere else (a clipped name, a warning, why a control is disabled)
 * stay on `v-tooltip`.
 */
export const vHint = Object.fromEntries(
  Object.entries(Tooltip)
    .filter(([name, hook]) => name !== 'extend' && typeof hook === 'function')
    .map(([name, hook]) => [
      name,
      (el, binding, vnode, prevVnode) =>
        hook(el, { ...binding, value: withHintDelay(binding.value), oldValue: withHintDelay(binding.oldValue) }, vnode, prevVnode),
    ]),
)
