/**
 * Checks whether an element, or any child of it, is clipped by its own width.
 *
 * @param {HTMLElement} el
 * @returns {boolean}
 */
export function isOverflowing(el) {
  return [el, ...el.children].some((part) => part.scrollWidth > part.clientWidth)
}

/**
 * Gives an element a title, its value, only while its text is clipped, so a hover shows what the layout hides.
 */
export const vOverflowTitle = {
  mounted(el, { value }) {
    el._overflowTitle = value
    el._overflowTitleOnEnter = () => {
      if (isOverflowing(el) && el._overflowTitle) el.setAttribute('title', el._overflowTitle)
      else el.removeAttribute('title')
    }
    el.addEventListener('mouseenter', el._overflowTitleOnEnter)
  },
  updated(el, { value }) {
    el._overflowTitle = value
  },
  unmounted(el) {
    el.removeEventListener('mouseenter', el._overflowTitleOnEnter)
  },
}
