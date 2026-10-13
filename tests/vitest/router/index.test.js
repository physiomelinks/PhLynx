// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const trackPageView = vi.hoisted(() => vi.fn())
vi.mock('../../../src/composables/useGtm', () => ({ useGtm: () => ({ trackPageView }) }))

vi.mock('../../../src/views/WorkspaceArea.vue', () => ({ default: { name: 'WorkspaceAreaStub', render: () => null } }))
vi.mock('../../../src/views/AboutView.vue', () => ({ default: { name: 'AboutViewStub', render: () => null } }))
vi.mock('../../../src/views/SimulationView.vue', () => ({ default: { name: 'SimulationViewStub', render: () => null } }))
vi.mock('../../../src/views/DocsView.vue', () => ({ default: { name: 'DocsViewStub', render: () => null } }))

const { default: router } = await import('../../../src/router/index.js')
const { setWorkspaceMounted } = await import('../../../src/router/workspaceMount.js')
const NotFoundView = (await import('../../../src/views/NotFoundView.vue')).default

describe('router', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    setWorkspaceMounted(false)
    await router.push('/about')
    vi.runAllTimers()
    trackPageView.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('registers the workspace, simulation, about, docs and not-found routes', () => {
    const byName = Object.fromEntries(router.getRoutes().map((r) => [r.name, r]))
    expect(byName.workspace.path).toBe('/')
    expect(byName.simulation.path).toBe('/simulation')
    expect(byName.about.path).toBe('/about')
    expect(byName.docs.path).toMatch(/^\/docs\//)
    expect(byName['not-found']).toBeDefined()
  })

  it('resolves / to the workspace and /about to the about route', async () => {
    await router.push('/')
    expect(router.currentRoute.value.name).toBe('workspace')
    await router.push('/about')
    expect(router.currentRoute.value.name).toBe('about')
  })

  it('resolves an unknown path to the not-found route with NotFoundView', async () => {
    await router.push('/nope/x')
    const route = router.currentRoute.value
    expect(route.name).toBe('not-found')
    expect(route.params.pathMatch).toBe('nope/x')
    expect(route.matched[0].components.default).toBe(NotFoundView)
  })

  it('redirects /docs/ to the introduction page of the user guide', async () => {
    await router.push('/docs/')
    const route = router.currentRoute.value
    expect(route.fullPath).toBe('/docs/getting-started/introduction')
    expect(route.name).toBe('docs')
    expect(route.params.slug).toEqual(['getting-started', 'introduction'])
  })

  it('resolves nested docs paths to the docs route with the slug split into segments', async () => {
    await router.push('/docs/my-category/setup-guide')
    expect(router.currentRoute.value.name).toBe('docs')
    expect(router.currentRoute.value.params.slug).toEqual(['my-category', 'setup-guide'])
  })

  it('lazy-loads the docs view component', async () => {
    await router.push('/docs/a')
    expect(router.currentRoute.value.matched[0].components.default.name).toBe('DocsViewStub')
  })

  it('sends /simulation to the workspace until the workspace has mounted', async () => {
    await router.push('/simulation')
    expect(router.currentRoute.value.name).toBe('workspace')

    setWorkspaceMounted(true)
    await router.push('/simulation')
    expect(router.currentRoute.value.name).toBe('simulation')
  })

  describe('document title', () => {
    it.each([
      ['/', 'Workflow Builder - PhLynx'],
      ['/about', 'About - PhLynx'],
      ['/nope', '404 Not Found - PhLynx'],
    ])('sets the title for %s', async (path, title) => {
      await router.push(path === '/about' ? '/' : '/about')
      await router.push(path)
      expect(document.title).toBe(title)
    })

    it('sets the Simulation title once the workspace is mounted', async () => {
      setWorkspaceMounted(true)
      await router.push('/simulation')
      expect(document.title).toBe('Simulation - PhLynx')
    })

    it('formats docs slugs into capitalised words joined by a pipe', async () => {
      await router.push('/docs/my-category/setup_guide')
      expect(document.title).toBe('My Category | Setup Guide - PhLynx')
    })

    it('uses the redirected introduction slug for the title of /docs/', async () => {
      await router.push('/docs/')
      expect(document.title).toBe('Getting Started | Introduction - PhLynx')
    })

    it('falls back to the bare site name when the route has no title', async () => {
      const r = router.getRoutes().find((x) => x.name === 'about')
      const original = r.meta.title
      r.meta.title = ''
      try {
        await router.push('/')
        await router.push('/about')
        expect(document.title).toBe('PhLynx')
      } finally {
        r.meta.title = original
      }
    })
  })

  describe('page view tracking', () => {
    it('tracks the page view 100ms after navigation with the resolved title', async () => {
      await router.push('/')
      expect(trackPageView).not.toHaveBeenCalled()
      vi.advanceTimersByTime(99)
      expect(trackPageView).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(trackPageView).toHaveBeenCalledTimes(1)
      const [to, title] = trackPageView.mock.calls[0]
      expect(to.path).toBe('/')
      expect(title).toBe('Workflow Builder')
    })

    it('passes the computed docs title to tracking', async () => {
      await router.push('/docs/a-b/c')
      vi.advanceTimersByTime(100)
      expect(trackPageView).toHaveBeenCalledWith(expect.objectContaining({ path: '/docs/a-b/c' }), 'A B | C')
    })
  })
})

describe('NotFoundView', () => {
  it('shows the message and its button pushes to the workspace root', async () => {
    const testRouter = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: { render: () => null } },
        { path: '/lost', component: NotFoundView },
      ],
    })
    await testRouter.push('/lost')
    const wrapper = mount(NotFoundView, { global: { plugins: [PrimeVue, testRouter] } })
    expect(wrapper.text()).toContain('Page Not Found')
    const button = wrapper.find('button')
    expect(button.text()).toBe('Back to Workspace')
    await button.trigger('click')
    await flushPromises()
    expect(testRouter.currentRoute.value.path).toBe('/')
  })
})
