// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSessionMetadataStore } from '../../../src/stores/sessionMetadataStore'

vi.stubGlobal('__APP_VERSION__', '1.2.3')
vi.stubGlobal('__BUILD_STATE_MARKER__', '-dirty')

const App = (await import('../../../src/App.vue')).default

const tooltip = { mounted: () => {}, updated: () => {} }

/**
 * Mounts the app shell on a path, with stub views for every route.
 *
 * @param {string} path - The path to start on.
 * @returns {Promise<{wrapper: import('@vue/test-utils').VueWrapper, router: import('vue-router').Router, store: object}>}
 */
async function mountApp(path = '/') {
  const view = (text) => ({ template: `<div class="stub-view">${text}</div>` })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'workspace', component: view('workspace view') },
      { path: '/simulation', name: 'simulation', component: view('simulation view') },
      { path: '/docs/:rest(.*)*', name: 'docs', component: view('docs view') },
      { path: '/about', name: 'about', component: view('about view') },
    ],
  })
  await router.push(path)
  await router.isReady()
  const store = useSessionMetadataStore()
  const wrapper = mount(App, {
    attachTo: document.body,
    global: {
      plugins: [PrimeVue, router],
      directives: { tooltip },
      stubs: { ConfirmDialog: true },
    },
  })
  return { wrapper, router, store }
}

const isNameShown = (wrapper) => wrapper.find('.session-name').element.style.display !== 'none'
const linkByText = (wrapper, text) => wrapper.findAll('nav a').find((a) => a.text() === text)

describe('App', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('shows the version with the build state marker', async () => {
    const { wrapper } = await mountApp()
    expect(wrapper.find('[data-testid="app-version"]').text()).toBe('PhLynx v1.2.3-dirty')
    wrapper.unmount()
  })

  it('links to the workspace, simulation, user guide and about pages', async () => {
    const { wrapper } = await mountApp()
    const hrefs = wrapper.findAll('nav a').map((a) => [a.text(), a.attributes('href')])
    expect(hrefs).toEqual([
      ['Workspace', '/'],
      ['Simulation', '/simulation'],
      ['User Guide', '/docs/'],
      ['About', '/about'],
    ])
    wrapper.unmount()
  })

  it('navigates to each page when its link is clicked and renders that view', async () => {
    const { wrapper, router } = await mountApp('/')
    expect(wrapper.find('.stub-view').text()).toBe('workspace view')

    await linkByText(wrapper, 'User Guide').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/docs/')
    expect(wrapper.find('.stub-view').text()).toBe('docs view')

    await linkByText(wrapper, 'About').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/about')
    expect(wrapper.find('.stub-view').text()).toBe('about view')

    await linkByText(wrapper, 'Workspace').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
    expect(wrapper.find('.stub-view').text()).toBe('workspace view')
    wrapper.unmount()
  })

  it('marks the User Guide link active on any /docs path, and only there', async () => {
    const { wrapper, router } = await mountApp('/docs/')
    const guide = () => linkByText(wrapper, 'User Guide')
    expect(guide().classes()).toContain('force-active')

    await router.push('/docs/getting-started/intro')
    await flushPromises()
    expect(guide().classes()).toContain('force-active')

    await router.push('/about')
    await flushPromises()
    expect(guide().classes()).not.toContain('force-active')
    expect(linkByText(wrapper, 'About').classes()).toContain('router-link-active')
    wrapper.unmount()
  })

  it('shows the session name on the workspace and simulation routes', async () => {
    const { wrapper, router, store } = await mountApp('/')
    store.setLastSaveName('My model')
    await flushPromises()
    expect(isNameShown(wrapper)).toBe(true)
    expect(wrapper.find('.session-name').text()).toBe('My model')

    await router.push('/simulation')
    await flushPromises()
    expect(isNameShown(wrapper)).toBe(true)
    wrapper.unmount()
  })

  it('hides the session name on the about and docs routes', async () => {
    const { wrapper, router } = await mountApp('/about')
    expect(isNameShown(wrapper)).toBe(false)

    await router.push('/docs/')
    await flushPromises()
    expect(isNameShown(wrapper)).toBe(false)

    await router.push('/')
    await flushPromises()
    expect(isNameShown(wrapper)).toBe(true)
    wrapper.unmount()
  })

  describe('editing the session name', () => {
    async function startEditing(wrapper) {
      await wrapper.find('.session-name').trigger('dblclick')
      await flushPromises()
      return wrapper.find('.session-name input')
    }

    it('swaps the name for an input holding the current name on double-click', async () => {
      const { wrapper, store } = await mountApp('/')
      store.setLastSaveName('Original')
      await flushPromises()
      expect(wrapper.find('.session-name input').exists()).toBe(false)

      const input = await startEditing(wrapper)
      expect(input.exists()).toBe(true)
      expect(input.element.value).toBe('Original')
      expect(wrapper.find('.session-name strong').exists()).toBe(false)
      expect(document.activeElement).toBe(input.element)
      wrapper.unmount()
    })

    it('saves a trimmed new name to the store on Enter and returns to the label', async () => {
      const { wrapper, store } = await mountApp('/')
      const spy = vi.spyOn(store, 'setLastSaveName')
      const input = await startEditing(wrapper)
      await input.setValue('  Renamed  ')
      await input.trigger('keyup.enter')
      await flushPromises()

      expect(spy).toHaveBeenCalledWith('Renamed')
      expect(store.lastSaveName).toBe('Renamed')
      expect(wrapper.find('.session-name input').exists()).toBe(false)
      expect(wrapper.find('.session-name strong').text()).toBe('Renamed')
      wrapper.unmount()
    })

    it('saves on blur', async () => {
      const { wrapper, store } = await mountApp('/')
      const input = await startEditing(wrapper)
      await input.setValue('Blurred name')
      await input.trigger('blur')
      await flushPromises()
      expect(store.lastSaveName).toBe('Blurred name')
      expect(wrapper.find('.session-name input').exists()).toBe(false)
      wrapper.unmount()
    })

    it('does not call the store when the name is unchanged', async () => {
      const { wrapper, store } = await mountApp('/')
      store.setLastSaveName('Same')
      const spy = vi.spyOn(store, 'setLastSaveName')
      const input = await startEditing(wrapper)
      await input.trigger('keyup.enter')
      await flushPromises()
      expect(spy).not.toHaveBeenCalled()
      expect(wrapper.find('.session-name input').exists()).toBe(false)
      wrapper.unmount()
    })

    it('discards the edit on Escape', async () => {
      const { wrapper, store } = await mountApp('/')
      store.setLastSaveName('Keep me')
      await flushPromises()
      const spy = vi.spyOn(store, 'setLastSaveName')
      const input = await startEditing(wrapper)
      await input.setValue('Discarded')
      await input.trigger('keyup.esc')
      await flushPromises()

      expect(spy).not.toHaveBeenCalled()
      expect(store.lastSaveName).toBe('Keep me')
      expect(wrapper.find('.session-name strong').text()).toBe('Keep me')
      wrapper.unmount()
    })

    it('cancels without saving when the value is empty or only whitespace', async () => {
      const { wrapper, store } = await mountApp('/')
      store.setLastSaveName('Stays')
      await flushPromises()
      const spy = vi.spyOn(store, 'setLastSaveName')

      for (const blank of ['', '   ']) {
        const input = await startEditing(wrapper)
        await input.setValue(blank)
        await input.trigger('keyup.enter')
        await flushPromises()
        expect(wrapper.find('.session-name input').exists()).toBe(false)
        expect(wrapper.find('.session-name strong').text()).toBe('Stays')
      }
      expect(spy).not.toHaveBeenCalled()
      wrapper.unmount()
    })
  })
})
