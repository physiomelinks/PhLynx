// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const READ_KEY = 'phlynx-notices-read'
const CACHE_KEY = 'phlynx-notices-cache'
const NOW = new Date('2026-11-12T12:00:00Z')

const entry = (id, overrides = {}) => ({ id, title: `Notice ${id}`, targets: ['phlynx'], ...overrides })
const feedOf = (...notices) => ({ schema: 1, notices })

/** A fresh copy of the module, so it reads localStorage again. */
async function load() {
  vi.resetModules()
  const { useNotices } = await import('../../../src/composables/useNotices')
  return useNotices()
}

/** Answers the next fetches with `body` (JSON unless already text). */
function respondWith(body, { ok = true } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  const fetchMock = vi.fn(async () => ({ ok, text: async () => text }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const storedRead = () => JSON.parse(window.localStorage.getItem(READ_KEY))
const ids = (notices) => notices.value.map((notice) => notice.id)

describe('useNotices', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.useFakeTimers({ now: NOW })
    vi.stubGlobal('__APP_VERSION__', '0.6.0')
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('starts with no notices and nothing unread', async () => {
    const { notices, unreadCount } = await load()
    expect(notices.value).toEqual([])
    expect(unreadCount.value).toBe(0)
  })

  it('fetches the shared feed, revalidating it, and shows the notices for this app', async () => {
    const fetchMock = respondWith(feedOf(entry('a'), entry('b', { targets: ['cuflynx'] }), entry('c', { targets: ['all'] })))
    const { notices, unreadCount, refreshNotices } = await load()
    await refreshNotices()

    expect(fetchMock).toHaveBeenCalledWith(
      'https://cdn.jsdelivr.net/gh/physiomelinks/LynxNotices@main/notices.json',
      { cache: 'no-cache' }
    )
    expect(ids(notices)).toEqual(['a', 'c'])
    expect(unreadCount.value).toBe(2)
  })

  it("filters by this app's version", async () => {
    respondWith(feedOf(entry('old', { versions: { phlynx: '<0.5.0' } }), entry('now', { versions: { phlynx: '<0.8.0' } })))
    const { notices, refreshNotices } = await load()
    await refreshNotices()
    expect(ids(notices)).toEqual(['now'])
  })

  it('marks the notices read, and remembers that across a reload', async () => {
    respondWith(feedOf(entry('a'), entry('b')))
    const first = await load()
    await first.refreshNotices()
    first.markAllRead()
    expect(first.unreadCount.value).toBe(0)
    expect(storedRead()).toEqual(['a', 'b'])

    respondWith(feedOf(entry('a'), entry('b'), entry('c')))
    const second = await load()
    expect(ids(second.notices)).toEqual(['a', 'b'])
    expect(second.unreadCount.value).toBe(0)
    await second.refreshNotices()
    expect(second.unreadIds.value).toEqual(['c'])
  })

  it('shows the last feed fetched until a new one arrives, and when the fetch fails', async () => {
    respondWith(feedOf(entry('a')))
    await (await load()).refreshNotices()

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const { notices, refreshNotices } = await load()
    expect(ids(notices)).toEqual(['a'])
    await expect(refreshNotices()).resolves.toBeUndefined()
    expect(ids(notices)).toEqual(['a'])
  })

  it.each([
    ['a failed response', { schema: 1, notices: [] }, { ok: false }],
    ['text that is not JSON', '<html>not found</html>', {}],
    ['a feed of another schema', { schema: 2, notices: [] }, {}],
  ])('keeps the notices it has on %s', async (_, body, options) => {
    respondWith(feedOf(entry('a')))
    const { notices, refreshNotices } = await load()
    await refreshNotices()

    respondWith(body, options)
    await refreshNotices({ force: true })
    expect(ids(notices)).toEqual(['a'])
    expect(JSON.parse(window.localStorage.getItem(CACHE_KEY)).notices).toHaveLength(1)
  })

  it('drops a notice the feed no longer holds, and forgets it was read', async () => {
    respondWith(feedOf(entry('a'), entry('b'), entry('theirs', { targets: ['cuflynx'] })))
    const { notices, markAllRead, refreshNotices } = await load()
    await refreshNotices()
    markAllRead()
    window.localStorage.setItem(READ_KEY, JSON.stringify(['a', 'b']))

    respondWith(feedOf(entry('b')))
    await refreshNotices({ force: true })
    expect(ids(notices)).toEqual(['b'])
    expect(storedRead()).toEqual(['b'])
  })

  it('fetches at most once an hour unless forced, sharing a fetch in flight', async () => {
    const fetchMock = respondWith(feedOf(entry('a')))
    const { refreshNotices } = await load()

    await Promise.all([refreshNotices(), refreshNotices()])
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await refreshNotices()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await refreshNotices({ force: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(60 * 60 * 1000)
    await refreshNotices()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('picks up a notice that expires between fetches', async () => {
    respondWith(feedOf(entry('a', { expires: '2026-11-12T12:30:00Z' }), entry('b')))
    const { notices, refreshNotices } = await load()
    await refreshNotices()
    expect(ids(notices)).toEqual(['a', 'b'])

    vi.advanceTimersByTime(60 * 60 * 1000)
    await refreshNotices()
    expect(ids(notices)).toEqual(['b'])
  })

  it.each(['null', '"text"', '{"a":1}', '{not json'])('ignores stored read ids and a cached feed of %s', async (value) => {
    window.localStorage.setItem(READ_KEY, value)
    window.localStorage.setItem(CACHE_KEY, value)
    const { notices, unreadCount } = await load()
    expect(notices.value).toEqual([])
    expect(unreadCount.value).toBe(0)
  })

  it('works without storage, forgetting what was read on reload', async () => {
    const denied = () => {
      throw new Error('denied')
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(denied)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(denied)
    respondWith(feedOf(entry('a')))
    const { notices, unreadCount, markAllRead, refreshNotices } = await load()
    await refreshNotices()
    expect(ids(notices)).toEqual(['a'])
    markAllRead()
    expect(unreadCount.value).toBe(0)
  })
})
