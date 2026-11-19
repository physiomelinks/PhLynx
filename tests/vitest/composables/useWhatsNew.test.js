// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const KEY = 'phlynx-last-version'

/** A fresh copy of the module as at app start, for a build of `version`. */
async function load(version = '0.7.0') {
  vi.stubGlobal('__APP_VERSION__', version)
  vi.resetModules()
  const { useWhatsNew } = await import('../../../src/composables/useWhatsNew')
  return useWhatsNew()
}

const stored = () => window.localStorage.getItem(KEY)

describe('useWhatsNew', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.history.replaceState(null, '', '/')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('reads the release and summary from the What\'s New page', async () => {
    const { whatsNew, path } = await load()
    expect(whatsNew.release).toBe('0.7')
    expect(whatsNew.summary).toMatch(/^PhLynx 0\.7 /)
    expect(path).toBe('/docs/getting-started/whats-new')
  })

  it('greets an upgrade, and records the version only once seen', async () => {
    window.localStorage.setItem(KEY, '0.6.0')
    const { pending, markSeen } = await load()
    expect(pending.value).toBe(true)
    expect(stored()).toBe('0.6.0')

    markSeen()
    expect(pending.value).toBe(false)
    expect(stored()).toBe('0.7.0')
    expect((await load()).pending.value).toBe(false)
  })

  it('does not greet a new user, and records the version at once', async () => {
    const { pending } = await load()
    expect(pending.value).toBe(false)
    expect(stored()).toBe('0.7.0')
  })

  it('greets someone who used PhLynx before versions were recorded', async () => {
    window.localStorage.setItem('phlynx-settings', '{}')
    expect((await load()).pending.value).toBe(true)
  })

  it('does not take what the app keeps on any first visit as a sign of an earlier one', async () => {
    window.localStorage.setItem('phlynx-notices-cache', '{}')
    window.localStorage.setItem('phlynx-node-themes-cache', '{}')
    window.localStorage.setItem('other-app', '1')
    expect((await load()).pending.value).toBe(false)
  })

  it('stays quiet for a patch release, and keeps the recorded version up to date', async () => {
    window.localStorage.setItem(KEY, '0.7.0')
    expect((await load('0.7.1')).pending.value).toBe(false)
    expect(stored()).toBe('0.7.1')
  })

  it('stays quiet when the page describes another release', async () => {
    window.localStorage.setItem(KEY, '0.7.0')
    expect((await load('0.8.0')).pending.value).toBe(false)
  })

  it('waits for the next visit when opened from a link that loads a model', async () => {
    window.localStorage.setItem(KEY, '0.6.0')
    window.history.replaceState(null, '', '/?open=workspace_json')
    expect((await load()).pending.value).toBe(false)
    expect(stored()).toBe('0.6.0')

    window.history.replaceState(null, '', '/')
    expect((await load()).pending.value).toBe(true)
  })

  it('is held back while another prompt holds it', async () => {
    window.localStorage.setItem(KEY, '0.6.0')
    const { pending, holdWhatsNew } = await load()
    holdWhatsNew('recovery', true)
    holdWhatsNew('other', true)
    expect(pending.value).toBe(false)
    holdWhatsNew('recovery', false)
    expect(pending.value).toBe(false)
    holdWhatsNew('other', false)
    expect(pending.value).toBe(true)
  })

  it('works without storage, greeting nobody', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect((await load()).pending.value).toBe(false)
  })
})
