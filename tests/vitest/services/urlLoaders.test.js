import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/services/compress', () => ({
  base64ToUtf8: async (data) => data,
  base64ToBlob: async (data) => ({ blob: data }),
}))

import { createUrlLoaders } from '../../../src/services/urlLoaders'

/** A promise with its resolve exposed, standing in for the built-in library registration. */
function deferred() {
  let resolve
  const promise = new Promise((r) => (resolve = r))
  return { promise, resolve }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('createUrlLoaders', () => {
  it('applies a workspace only once the built-in library is ready', async () => {
    const ready = deferred()
    const applyWorkspaceState = vi.fn()
    const loaders = createUrlLoaders({
      applyWorkspaceState,
      importOmexFile: vi.fn(),
      processImportedOmexArchive: vi.fn(),
      libraryReady: ready.promise,
    })

    const loading = loaders.workspace_json('{"flow":{},"store":{}}')
    await flush()
    expect(applyWorkspaceState).not.toHaveBeenCalled()

    ready.resolve()
    await loading
    expect(applyWorkspaceState).toHaveBeenCalledWith({ flow: {}, store: {} }, { source: 'url' })
  })

  it('imports an OMEX archive only once the built-in library is ready', async () => {
    const ready = deferred()
    const importOmexFile = vi.fn(async () => ({ files: {} }))
    const processImportedOmexArchive = vi.fn()
    const loaders = createUrlLoaders({
      applyWorkspaceState: vi.fn(),
      importOmexFile,
      processImportedOmexArchive,
      libraryReady: ready.promise,
    })

    const loading = loaders.omex('zip')
    await flush()
    expect(importOmexFile).not.toHaveBeenCalled()
    expect(processImportedOmexArchive).not.toHaveBeenCalled()

    ready.resolve()
    await loading
    expect(importOmexFile).toHaveBeenCalledWith({ blob: 'zip' })
    expect(processImportedOmexArchive).toHaveBeenCalledWith({ blob: 'zip' }, { files: {} }, 'url_imported.omex')
  })

  it('applies straight away without a ready promise', async () => {
    const applyWorkspaceState = vi.fn()
    const loaders = createUrlLoaders({ applyWorkspaceState, importOmexFile: vi.fn(), processImportedOmexArchive: vi.fn() })

    await loaders.workspace_json('{"flow":{},"store":{}}')
    expect(applyWorkspaceState).toHaveBeenCalledTimes(1)
  })
})
