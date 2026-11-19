// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const KEY = 'phlynx-last-version'
const PAGE = '/docs/getting-started/whats-new'

/** Mounts the card on `path`, on a fresh start of a 0.7.0 build. */
async function mountCard({ path = '/', delay = 0 } = {}) {
  vi.stubGlobal('__APP_VERSION__', '0.7.0')
  vi.resetModules()
  const WhatsNewCard = (await import('../../../src/components/WhatsNewCard.vue')).default
  const { useWhatsNew } = await import('../../../src/composables/useWhatsNew')
  const view = { template: '<div />' }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: view },
      { path: '/docs/:slug(.*)*', component: view },
    ],
  })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(WhatsNewCard, { props: { delay }, global: { plugins: [PrimeVue, router] } })
  await flushPromises()
  return { wrapper, router, ...useWhatsNew() }
}

const card = (wrapper) => wrapper.find('[data-testid="whats-new"]')

describe('WhatsNewCard', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem(KEY, '0.6.0')
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('announces the release with the page\'s summary', async () => {
    const { wrapper } = await mountCard()
    expect(card(wrapper).find('h2').text()).toBe('PhLynx 0.7 is here')
    expect(card(wrapper).find('.whats-new-summary').text()).toMatch(/^PhLynx 0\.7 /)
  })

  it('opens the page and is not shown again', async () => {
    const { wrapper, router } = await mountCard()
    await wrapper.find('[data-testid="whats-new-open"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe(PAGE)
    expect(card(wrapper).exists()).toBe(false)
    expect(window.localStorage.getItem(KEY)).toBe('0.7.0')
  })

  it('is dismissed, and not shown again', async () => {
    const { wrapper } = await mountCard()
    await wrapper.find('[data-testid="whats-new-dismiss"]').trigger('click')
    await flushPromises()
    expect(card(wrapper).exists()).toBe(false)
    expect(window.localStorage.getItem(KEY)).toBe('0.7.0')
  })

  it('counts reaching the page any other way as seeing it', async () => {
    const { wrapper, router } = await mountCard()
    await router.push(PAGE + '/')
    await flushPromises()
    expect(card(wrapper).exists()).toBe(false)
    expect(window.localStorage.getItem(KEY)).toBe('0.7.0')
  })

  it('is not shown on the page itself', async () => {
    const { wrapper } = await mountCard({ path: PAGE })
    expect(card(wrapper).exists()).toBe(false)
    expect(window.localStorage.getItem(KEY)).toBe('0.7.0')
  })

  it('waits for the app to load before appearing', async () => {
    vi.useFakeTimers()
    const { wrapper } = await mountCard({ delay: 1500 })
    expect(card(wrapper).exists()).toBe(false)
    await vi.advanceTimersByTimeAsync(1500)
    expect(card(wrapper).exists()).toBe(true)
  })

  it('steps aside while held, and comes back after', async () => {
    const { wrapper, holdWhatsNew } = await mountCard()
    holdWhatsNew('recovery', true)
    await flushPromises()
    expect(card(wrapper).exists()).toBe(false)
    holdWhatsNew('recovery', false)
    await flushPromises()
    expect(card(wrapper).exists()).toBe(true)
  })
})
