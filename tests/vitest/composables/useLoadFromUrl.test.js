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

// Fresh modules per test, since libCellML readiness settles once per module.
async function loadModules() {
  vi.resetModules()
  const { useLoadFromUrl } = await import('../../../src/composables/useLoadFromUrl.js')
  const cellml = await import('../../../src/utils/cellml.js')
  return { useLoadFromUrl, ...cellml }
}

describe('useLoadFromUrl', () => {
  let replaceState

  beforeEach(() => {
    replaceState = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('waits for initLibCellML before dispatching the URL handler', async () => {
    const { useLoadFromUrl, initLibCellML } = await loadModules()
    const handler = vi.fn()
    const { load, isLoading } = useLoadFromUrl()

    const loadPromise = load({ workspace_json: handler })
    await Promise.resolve()

    expect(isLoading.value).toBe(true)
    expect(handler).not.toHaveBeenCalled()

    initLibCellML({})
    await loadPromise

    expect(handler).toHaveBeenCalledWith('encoded-workspace')
    expect(isLoading.value).toBe(false)
    expect(replaceState).toHaveBeenCalledWith(null, '', window.location.pathname)
  })

  it('keeps the hash and reports the error when the handler throws', async () => {
    const { useLoadFromUrl, initLibCellML } = await loadModules()
    initLibCellML({})
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

  it('reports the error and stops loading when libCellML fails to load', async () => {
    const { useLoadFromUrl, bindLibCellML } = await loadModules()
    const handler = vi.fn()
    const onError = vi.fn()
    const { load, isLoading } = useLoadFromUrl()

    const loadPromise = load({ workspace_json: handler }, onError)
    bindLibCellML(Promise.reject(new Error('wasm failed'))).catch(() => {})
    await loadPromise

    expect(handler).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith('Failed to load from link: wasm failed')
    expect(replaceState).not.toHaveBeenCalled()
    expect(isLoading.value).toBe(false)
  })
})
