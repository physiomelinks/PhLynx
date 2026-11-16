// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'

import { isNestedPopupOpen } from '../../../src/composables/useEditorCloseGuard.js'

const MASK = 'editor-mask'

/** Adds a dialog mask to the page, stacked at a z-index. */
function addMask(zIndex, className = '') {
  const mask = document.createElement('div')
  mask.className = `p-dialog-mask ${className}`.trim()
  mask.style.zIndex = String(zIndex)
  document.body.appendChild(mask)
  return mask
}

describe('isNestedPopupOpen', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('is false with only the editor open', () => {
    addMask(1100, MASK)
    expect(isNestedPopupOpen(MASK)).toBe(false)
  })

  it('finds a dialog stacked above the editor, though mounted before it on the page', () => {
    const confirm = addMask(1200)
    addMask(1100, MASK)
    expect(isNestedPopupOpen(MASK)).toBe(true)
    confirm.style.zIndex = '1000'
    expect(isNestedPopupOpen(MASK)).toBe(false)
  })

  it('finds an open popup or menu', () => {
    addMask(1100, MASK)
    const menu = document.createElement('div')
    menu.className = 'p-contextmenu'
    document.body.appendChild(menu)
    expect(isNestedPopupOpen(MASK)).toBe(true)
  })
})
