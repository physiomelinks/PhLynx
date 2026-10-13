import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ensureExtension,
  getFileHandle,
  legacyDownload,
  saveFileHandle,
  saveWithDialog,
  stripExtension,
  writeFileHandle,
} from '../../../src/utils/save'

const abortError = () => Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' })

const fakeHandle = (name = 'model.cellml') => {
  const writable = { write: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) }
  return { name, writable, createWritable: vi.fn().mockResolvedValue(writable) }
}

describe('stripExtension', () => {
  it('removes the last extension only', () => {
    expect(stripExtension('report.docx')).toBe('report')
    expect(stripExtension('archive.tar.gz')).toBe('archive.tar')
  })

  it('leaves names without a dot unchanged', () => {
    expect(stripExtension('model')).toBe('model')
    expect(stripExtension('')).toBe('')
  })

  it('treats a leading dot as part of the name, not an extension', () => {
    expect(stripExtension('.hidden')).toBe('.hidden')
  })

  it('strips a trailing dot', () => {
    expect(stripExtension('model.')).toBe('model')
  })
})

describe('ensureExtension', () => {
  it('appends the extension when the name has none', () => {
    expect(ensureExtension('model', '.cellml')).toBe('model.cellml')
  })

  it('returns the name unchanged when it already ends with the extension', () => {
    expect(ensureExtension('model.cellml', '.cellml')).toBe('model.cellml')
  })

  it('replaces a different existing extension', () => {
    expect(ensureExtension('model.xml', '.cellml')).toBe('model.cellml')
  })

  it('only replaces the last extension when the name has multiple dots', () => {
    expect(ensureExtension('my.model.v2.xml', '.cellml')).toBe('my.model.v2.cellml')
    expect(ensureExtension('my.model.cellml', '.cellml')).toBe('my.model.cellml')
  })

  it('matches the extension case-sensitively', () => {
    expect(ensureExtension('model.CELLML', '.cellml')).toBe('model.cellml')
  })

  it('gives an empty name just the extension', () => {
    expect(ensureExtension('', '.json')).toBe('.json')
  })

  it('treats a dotfile name as having no extension', () => {
    expect(ensureExtension('.hidden', '.json')).toBe('.hidden.json')
  })
})

describe('legacyDownload', () => {
  let clickSpy
  let created

  beforeEach(() => {
    vi.useFakeTimers()
    created = null
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      created = this
    })
    URL.createObjectURL = vi.fn(() => 'blob:fake-url')
    URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('clicks a hidden anchor pointing at the blob URL with the download name', () => {
    const blob = new Blob(['data'], { type: 'text/plain' })
    legacyDownload('output.txt', blob)

    expect(URL.createObjectURL).toHaveBeenCalledWith(blob)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(created.getAttribute('href')).toBe('blob:fake-url')
    expect(created.download).toBe('output.txt')
    expect(created.style.display).toBe('none')
    expect(document.body.contains(created)).toBe(true)
  })

  it('removes the anchor and revokes the URL only after the cleanup delay', () => {
    legacyDownload('output.txt', new Blob(['x']))

    vi.advanceTimersByTime(99)
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    expect(document.body.contains(created)).toBe(true)

    vi.advanceTimersByTime(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-url')
    expect(document.body.contains(created)).toBe(false)
  })
})

describe('saveFileHandle', () => {
  afterEach(() => {
    delete window.showSaveFilePicker
  })

  it('reports status false with no handle when the picker API is unavailable', async () => {
    expect(await saveFileHandle('a.json', [])).toEqual({ status: false, handle: null })
  })

  it('passes the suggested name and file types to the picker and returns the handle', async () => {
    const handle = fakeHandle()
    window.showSaveFilePicker = vi.fn().mockResolvedValue(handle)
    const types = [{ description: 'CellML', accept: { 'application/xml': ['.cellml'] } }]

    const result = await saveFileHandle('model.cellml', types)

    expect(window.showSaveFilePicker).toHaveBeenCalledWith({ suggestedName: 'model.cellml', types })
    expect(result).toEqual({ status: true, handle })
  })

  it.each([undefined, '', '   '])('falls back to a default name for %j', async (name) => {
    window.showSaveFilePicker = vi.fn().mockResolvedValue(fakeHandle())
    await saveFileHandle(name, [])
    expect(window.showSaveFilePicker.mock.calls[0][0].suggestedName).toBe('phlynx-export')
  })

  it('treats an AbortError as the user cancelling', async () => {
    window.showSaveFilePicker = vi.fn().mockRejectedValue(abortError())
    expect(await saveFileHandle('a.json', [])).toEqual({ status: true, handle: null })
  })

  it('wraps any other picker error', async () => {
    window.showSaveFilePicker = vi.fn().mockRejectedValue(new Error('denied'))
    await expect(saveFileHandle('a.json', [])).rejects.toThrow('Error saving file: denied')
  })
})

describe('writeFileHandle', () => {
  it('writes the blob to a writable stream and closes it', async () => {
    const handle = fakeHandle()
    const blob = new Blob(['content'])

    const result = await writeFileHandle(handle, blob)

    expect(result).toBeUndefined()
    expect(handle.writable.write).toHaveBeenCalledWith(blob)
    expect(handle.writable.close).toHaveBeenCalledTimes(1)
    expect(handle.writable.write.mock.invocationCallOrder[0]).toBeLessThan(handle.writable.close.mock.invocationCallOrder[0])
  })

  it('returns true without throwing when the write is aborted', async () => {
    const handle = fakeHandle()
    handle.writable.write.mockRejectedValue(abortError())
    expect(await writeFileHandle(handle, new Blob(['x']))).toBe(true)
  })

  it('returns true when creating the writable is aborted', async () => {
    const handle = fakeHandle()
    handle.createWritable.mockRejectedValue(abortError())
    expect(await writeFileHandle(handle, new Blob(['x']))).toBe(true)
  })

  it('wraps other write errors', async () => {
    const handle = fakeHandle()
    handle.writable.write.mockRejectedValue(new Error('disk full'))
    await expect(writeFileHandle(handle, new Blob(['x']))).rejects.toThrow('Error writing file to disk: disk full')
    expect(handle.writable.close).not.toHaveBeenCalled()
  })
})

describe('getFileHandle', () => {
  afterEach(() => {
    delete window.showSaveFilePicker
  })

  it('asks for a legacy dialog when the picker API is unavailable', async () => {
    expect(await getFileHandle('model', [], '.cellml')).toEqual({
      success: false,
      needsLegacyDialog: true,
      method: 'legacy',
    })
  })

  it('suggests baseName plus suffix and returns the handle with a clean name', async () => {
    const handle = fakeHandle('chosen.v1.cellml')
    window.showSaveFilePicker = vi.fn().mockResolvedValue(handle)

    const result = await getFileHandle('model', [], '.cellml')

    expect(window.showSaveFilePicker.mock.calls[0][0].suggestedName).toBe('model.cellml')
    expect(result).toEqual({ success: true, handle, cleanName: 'chosen.v1', method: 'system' })
  })

  it('reports cancellation when the user dismisses the picker', async () => {
    window.showSaveFilePicker = vi.fn().mockRejectedValue(abortError())
    expect(await getFileHandle('model', [], '.cellml')).toEqual({ success: false, cancelled: true })
  })
})

describe('saveWithDialog', () => {
  beforeEach(() => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('writes through the handle and reports the handle name without extension', async () => {
    const handle = fakeHandle('picked.json')
    const blob = new Blob(['{}'])

    const result = await saveWithDialog(blob, handle, 'workspace', '.json')

    expect(handle.writable.write).toHaveBeenCalledWith(blob)
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(result).toEqual({ success: true, savedName: 'picked', method: 'system' })
  })

  it('falls back to a download named with the ensured extension when there is no handle', async () => {
    let anchor
    HTMLAnchorElement.prototype.click.mockImplementation(function () {
      anchor = this
    })
    const result = await saveWithDialog(new Blob(['{}']), null, 'workspace', '.json')

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1)
    expect(anchor.download).toBe('workspace.json')
    expect(result).toEqual({ success: true, savedName: 'workspace', method: 'legacy' })
  })
})
