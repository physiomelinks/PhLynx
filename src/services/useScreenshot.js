import { toJpeg as ElToJpg, toPng as ElToPng } from 'html-to-image'
import { ref } from 'vue'

import { buildFlowSvg } from './export/svg'

/** The paint an inline SVG's shapes and text take from stylesheets, which a bitmap export must carry inline. */
const SVG_PAINT = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-opacity',
  'opacity',
  'visibility',
  'font-family',
  'font-size',
  'font-weight',
  'text-anchor',
  'dominant-baseline',
]

/**
 * Writes the computed paint of every shape inside an inline SVG onto its style. html-to-image copies an `<svg>`
 * whole without the styles of what is in it, so shapes styled by a stylesheet would come out black.
 *
 * @param {HTMLElement} el
 * @returns {() => void} Puts each shape's own style back.
 */
export function inlineSvgPaint(el) {
  const saved = []
  for (const shape of el.querySelectorAll?.('svg *') ?? []) {
    const computed = getComputedStyle(shape)
    saved.push([shape, shape.getAttribute('style')])
    for (const property of SVG_PAINT) {
      const value = computed.getPropertyValue?.(property)
      if (value) shape.style.setProperty(property, value)
    }
  }
  return () => {
    for (const [shape, style] of saved) {
      if (style === null) shape.removeAttribute('style')
      else shape.setAttribute('style', style)
    }
  }
}

export function useScreenshot() {
  const dataUrl = ref('')
  const imgType = ref('png')
  const error = ref(null)

  function fixEdges(el) {
    const paths = el.querySelectorAll(
      '.vue-flow__connection-path, .vue-flow__edge-path'
    )
    paths.forEach((path) => {
      path.setAttribute('stroke-width', '3')
      const computedStyle = getComputedStyle(path)
      const strokeColor = computedStyle.stroke || '#222'
      path.setAttribute('stroke', strokeColor)
      path.setAttribute('fill', 'none')
    })
  }

  async function capture(el, options = {}) {
    fixEdges(el)
    let data

    const fileName = options.fileName ?? defaultFileName()
    const format = options.format ?? 'png'

    const restore = format === 'svg' ? () => {} : inlineSvgPaint(el)
    try {
      switch (format) {
        case 'jpeg':
          data = await toJpeg(el, options)
          break
        case 'png':
          data = await toPng(el, options)
          break
        case 'svg':
          data = toSvg(el, options)
          break
        default:
          data = await toPng(el, options)
          break
      }
    } finally {
      restore()
    }

    if (options.shouldDownload && fileName !== '') {
      download(fileName)
    }

    return data
  }

  function toJpeg(el, options = { quality: 0.95 }) {
    error.value = null

    return ElToJpg(el, options)
      .then((data) => {
        dataUrl.value = data
        imgType.value = 'jpeg'
        return data
      })
      .catch((err) => {
        error.value = err
        throw new Error(err)
      })
  }

  function toPng(el, options = {}) {
    error.value = null

    const newOptions = {
      quality: 1,
      ...options,

      // remove unwanted visual elements from screenshot
      filter: (node) => {
        if (
          node.classList?.contains('vue-flow__minimap') ||
          node.classList?.contains('minimap-toggle') ||
          node.classList?.contains('vue-flow__controls') ||
          node.classList?.contains('dropzone-background')
        ) {
          return false
        }
        return true
      },
    }

    return ElToPng(el, newOptions)
      .then((data) => {
        dataUrl.value = data
        imgType.value = 'png'
        return data
      })
      .catch((err) => {
        error.value = err
        throw new Error(err)
      })
  }

  /**
   * Draws the flow as a native SVG (vector shapes and text, no embedded bitmap), for posters and
   * figures that need to scale.
   *
   * @param {HTMLElement} el - The `.vue-flow` element.
   * @param {Object} options
   * @param {{ x: number, y: number, zoom: number }} options.viewport
   * @returns {string|null} The SVG markup, or null when there is nothing to draw.
   */
  function toSvg(el, options = {}) {
    error.value = null
    try {
      const svg = buildFlowSvg(el, options)
      if (!svg) return null
      if (dataUrl.value.startsWith('blob:')) URL.revokeObjectURL(dataUrl.value)
      dataUrl.value = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
      imgType.value = 'svg'
      return svg
    } catch (err) {
      error.value = err
      throw err
    }
  }

  function defaultFileName() {
    const readableDate = new Date().toISOString().slice(0, 19).replace('T', '-T').replace(/:/g, '-')
    return `phlynx-screenshot-D${readableDate}`
  }

  function download(fileName) {
    const link = document.createElement('a')
    link.download = `${fileName}.${imgType.value}`
    link.href = dataUrl.value
    link.click()
  }

  return {
    capture,
    dataUrl,
    error,
  }
}
