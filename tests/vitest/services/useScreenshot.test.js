import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { toPng, toJpeg, buildFlowSvg } = vi.hoisted(() => ({
  toPng: vi.fn(),
  toJpeg: vi.fn(),
  buildFlowSvg: vi.fn(),
}))

vi.mock('html-to-image', () => ({ toPng, toJpeg }))
vi.mock('../../../src/services/export/svg', () => ({ buildFlowSvg }))

import { useScreenshot } from '../../../src/services/useScreenshot.js'

const nodeWith = (...classes) => {
  const n = document.createElement('div')
  n.classList.add(...classes)
  return n
}

describe('useScreenshot', () => {
  let clickSpy
  let anchors

  beforeEach(() => {
    vi.clearAllMocks()
    toPng.mockResolvedValue('data:image/png;base64,AAA')
    toJpeg.mockResolvedValue('data:image/jpeg;base64,BBB')
    buildFlowSvg.mockReturnValue('<svg/>')
    anchors = []
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      anchors.push({ download: this.download, href: this.href })
    })
    URL.createObjectURL = vi.fn(() => 'blob:fake-svg')
    URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('png capture', () => {
    it('returns the data url and stores it', async () => {
      const { capture, dataUrl } = useScreenshot()
      const el = document.createElement('div')
      const result = await capture(el)
      expect(result).toBe('data:image/png;base64,AAA')
      expect(dataUrl.value).toBe('data:image/png;base64,AAA')
    })

    it('defaults to png with quality 1 and passes caller options through', async () => {
      const { capture } = useScreenshot()
      const el = document.createElement('div')
      await capture(el, { backgroundColor: '#fff' })
      const [calledEl, opts] = toPng.mock.calls[0]
      expect(calledEl).toBe(el)
      expect(opts.quality).toBe(1)
      expect(opts.backgroundColor).toBe('#fff')
    })

    it('falls back to png for an unknown format', async () => {
      const { capture } = useScreenshot()
      await capture(document.createElement('div'), { format: 'gif' })
      expect(toPng).toHaveBeenCalledTimes(1)
      expect(toJpeg).not.toHaveBeenCalled()
    })

    it('filter drops minimap, controls and dropzone nodes but keeps others', async () => {
      const { capture } = useScreenshot()
      await capture(document.createElement('div'))
      const { filter } = toPng.mock.calls[0][1]
      expect(filter(nodeWith('vue-flow__minimap'))).toBe(false)
      expect(filter(nodeWith('vue-flow__controls'))).toBe(false)
      expect(filter(nodeWith('dropzone-background'))).toBe(false)
      expect(filter(nodeWith('vue-flow__node'))).toBe(true)
      expect(filter(nodeWith('vue-flow__edge', 'other'))).toBe(true)
      expect(filter(document.createTextNode('text'))).toBe(true)
    })
  })

  describe('edge stroke fix-up', () => {
    const edgeFlow = () => {
      const el = document.createElement('div')
      el.innerHTML =
        '<svg><path class="vue-flow__edge-path"/><path class="vue-flow__connection-path"/><path class="other"/></svg>'
      return el
    }

    it('sets width, computed stroke and no fill on edge and connection paths only', async () => {
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({ stroke: 'rgb(1, 2, 3)' })
      const el = edgeFlow()
      await useScreenshot().capture(el)
      for (const sel of ['.vue-flow__edge-path', '.vue-flow__connection-path']) {
        const p = el.querySelector(sel)
        expect(p.getAttribute('stroke-width')).toBe('3')
        expect(p.getAttribute('stroke')).toBe('rgb(1, 2, 3)')
        expect(p.getAttribute('fill')).toBe('none')
      }
      expect(el.querySelector('.other').hasAttribute('stroke-width')).toBe(false)
    })

    it('uses #222 when no stroke is computed', async () => {
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({ stroke: '' })
      const el = edgeFlow()
      await useScreenshot().capture(el)
      expect(el.querySelector('.vue-flow__edge-path').getAttribute('stroke')).toBe('#222')
    })
  })

  describe('jpeg capture', () => {
    it('uses toJpeg and downloads with a .jpeg extension', async () => {
      const { capture, dataUrl } = useScreenshot()
      const el = document.createElement('div')
      const result = await capture(el, { format: 'jpeg', shouldDownload: true, fileName: 'pic' })
      expect(toJpeg).toHaveBeenCalledWith(el, expect.objectContaining({ format: 'jpeg' }))
      expect(toPng).not.toHaveBeenCalled()
      expect(result).toBe('data:image/jpeg;base64,BBB')
      expect(dataUrl.value).toBe('data:image/jpeg;base64,BBB')
      expect(anchors).toHaveLength(1)
      expect(anchors[0].download).toBe('pic.jpeg')
      expect(anchors[0].href).toBe('data:image/jpeg;base64,BBB')
    })
  })

  describe('svg capture', () => {
    it('delegates to buildFlowSvg with the options and exposes a blob url', async () => {
      const { capture, dataUrl } = useScreenshot()
      const el = document.createElement('div')
      const viewport = { x: 1, y: 2, zoom: 3 }
      const result = await capture(el, { format: 'svg', viewport })
      expect(buildFlowSvg).toHaveBeenCalledWith(el, expect.objectContaining({ viewport }))
      expect(toPng).not.toHaveBeenCalled()
      expect(result).toBe('<svg/>')
      const blob = URL.createObjectURL.mock.calls[0][0]
      expect(blob.type).toBe('image/svg+xml')
      expect(dataUrl.value).toBe('blob:fake-svg')
    })

    it('downloads with a .svg extension', async () => {
      await useScreenshot().capture(document.createElement('div'), {
        format: 'svg',
        shouldDownload: true,
        fileName: 'fig',
      })
      expect(anchors).toEqual([{ download: 'fig.svg', href: 'blob:fake-svg' }])
    })

    it('returns null and leaves the data url empty when there is nothing to draw', async () => {
      buildFlowSvg.mockReturnValue(null)
      const { capture, dataUrl } = useScreenshot()
      expect(await capture(document.createElement('div'), { format: 'svg' })).toBeNull()
      expect(URL.createObjectURL).not.toHaveBeenCalled()
      expect(dataUrl.value).toBe('')
    })

    it('revokes the previous blob url on a second capture', async () => {
      const { capture } = useScreenshot()
      const el = document.createElement('div')
      await capture(el, { format: 'svg' })
      expect(URL.revokeObjectURL).not.toHaveBeenCalled()
      await capture(el, { format: 'svg' })
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-svg')
    })

    it('does not revoke a previous non-blob data url when switching to svg', async () => {
      const { capture } = useScreenshot()
      const el = document.createElement('div')
      await capture(el)
      await capture(el, { format: 'svg' })
      expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    })

    it('records and rethrows the original error when buildFlowSvg throws', async () => {
      const boom = new Error('boom')
      buildFlowSvg.mockImplementation(() => {
        throw boom
      })
      const { capture, error } = useScreenshot()
      await expect(capture(document.createElement('div'), { format: 'svg' })).rejects.toBe(boom)
      expect(error.value).toBe(boom)
    })
  })

  describe('download', () => {
    it('does not download unless shouldDownload is set', async () => {
      await useScreenshot().capture(document.createElement('div'))
      expect(clickSpy).not.toHaveBeenCalled()
    })

    it('uses a phlynx-screenshot default file name with a .png extension', async () => {
      await useScreenshot().capture(document.createElement('div'), { shouldDownload: true })
      expect(anchors).toHaveLength(1)
      expect(anchors[0].download).toMatch(/^phlynx-screenshot-D\d{4}-\d{2}-\d{2}-T\d{2}-\d{2}-\d{2}\.png$/)
      expect(anchors[0].href).toBe('data:image/png;base64,AAA')
    })

    it('skips the download when the file name is empty', async () => {
      await useScreenshot().capture(document.createElement('div'), { shouldDownload: true, fileName: '' })
      expect(clickSpy).not.toHaveBeenCalled()
    })
  })

  describe('errors', () => {
    it('sets error and rejects when toPng fails', async () => {
      toPng.mockRejectedValue('render failed')
      const { capture, error, dataUrl } = useScreenshot()
      await expect(capture(document.createElement('div'), { shouldDownload: true })).rejects.toThrow('render failed')
      expect(error.value).toBe('render failed')
      expect(dataUrl.value).toBe('')
      expect(clickSpy).not.toHaveBeenCalled()
    })

    it('sets error and rejects when toJpeg fails', async () => {
      toJpeg.mockRejectedValue(new Error('jpeg failed'))
      const { capture, error } = useScreenshot()
      await expect(capture(document.createElement('div'), { format: 'jpeg' })).rejects.toThrow('jpeg failed')
      expect(error.value).toBeInstanceOf(Error)
    })

    it('clears a previous error on the next successful svg capture', async () => {
      toPng.mockRejectedValueOnce('first')
      const { capture, error } = useScreenshot()
      const el = document.createElement('div')
      await expect(capture(el)).rejects.toThrow()
      expect(error.value).toBe('first')
      await capture(el, { format: 'svg' })
      expect(error.value).toBeNull()
    })

    it('clears a previous error on the next successful capture', async () => {
      toPng.mockRejectedValueOnce('first').mockResolvedValue('data:ok')
      const { capture, error } = useScreenshot()
      const el = document.createElement('div')
      await expect(capture(el)).rejects.toThrow()
      expect(error.value).toBe('first')
      await capture(el)
      expect(error.value).toBeNull()
    })
  })
})
