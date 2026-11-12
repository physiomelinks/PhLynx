// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const entry = (id, overrides = {}) => ({ id, title: `Notice ${id}`, targets: ['phlynx'], ...overrides })
const feedOf = (...notices) => ({ schema: 1, notices })

function respondWith(feed) {
  const fetchMock = vi.fn(async () => ({ ok: true, text: async () => JSON.stringify(feed) }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Mounts the panel on a fresh copy of the notices, so each test starts from localStorage. */
async function mountPanel(props = {}) {
  vi.resetModules()
  const { useNotices } = await import('../../../src/composables/useNotices')
  const NoticesPanel = (await import('../../../src/components/NoticesPanel.vue')).default
  const wrapper = mount(NoticesPanel, { props, global: { plugins: [PrimeVue] } })
  await flushPromises()
  return { wrapper, ...useNotices() }
}

const titles = (wrapper) => wrapper.findAll('.notice-title').map((title) => title.text())

describe('NoticesPanel', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.stubGlobal('__APP_VERSION__', '0.6.0')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('says so when there are no notices', async () => {
    respondWith(feedOf())
    const { wrapper } = await mountPanel({ active: true })
    expect(wrapper.find('[data-testid="notices-empty"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-testid="notice"]')).toHaveLength(0)
  })

  it('lists each notice with its severity, text, date and link', async () => {
    respondWith(
      feedOf(
        entry('a', {
          title: 'Old formats',
          description: 'Re-save older workspaces.',
          severity: 'warning',
          published: '2026-11-01',
          link: 'https://github.com/physiomelinks/phlynx/issues/1',
        }),
        entry('b', { title: 'Plain' })
      )
    )
    const { wrapper } = await mountPanel({ active: true })
    expect(titles(wrapper)).toEqual(['Old formats', 'Plain'])

    const [first, second] = wrapper.findAll('[data-testid="notice"]')
    expect(first.classes()).toContain('notice-warning')
    expect(first.find('.notice-description').text()).toBe('Re-save older workspaces.')
    expect(first.find('time').attributes('datetime')).toBe('2026-11-01T00:00:00.000Z')
    expect(first.find('a').attributes()).toMatchObject({
      href: 'https://github.com/physiomelinks/phlynx/issues/1',
      target: '_blank',
      rel: 'noopener noreferrer',
    })

    expect(second.classes()).toContain('notice-info')
    expect(second.find('.notice-description').exists()).toBe(false)
    expect(second.find('.notice-footer').exists()).toBe(false)
  })

  it('shows markup in a description as text', async () => {
    respondWith(feedOf(entry('a', { description: '<img src=x onerror=alert(1)>' })))
    const { wrapper } = await mountPanel({ active: true })
    expect(wrapper.find('.notice-description').text()).toBe('<img src=x onerror=alert(1)>')
    expect(wrapper.find('img').exists()).toBe(false)
  })

  it('leaves the notices unread while hidden, then marks them read but still new once shown', async () => {
    respondWith(feedOf(entry('a'), entry('b')))
    const { wrapper, unreadCount } = await mountPanel({ active: false })
    expect(unreadCount.value).toBe(0)

    const { useNotices } = await import('../../../src/composables/useNotices')
    await useNotices().refreshNotices()
    await flushPromises()
    expect(unreadCount.value).toBe(2)

    await wrapper.setProps({ active: true })
    await flushPromises()
    expect(unreadCount.value).toBe(0)
    expect(wrapper.findAll('[data-testid="notice-new"]')).toHaveLength(2)
  })

  it('does not mark a notice read before as new', async () => {
    window.localStorage.setItem('phlynx-notices-read', JSON.stringify(['a']))
    respondWith(feedOf(entry('a'), entry('b')))
    const { wrapper } = await mountPanel({ active: true })
    const news = wrapper.findAll('[data-testid="notice"]').map((n) => n.find('[data-testid="notice-new"]').exists())
    expect(news).toEqual([false, true])
  })

  it('fetches the feed when shown', async () => {
    const fetchMock = respondWith(feedOf())
    const { wrapper } = await mountPanel({ active: false })
    expect(fetchMock).not.toHaveBeenCalled()
    await wrapper.setProps({ active: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
