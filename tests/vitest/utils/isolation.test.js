import { describe, expect, it, vi } from 'vitest'

import { getIsolationStatus, isIsolationReloadPending, waitForIsolationReload } from '../../../src/utils/isolation.js'

describe('getIsolationStatus', () => {
  it('reports an isolated page as ready', () => {
    expect(getIsolationStatus({ crossOriginIsolated: true })).toEqual({ isIsolated: true, reason: null })
  })

  it.each([
    ['an insecure page', { crossOriginIsolated: false, isSecureContext: false, navigator: {} }, /secure/],
    ['a window without service workers', { crossOriginIsolated: false, isSecureContext: true, navigator: {} }, /service workers/],
    ['a page the service worker hasn’t reloaded yet', { crossOriginIsolated: false, isSecureContext: true, navigator: { serviceWorker: {} } }, /Reload/],
  ])('says why %s isn’t isolated', (_, scope, reason) => {
    const status = getIsolationStatus(scope)
    expect(status.isIsolated).toBe(false)
    expect(status.reason).toMatch(reason)
  })
})

describe('waitForIsolationReload', () => {
  const firstVisit = (overrides = {}) => ({
    crossOriginIsolated: false,
    isSecureContext: true,
    navigator: { serviceWorker: { controller: null } },
    coi: { shouldRegister: () => true },
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    ...overrides,
  })

  it('expects a reload only on a first visit the worker may register for', () => {
    expect(isIsolationReloadPending(firstVisit())).toBe(true)
    expect(isIsolationReloadPending(firstVisit({ crossOriginIsolated: true }))).toBe(false)
    expect(isIsolationReloadPending(firstVisit({ navigator: { serviceWorker: { controller: {} } } }))).toBe(false)
    expect(isIsolationReloadPending(firstVisit({ navigator: {} }))).toBe(false)
    expect(isIsolationReloadPending(firstVisit({ coi: { shouldRegister: () => false } }))).toBe(false)
    expect(isIsolationReloadPending(firstVisit({ isSecureContext: false }))).toBe(false)
  })

  it('resolves at once when no reload is pending, and after the timeout when one never comes', async () => {
    await expect(waitForIsolationReload(firstVisit({ crossOriginIsolated: true }))).resolves.toBeUndefined()

    vi.useFakeTimers()
    let resolved = false
    waitForIsolationReload(firstVisit(), 3000).then(() => (resolved = true))
    await vi.advanceTimersByTimeAsync(2999)
    expect(resolved).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(resolved).toBe(true)
    vi.useRealTimers()
  })
})
