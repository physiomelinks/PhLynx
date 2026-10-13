import { afterEach, describe, expect, it, vi } from 'vitest'

import { useFloatingViewer } from '../../../src/composables/useFloatingViewer.js'

describe('useFloatingViewer', () => {
  const viewer = useFloatingViewer()

  afterEach(() => {
    viewer.state.visible = false
    viewer.setSidebarCollapser(() => {})
    viewer.setTabOpener(() => {})
  })

  it('collapses the sidebar as the viewer floats, and leaves it as the viewer closes', () => {
    const collapse = vi.fn()
    viewer.setSidebarCollapser(collapse)

    viewer.toggle()
    expect(viewer.state.visible).toBe(true)
    expect(collapse).toHaveBeenCalledTimes(1)

    viewer.toggle()
    expect(viewer.state.visible).toBe(false)
    expect(collapse).toHaveBeenCalledTimes(1)
  })

  it('leaves the sidebar open when floating results from outside it', () => {
    const collapse = vi.fn()
    viewer.setSidebarCollapser(collapse)

    viewer.toggle({ isCollapsingSidebar: false })
    expect(viewer.state.visible).toBe(true)
    expect(collapse).not.toHaveBeenCalled()
  })

  it('returns to the Simulation tab, closing the viewer', () => {
    const openTab = vi.fn()
    const collapse = vi.fn()
    viewer.setTabOpener(openTab)
    viewer.setSidebarCollapser(collapse)
    viewer.toggle()

    viewer.returnToTab()
    expect(viewer.state.visible).toBe(false)
    expect(openTab).toHaveBeenCalledTimes(1)
    expect(collapse).toHaveBeenCalledTimes(1)
  })
})
