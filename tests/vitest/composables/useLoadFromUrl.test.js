import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  route: {
    hash: '#encoded-workspace',
    query: { open: 'workspace_json' },
  },
}))

vi.mock('vue-router', () => ({
  useRoute: () => state.route,
}))

async function loadModules() {
  vi.resetModules()
  const { useLoadFromUrl } = await import('../../../src/composables/useLoadFromUrl.js')
  return { useLoadFromUrl }
}

describe('useLoadFromUrl', () => {
  let replaceState

  beforeEach(() => {
    replaceState = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('dispatches the URL handler without waiting for libCellML, which runs in its worker', async () => {
    const { useLoadFromUrl } = await loadModules()
    const handler = vi.fn()
    const { load, isLoading } = useLoadFromUrl()

    await load({ workspace_json: handler })

    expect(handler).toHaveBeenCalledWith('encoded-workspace')
    expect(isLoading.value).toBe(false)
    expect(replaceState).toHaveBeenCalledWith(null, '', window.location.pathname)
  })

  it('keeps the hash and reports the error when the handler throws', async () => {
    const { useLoadFromUrl } = await loadModules()
    const onError = vi.fn()
    const { load, isLoading } = useLoadFromUrl()

    await load(
      {
        workspace_json: () => {
          throw new Error('bad workspace')
        },
      },
      onError
    )

    expect(onError).toHaveBeenCalledWith('Failed to load from link: bad workspace')
    expect(replaceState).not.toHaveBeenCalled()
    expect(isLoading.value).toBe(false)
  })
})
