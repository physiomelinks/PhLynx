// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import PaneContextMenu from '../../../src/components/PaneContextMenu.vue'

let wrapper
afterEach(() => wrapper?.unmount())

/** Mounts the menu open, with a plain item and a submenu. */
async function openMenu() {
  const items = [
    { label: 'Replace Module', action: vi.fn() },
    {
      label: 'Apply Parameter Set',
      items: [
        { label: 'lumen (default)', checked: false, action: vi.fn() },
        { label: 'enterocyte', checked: true, action: vi.fn() },
      ],
    },
  ]
  wrapper = mount(PaneContextMenu, { props: { items }, attachTo: document.body })
  wrapper.vm.open(10, 20)
  await wrapper.vm.$nextTick()
  return items
}

const menuItems = () => [...document.body.querySelectorAll('.context-menu > .context-menu__list > .context-menu__item')]
const submenuItems = () => [...document.body.querySelectorAll('.context-menu__submenu .context-menu__item')]

describe('PaneContextMenu', () => {
  it('runs a plain item and closes', async () => {
    const items = await openMenu()
    menuItems()[0].click()
    await wrapper.vm.$nextTick()

    expect(items[0].action).toHaveBeenCalledOnce()
    expect(document.body.querySelector('.context-menu')).toBeNull()
  })

  it('opens a submenu on hover, ticking the checked item, and runs the item picked', async () => {
    const items = await openMenu()
    expect(submenuItems()).toEqual([])

    menuItems()[1].dispatchEvent(new Event('mouseenter'))
    await wrapper.vm.$nextTick()

    expect(menuItems()[1].getAttribute('aria-expanded')).toBe('true')
    expect(submenuItems().map((item) => [item.textContent.trim(), item.getAttribute('aria-checked')])).toEqual([
      ['lumen (default)', 'false'],
      ['enterocyte', 'true'],
    ])
    expect(submenuItems()[1].querySelector('.pi-check')).not.toBeNull()
    expect(submenuItems()[0].querySelector('.pi-check')).toBeNull()

    submenuItems()[0].click()
    await wrapper.vm.$nextTick()
    expect(items[1].items[0].action).toHaveBeenCalledOnce()
    expect(document.body.querySelector('.context-menu')).toBeNull()
  })

  it('keeps the menu open when a submenu item is clicked, showing its items', async () => {
    await openMenu()
    menuItems()[1].click()
    await wrapper.vm.$nextTick()

    expect(document.body.querySelector('.context-menu')).not.toBeNull()
    expect(submenuItems()).toHaveLength(2)
  })
})
