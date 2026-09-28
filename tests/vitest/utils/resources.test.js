import { describe, expect, it, vi } from 'vitest'

import {
  buildModuleLibraryBaseUrl,
  fetchModuleLibraryResources,
  getModuleLibrarySettings,
  getUrlForResource,
} from '../../../src/utils/resources.js'

const manifest = {
  collections: {
    modules: [{ name: 'cardiac', file: 'cardiac_modules.cellml', path: 'modules/cardiac/cardiac_modules.cellml' }],
    units: [{ name: 'cardiac', file: 'cardiac_units.cellml', path: 'modules/cardiac/cardiac_units.cellml' }],
    configs: [{ name: 'cardiac', file: 'cardiac_modules_config.json', path: 'modules/cardiac/cardiac_modules_config.json' }],
    parameters: [{ name: 'cardiac', file: 'cardiac_parameters.csv', path: 'modules/cardiac/cardiac_parameters.csv' }],
  },
}

function mockFetch(files) {
  return vi.fn(async (url) => {
    if (!(url in files)) return { ok: false, status: 404 }
    const body = files[url]
    return {
      ok: true,
      status: 200,
      json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    }
  })
}

describe('module library settings', () => {
  it('is off by default and points at main on jsDelivr', () => {
    const settings = getModuleLibrarySettings({})
    expect(settings.enabled).toBe(false)
    expect(settings.ref).toBe('main')
    expect(getUrlForResource(undefined, settings)).toBe(
      'https://cdn.jsdelivr.net/gh/physiomelinks/circulatory-autogen-modules@main/manifests/vitalworkshop.json'
    )
  })

  it('builds URLs for a configured ref', () => {
    const settings = getModuleLibrarySettings({ VITE_LOAD_MODULE_LIBRARY: 'true', VITE_MODULE_LIBRARY_REF: 'v1.2.0' })
    expect(settings.enabled).toBe(true)
    expect(settings.baseUrl).toBe(buildModuleLibraryBaseUrl('v1.2.0'))
    expect(getUrlForResource('modules/cardiac/cardiac_modules.cellml', settings)).toBe(
      'https://cdn.jsdelivr.net/gh/physiomelinks/circulatory-autogen-modules@v1.2.0/modules/cardiac/cardiac_modules.cellml'
    )
  })

  it('uses a custom base URL when given', () => {
    const settings = getModuleLibrarySettings({ VITE_MODULE_LIBRARY_URL: 'http://localhost:8000' })
    expect(getUrlForResource('a/b.json', settings)).toBe('http://localhost:8000/a/b.json')
  })
})

describe('fetchModuleLibraryResources', () => {
  const settings = getModuleLibrarySettings({ VITE_LOAD_MODULE_LIBRARY: 'true', VITE_MODULE_LIBRARY_REF: 'dev' })
  const base = 'https://cdn.jsdelivr.net/gh/physiomelinks/circulatory-autogen-modules@dev/'

  it('fetches the manifest and its modules, units and configs for the ref', async () => {
    const fetchFn = mockFetch({
      [`${base}manifests/vitalworkshop.json`]: manifest,
      [`${base}modules/cardiac/cardiac_modules.cellml`]: '<model name="m"/>',
      [`${base}modules/cardiac/cardiac_units.cellml`]: '<model name="u"/>',
      [`${base}modules/cardiac/cardiac_modules_config.json`]: '[{"vessel_type":"chamber"}]',
    })

    const result = await fetchModuleLibraryResources({ settings, fetchFn })

    expect(fetchFn.mock.calls.map(([url]) => url).sort()).toEqual(
      [
        `${base}manifests/vitalworkshop.json`,
        `${base}modules/cardiac/cardiac_modules.cellml`,
        `${base}modules/cardiac/cardiac_modules_config.json`,
        `${base}modules/cardiac/cardiac_units.cellml`,
      ].sort()
    )
    expect(result.failures).toEqual([])
    expect(result.modules).toEqual([
      { ...manifest.collections.modules[0], url: `${base}modules/cardiac/cardiac_modules.cellml`, content: '<model name="m"/>' },
    ])
    expect(result.units[0].content).toBe('<model name="u"/>')
    expect(result.configs[0].content).toEqual([{ vessel_type: 'chamber' }])
  })

  it('does not throw when the manifest fetch fails', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    const result = await fetchModuleLibraryResources({ settings, fetchFn })
    expect(result.modules).toEqual([])
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0].collection).toBe('manifest')
  })

  it('reports a missing file without losing the others', async () => {
    const fetchFn = mockFetch({
      [`${base}manifests/vitalworkshop.json`]: manifest,
      [`${base}modules/cardiac/cardiac_modules.cellml`]: '<model name="m"/>',
    })
    const result = await fetchModuleLibraryResources({ settings, fetchFn })
    expect(result.modules).toHaveLength(1)
    expect(result.failures.map((f) => f.collection).sort()).toEqual(['configs', 'units'])
  })
})
