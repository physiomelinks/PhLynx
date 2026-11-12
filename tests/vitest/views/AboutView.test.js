// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const FEED = {
  schema: 1,
  notices: [
    { id: 'a', title: 'First', targets: ['phlynx'] },
    { id: 'b', title: 'Second', targets: ['all'] },
  ],
}

/** Mounts the About page on `path`, on a fresh copy of the notices already fetched. */
async function mountAbout(path = '/about') {
  vi.resetModules()
  const { useNotices } = await import('../../../src/composables/useNotices')
  const AboutView = (await import('../../../src/views/AboutView.vue')).default
  await useNotices().refreshNotices()

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'workspace', component: { template: '<div />' } },
      { path: '/about', name: 'about', component: AboutView },
    ],
  })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(AboutView, {
    global: { plugins: [PrimeVue, router], stubs: { ChangelogViewer: true } },
  })
  await flushPromises()
  return { wrapper, router, ...useNotices() }
}

const activeTab = (wrapper) => wrapper.find('[role="tab"][aria-selected="true"]').text()
const tab = (wrapper, name) => wrapper.findAll('[role="tab"]').find((t) => t.text().startsWith(name))

describe('AboutView', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.stubGlobal('__APP_VERSION__', '0.6.0')
    vi.stubGlobal('__BUILD_STATE_MARKER__', '')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, text: async () => JSON.stringify(FEED) }))
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens on the overview, counting the unread notices on their tab', async () => {
    const { wrapper, unreadCount } = await mountAbout()
    expect(activeTab(wrapper)).toBe('Overview')
    expect(wrapper.find('[data-testid="notices-tab-count"]').text()).toBe('2')
    expect(unreadCount.value).toBe(2)
  })

  it('opens on the tab named in the address, and marks the notices read when it is theirs', async () => {
    const { wrapper, unreadCount } = await mountAbout('/about?tab=notices')
    expect(activeTab(wrapper)).toBe('Notices')
    expect(wrapper.findAll('[data-testid="notice"]')).toHaveLength(2)
    expect(unreadCount.value).toBe(0)
    expect(wrapper.find('[data-testid="notices-tab-count"]').exists()).toBe(false)
  })

  it('falls back to the overview for a tab it does not have', async () => {
    const { wrapper } = await mountAbout('/about?tab=nonsense')
    expect(activeTab(wrapper)).toBe('Overview')
  })

  it('keeps the address in step with the tab chosen', async () => {
    const { wrapper, router, unreadCount } = await mountAbout()

    await tab(wrapper, 'Notices').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/about?tab=notices')
    expect(unreadCount.value).toBe(0)

    await tab(wrapper, 'Release Notes').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/about?tab=changelog')

    await tab(wrapper, 'Overview').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/about')
  })

  it('follows the address to the notices from another tab', async () => {
    const { wrapper, router } = await mountAbout('/about?tab=changelog')
    expect(activeTab(wrapper)).toBe('Release Notes')

    await router.push('/about?tab=notices')
    await flushPromises()
    expect(activeTab(wrapper)).toBe('Notices')
  })
})
