/**
 * Exports the workflow canvas as a native SVG: real <rect>, <text> and <path> elements rather than
 * an image or HTML inside <foreignObject>, so it stays sharp at any size and opens in Inkscape,
 * Illustrator and poster tools.
 *
 * Edges are already SVG and are copied with their computed colours, their arrowheads redrawn as
 * plain shapes (Illustrator mishandles <marker>). Nodes are HTML, so each node's
 * rendered DOM is walked and redrawn: every element with a background or border becomes a rect,
 * every text run becomes a <text> (truncated with an ellipsis where the screen truncates it), and
 * known PrimeIcons become small vector icons. Positions come from the rendered layout, so what is
 * exported matches what is on screen, including the node colour theme and dark mode.
 */

/** Interactive UI that has no place in a figure. */
export const SVG_EXCLUDE_SELECTOR = [
  'button',
  'input',
  'textarea',
  '.instance-button',
  '.delete-handle-popover-btn',
  '.vue-flow__resize-control',
  '.vue-flow__handle.handle--ghost',
].join(', ')

/** Warning badges: an instance's missing-parameter marker and an edge's coupling conflict. */
export const SVG_WARNING_SELECTOR = '.status-indicator, .coupling-edge-warning'

/**
 * PrimeIcons drawn as simple stroked paths in a 14 x 14 box (icon fonts would not survive the trip
 * to other tools). Icons not listed here are left out.
 */
export const SVG_ICONS = {
  'pi-box': 'M7 1.2 12.6 4.1v5.8L7 12.8 1.4 9.9V4.1Z M1.4 4.1 7 7l5.6-2.9 M7 7v5.8',
  'pi-file': 'M3 1.2h5.6L11.4 4v8.8H3Z M8.6 1.2V4h2.8',
  'pi-exclamation-triangle': 'M7 1.6 13 12.2H1Z M7 5.4v3.2 M7 10.3v.1',
}

const ELLIPSIS = '…'

/**
 * @param {*} value
 * @returns {string} Text safe in SVG content and attribute values.
 */
export function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * @param {number} value
 * @returns {string} At most two decimals, no trailing zeros.
 */
export function num(value) {
  return String(Math.round(value * 100) / 100)
}

/**
 * Builds an element string, leaving out attributes that are null, undefined or ''.
 *
 * @param {string} tag
 * @param {Object} attrs
 * @param {string} [content] - Already escaped content; omit for a self-closing tag.
 * @returns {string}
 */
export function el(tag, attrs, content) {
  const list = Object.entries(attrs)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => ` ${key}="${escapeXml(typeof value === 'number' ? num(value) : value)}"`)
    .join('')
  return content === undefined ? `<${tag}${list}/>` : `<${tag}${list}>${content}</${tag}>`
}

/**
 * Shortens text to fit a width, as CSS `text-overflow: ellipsis` does.
 *
 * @param {string} text
 * @param {number} maxWidth
 * @param {(text: string) => number} measure
 * @param {boolean} [ellipsis=true] - Otherwise the text is simply clipped.
 * @returns {string}
 */
export function fitText(text, maxWidth, measure, ellipsis = true) {
  if (measure(text) <= maxWidth + 0.5) return text
  const suffix = ellipsis ? ELLIPSIS : ''
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (measure(text.slice(0, mid).trimEnd() + suffix) <= maxWidth + 0.5) lo = mid
    else hi = mid - 1
  }
  if (lo > 0) return text.slice(0, lo).trimEnd() + suffix
  return ellipsis && measure(suffix) <= maxWidth + 0.5 ? suffix : ''
}

/**
 * @param {string} value - A computed border radius, e.g. '10px' or '50%'.
 * @param {number} width
 * @param {number} height
 * @returns {number} The radius in px, no more than half the shorter side.
 */
export function resolveRadius(value, width, height) {
  const amount = parseFloat(value) || 0
  const radius = String(value).trim().endsWith('%') ? (amount / 100) * Math.min(width, height) : amount
  return Math.max(0, Math.min(radius, width / 2, height / 2))
}

/**
 * Reads 'rgb()' / 'rgba()' colours, including the space-separated syntax.
 *
 * @param {string} css
 * @returns {{ hex: string, opacity: number }|null|undefined} null when fully transparent, undefined
 *   when the syntax is not rgb() (the caller then asks the browser).
 */
export function parseRgb(css) {
  const match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(String(css).trim())
  if (!match) return undefined
  const channels = match.slice(1, 4).map((v) => Math.max(0, Math.min(255, Math.round(parseFloat(v)))))
  let opacity = match[4] === undefined ? 1 : parseFloat(match[4])
  if (match[4]?.endsWith('%')) opacity /= 100
  if (opacity <= 0) return null
  const hex = `#${channels.map((c) => c.toString(16).padStart(2, '0')).join('')}`
  return { hex, opacity: Math.min(1, opacity) }
}

/**
 * Turns any computed CSS colour (including color-mix() and color(srgb …) results) into hex plus
 * opacity, which every SVG tool understands.
 *
 * @param {Document} doc
 * @returns {(css: string) => ({ hex: string, opacity: number }|null)}
 */
export function createColourResolver(doc) {
  const cache = new Map()
  let ctx = null
  return (css) => {
    if (!css || css === 'none' || css === 'transparent') return null
    if (cache.has(css)) return cache.get(css)
    let result = parseRgb(css)
    if (result === undefined) {
      // Let the browser resolve the colour by painting one pixel.
      ctx ??= doc.createElement('canvas').getContext('2d', { willReadFrequently: true })
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = '#000'
      ctx.fillStyle = css
      ctx.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
      result = a === 0 ? null : parseRgb(`rgba(${r}, ${g}, ${b}, ${a / 255})`)
    }
    cache.set(css, result)
    return result
  }
}

/** Grows to hold everything drawn. */
class Bounds {
  constructor() {
    this.minX = Infinity
    this.minY = Infinity
    this.maxX = -Infinity
    this.maxY = -Infinity
  }

  add(x, y, width, height) {
    this.minX = Math.min(this.minX, x)
    this.minY = Math.min(this.minY, y)
    this.maxX = Math.max(this.maxX, x + width)
    this.maxY = Math.max(this.maxY, y + height)
  }

  get empty() {
    return this.minX === Infinity
  }
}

function paintAttrs(prefix, colour) {
  if (!colour) return { [prefix]: 'none' }
  return { [prefix]: colour.hex, [`${prefix}-opacity`]: colour.opacity < 1 ? colour.opacity : null }
}

/** Elements of an inline SVG that draw, and so need their computed paint written out. */
const SVG_DRAWN = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'use'])

/** Elements that only describe things other elements use. */
const SVG_DEFINITIONS = new Set(['defs', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'pattern', 'symbol', 'marker', 'filter'])

/**
 * Checks whether an element is, or is inside, a definition such as a gradient.
 *
 * @param {Element} element
 * @param {Element} stop - The svg it belongs to.
 * @returns {boolean}
 */
function isDefinition(element, stop) {
  for (let current = element; current && current !== stop; current = current.parentElement) {
    if (SVG_DEFINITIONS.has(current.tagName.toLowerCase())) return true
  }
  return false
}

/**
 * Gives the matrix from an inline SVG's user space to flow coordinates.
 *
 * @param {{a: number, b: number, c: number, d: number, e: number, f: number}} ctm - From getScreenCTM().
 * @param {{left: number, top: number}} rootRect - The flow root's client rect.
 * @param {{x: number, y: number, zoom: number}} viewport
 * @returns {string} A `matrix(…)` transform.
 */
export function flowMatrix(ctm, rootRect, viewport) {
  const { x: panX, y: panY, zoom } = viewport
  const values = [ctm.a / zoom, ctm.b / zoom, ctm.c / zoom, ctm.d / zoom, (ctm.e - rootRect.left - panX) / zoom, (ctm.f - rootRect.top - panY) / zoom]
  return `matrix(${values.map((value) => String(Math.round(value * 10000) / 10000)).join(' ')})`
}

/**
 * Copies an inline SVG's contents for export, with each drawn element's computed paint written as
 * attributes (so theme colours, currentColor and stylesheet rules survive) and ids prefixed, so
 * several copies can share one document.
 *
 * @param {SVGSVGElement} svg
 * @param {Object} options
 * @param {Function} options.getStyle - getComputedStyle.
 * @param {Function} options.colour - From createColourResolver.
 * @param {string} options.idPrefix - Unique to this copy.
 * @param {Function} options.serialise - Element -> markup, e.g. an XMLSerializer's serializeToString.
 * @returns {string} The markup of the svg's children.
 */
export function serialiseInlineSvg(svg, { getStyle, colour, idPrefix, serialise }) {
  const copy = svg.cloneNode(true)
  const originals = [...svg.querySelectorAll('*')]
  const copies = [...copy.querySelectorAll('*')]
  const prefixed = (value) =>
    value.replace(/url\(\s*['"]?#([^'")]+)['"]?\s*\)/g, (_, id) => `url(#${idPrefix}${id})`).replace(/^#(.+)$/, (_, id) => `#${idPrefix}${id}`)
  const drop = []

  originals.forEach((original, i) => {
    const element = copies[i]
    const tag = original.tagName.toLowerCase()
    const style = getStyle(original)
    // Definitions aren't rendered where they stand, so their own display says nothing.
    if (!isDefinition(original, svg) && (style.display === 'none' || style.visibility === 'hidden')) {
      drop.push(element)
      return
    }
    element.removeAttribute('class')
    element.removeAttribute('style')
    if (element.id) element.id = `${idPrefix}${element.id}`
    for (const name of ['href', 'xlink:href', 'clip-path', 'mask', 'filter', 'fill', 'stroke']) {
      const value = element.getAttribute(name)
      if (value) element.setAttribute(name, prefixed(value))
    }
    if (tag === 'stop') {
      const stop = colour(style.stopColor)
      element.setAttribute('stop-color', stop?.hex ?? '#000000')
      const stopOpacity = (stop?.opacity ?? 0) * (parseFloat(style.stopOpacity) || 1)
      if (stopOpacity < 1) element.setAttribute('stop-opacity', num(stopOpacity))
    }
    if (!SVG_DRAWN.has(tag)) {
      const opacity = parseFloat(style.opacity)
      if (opacity < 1) element.setAttribute('opacity', num(opacity))
      return
    }
    const paint = (prefix) => {
      const value = style[prefix]
      if (/^url\(/.test(value ?? '')) return { [prefix]: prefixed(value) }
      const resolved = colour(value)
      if (!resolved) return { [prefix]: 'none' }
      const opacity = resolved.opacity * (parseFloat(style[`${prefix}Opacity`]) || 1)
      return { [prefix]: resolved.hex, [`${prefix}-opacity`]: opacity < 1 ? num(opacity) : null }
    }
    const attrs = {
      ...paint('fill'),
      ...paint('stroke'),
      'stroke-width': style.stroke && style.stroke !== 'none' ? parseFloat(style.strokeWidth) || 1 : null,
      'stroke-dasharray': style.strokeDasharray && style.strokeDasharray !== 'none' ? style.strokeDasharray : null,
      'stroke-linecap': style.strokeLinecap && style.strokeLinecap !== 'butt' ? style.strokeLinecap : null,
      'stroke-linejoin': style.strokeLinejoin && style.strokeLinejoin !== 'miter' ? style.strokeLinejoin : null,
      'fill-rule': style.fillRule === 'evenodd' ? 'evenodd' : null,
      opacity: parseFloat(style.opacity) < 1 ? num(parseFloat(style.opacity)) : null,
    }
    if (tag === 'text' || tag === 'tspan') {
      Object.assign(attrs, {
        'font-family': style.fontFamily || null,
        'font-size': parseFloat(style.fontSize) || null,
        'font-weight': style.fontWeight && style.fontWeight !== '400' ? style.fontWeight : null,
        'font-style': style.fontStyle && style.fontStyle !== 'normal' ? style.fontStyle : null,
        'text-anchor': style.textAnchor && style.textAnchor !== 'start' ? style.textAnchor : null,
      })
    }
    for (const [name, value] of Object.entries(attrs)) {
      if (value === null || value === undefined) element.removeAttribute(name)
      else element.setAttribute(name, value)
    }
  })
  drop.forEach((element) => element.remove())
  return [...copy.children].map((child) => serialise(child).replace(/ xmlns(:xlink)?="[^"]*"/g, '')).join('')
}

/**
 * Rewrites path data with one space between every command and number and numbers rounded to two
 * decimals. Browsers accept any spacing, but some importers (Illustrator among them) are fussier.
 * Arc commands are left alone, since their flags may be written run together.
 *
 * @param {string} d
 * @returns {string}
 */
export function normalisePathData(d) {
  if (/[aA]/.test(d)) return d.trim()
  const tokens = String(d).match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []
  return tokens.map((token) => (/^[a-zA-Z]$/.test(token) ? token : num(parseFloat(token)))).join(' ')
}

/**
 * The transform that places a marker's contents at a path vertex, as the SVG spec does for
 * `<marker>`. Drawing arrowheads this way, rather than with markers, keeps them correct in tools
 * that don't support markers or SVG 2's `orient="auto-start-reverse"`.
 *
 * @param {Object} marker
 * @param {number[]} marker.viewBox - [x, y, width, height].
 * @param {number} marker.refX
 * @param {number} marker.refY
 * @param {number} marker.markerWidth
 * @param {number} marker.markerHeight
 * @param {string} marker.markerUnits - 'strokeWidth' or 'userSpaceOnUse'.
 * @param {{ x: number, y: number }} point - The vertex.
 * @param {number} angle - Orientation in degrees.
 * @param {number} strokeWidth - Of the path carrying the marker.
 * @returns {string} A `matrix(…)` transform.
 */
export function markerTransform(marker, point, angle, strokeWidth) {
  const [, , vbWidth, vbHeight] = marker.viewBox
  const unit = marker.markerUnits === 'userSpaceOnUse' ? 1 : strokeWidth
  // preserveAspectRatio's default, xMidYMid meet: one uniform scale. The alignment offset cancels
  // out because the reference point moves with the content.
  const scale = Math.min((marker.markerWidth * unit) / vbWidth, (marker.markerHeight * unit) / vbHeight)
  const radians = (angle * Math.PI) / 180
  const a = scale * Math.cos(radians)
  const b = scale * Math.sin(radians)
  const c = -b
  const d = a
  const e = point.x - marker.refX * a - marker.refY * c
  const f = point.y - marker.refX * b - marker.refY * d
  const fixed = (value) => String(Math.round(value * 10000) / 10000)
  return `matrix(${[a, b, c, d, e, f].map(fixed).join(' ')})`
}

/**
 * Where a marker sits on a path and which way it points.
 *
 * @param {{ getTotalLength: Function, getPointAtLength: Function }} path
 * @param {boolean} atStart - marker-start rather than marker-end.
 * @param {string} orient - The marker's orient attribute.
 * @returns {{ point: { x: number, y: number }, angle: number }|null}
 */
export function markerPlacement(path, atStart, orient) {
  const length = path.getTotalLength()
  if (!(length > 0)) return null
  const step = Math.min(1, length)
  const [from, to] = atStart
    ? [path.getPointAtLength(0), path.getPointAtLength(step)]
    : [path.getPointAtLength(length - step), path.getPointAtLength(length)]
  const direction = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI
  const point = atStart ? from : to
  const value = String(orient ?? '0').trim()
  let angle
  if (value === 'auto') angle = direction
  else if (value === 'auto-start-reverse') angle = atStart ? direction + 180 : direction
  else angle = parseFloat(value) || 0
  return { point: { x: point.x, y: point.y }, angle }
}

/**
 * Draws the workflow inside a Vue Flow element as a standalone SVG document.
 *
 * @param {HTMLElement} root - The `.vue-flow` element.
 * @param {Object} options
 * @param {{ x: number, y: number, zoom: number }} options.viewport - Vue Flow's current viewport.
 * @param {number} [options.padding=24] - Space around the drawing, in flow units.
 * @param {'auto'|string|null} [options.background='auto'] - 'auto' uses the canvas background on
 *   screen, a CSS colour sets one, null leaves it transparent.
 * @param {string} [options.exclude=SVG_EXCLUDE_SELECTOR] - Elements to leave out.
 * @param {boolean} [options.includeWarnings=false] - Draw the warning badges on instances and edges.
 * @param {string} [options.title='PhLynx workflow']
 * @returns {string|null} The SVG markup, or null when there is nothing to draw.
 */
export function buildFlowSvg(root, { viewport, padding = 24, background = 'auto', exclude = SVG_EXCLUDE_SELECTOR, includeWarnings = false, title = 'PhLynx workflow' }) {
  const skip = includeWarnings ? exclude : `${exclude}, ${SVG_WARNING_SELECTOR}`
  const doc = root.ownerDocument
  const win = doc.defaultView
  const colour = createColourResolver(doc)
  const measureCtx = doc.createElement('canvas').getContext('2d')
  const bounds = new Bounds()
  const rootRect = root.getBoundingClientRect()
  const { x: panX, y: panY, zoom } = viewport

  /** Screen rect -> flow coordinates (the units Vue Flow lays nodes out in). */
  const toFlow = (rect) => ({
    x: (rect.left - rootRect.left - panX) / zoom,
    y: (rect.top - rootRect.top - panY) / zoom,
    width: rect.width / zoom,
    height: rect.height / zoom,
  })

  const isHidden = (style) => style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0

  // ── Edges ─────────────────────────────────────────────────────────────
  // Arrowheads are drawn as plain shapes at each end, not as <marker>s, which Illustrator and some
  // other editors import wrongly.
  const markers = new Map()

  function readMarker(attr) {
    const id = /url\(\s*['"]?#([^'")]+)['"]?\s*\)/.exec(attr ?? '')?.[1]
    if (!id) return null
    if (markers.has(id)) return markers.get(id)
    const element = doc.getElementById(id)
    let marker = null
    if (element && element.tagName.toLowerCase() === 'marker') {
      const number = (name, fallback) => {
        const value = parseFloat(element.getAttribute(name))
        return Number.isFinite(value) ? value : fallback
      }
      const markerWidth = number('markerWidth', 3)
      const markerHeight = number('markerHeight', 3)
      const viewBox = (element.getAttribute('viewBox') ?? `0 0 ${markerWidth} ${markerHeight}`).trim().split(/[\s,]+/).map(Number)
      const shapes = [...element.querySelectorAll('path, polyline, polygon, line, circle, ellipse, rect')].map((shape) => {
        const style = win.getComputedStyle(shape)
        const copy = shape.cloneNode(false)
        for (const name of ['class', 'style', 'id']) copy.removeAttribute(name)
        const paint = {
          ...paintAttrs('fill', colour(style.fill)),
          ...paintAttrs('stroke', colour(style.stroke)),
          'stroke-width': parseFloat(style.strokeWidth) || 1,
          'stroke-linejoin': style.strokeLinejoin !== 'miter' ? style.strokeLinejoin : null,
          'stroke-linecap': style.strokeLinecap !== 'butt' ? style.strokeLinecap : null,
        }
        for (const [name, value] of Object.entries(paint)) {
          if (value === null) copy.removeAttribute(name)
          else copy.setAttribute(name, value)
        }
        return new win.XMLSerializer().serializeToString(copy).replace(/ xmlns="[^"]*"/, '')
      })
      if (shapes.length && viewBox.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) {
        marker = {
          viewBox,
          refX: number('refX', 0),
          refY: number('refY', 0),
          markerWidth,
          markerHeight,
          markerUnits: element.getAttribute('markerUnits') ?? 'strokeWidth',
          orient: element.getAttribute('orient') ?? '0',
          shapes: shapes.join(''),
        }
      }
    }
    markers.set(id, marker)
    return marker
  }

  const edgeParts = []
  for (const edge of root.querySelectorAll('.vue-flow__edges .vue-flow__edge')) {
    const edgeStyle = win.getComputedStyle(edge)
    if (isHidden(edgeStyle)) continue
    const edgeOpacity = parseFloat(edgeStyle.opacity)
    for (const path of edge.querySelectorAll('path.vue-flow__edge-path')) {
      const style = win.getComputedStyle(path)
      const stroke = colour(style.stroke)
      const d = path.getAttribute('d')
      if (!d || !stroke) continue
      const width = parseFloat(style.strokeWidth) || 1
      const parts = [
        el('path', {
          d: normalisePathData(d),
          fill: 'none',
          ...paintAttrs('stroke', stroke),
          'stroke-width': width,
          'stroke-dasharray': style.strokeDasharray !== 'none' ? style.strokeDasharray : null,
          'stroke-linecap': style.strokeLinecap !== 'butt' ? style.strokeLinecap : null,
          'stroke-linejoin': style.strokeLinejoin !== 'miter' ? style.strokeLinejoin : null,
        }),
      ]
      for (const [attr, atStart] of [['marker-start', true], ['marker-end', false]]) {
        const marker = readMarker(path.getAttribute(attr))
        const placement = marker && markerPlacement(path, atStart, marker.orient)
        if (!placement) continue
        parts.push(`<g transform="${markerTransform(marker, placement.point, placement.angle, width)}">${marker.shapes}</g>`)
      }
      edgeParts.push(...(edgeOpacity < 1 ? [`<g opacity="${num(edgeOpacity)}">`, ...parts, '</g>'] : parts))
      const box = path.getBBox()
      bounds.add(box.x - width * 3, box.y - width * 3, box.width + width * 6, box.height + width * 6)
    }
  }

  // ── Nodes ─────────────────────────────────────────────────────────────
  function emitBox(element, style, out) {
    const rect = toFlow(element.getBoundingClientRect())
    if (rect.width < 0.5 || rect.height < 0.5) return
    const fill = colour(style.backgroundColor)
    const borderWidth = parseFloat(style.borderTopWidth) || 0
    const border = borderWidth > 0 && style.borderTopStyle !== 'none' ? colour(style.borderTopColor) : null
    if (!fill && !border) return
    const radius = resolveRadius(style.borderTopLeftRadius, rect.width, rect.height)
    // CSS borders sit inside the box; SVG strokes straddle the outline.
    const inset = border ? borderWidth / 2 : 0
    out.push(
      el('rect', {
        x: rect.x + inset,
        y: rect.y + inset,
        width: rect.width - 2 * inset,
        height: rect.height - 2 * inset,
        rx: radius > 0 ? Math.max(0, radius - inset) : null,
        ...paintAttrs('fill', fill),
        ...(border ? { ...paintAttrs('stroke', border), 'stroke-width': borderWidth } : {}),
      })
    )
    bounds.add(rect.x, rect.y, rect.width, rect.height)
  }

  function emitIcon(element, style, out) {
    const name = [...element.classList].find((cls) => SVG_ICONS[cls])
    const ink = colour(style.color)
    if (!name || !ink) return
    const rect = toFlow(element.getBoundingClientRect())
    const size = parseFloat(style.fontSize) || 12
    const scale = size / 14
    const x = rect.x + rect.width / 2 - size / 2
    const y = rect.y + rect.height / 2 - size / 2
    out.push(
      el('path', {
        d: SVG_ICONS[name],
        transform: `translate(${num(x)} ${num(y)}) scale(${num(scale * 1000) / 1000})`,
        fill: 'none',
        ...paintAttrs('stroke', ink),
        'stroke-width': 1.2,
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
      })
    )
    bounds.add(x, y, size, size)
  }

  /** Nearest ancestor (up to the node) that clips overflowing text, and whether it adds an ellipsis. */
  function clipFor(element, stop) {
    for (let current = element; current && current !== stop.parentElement; current = current.parentElement) {
      const style = win.getComputedStyle(current)
      if (style.overflowX === 'hidden' || style.overflowX === 'clip') {
        const rect = toFlow(current.getBoundingClientRect())
        const right = rect.x + rect.width - (parseFloat(style.paddingRight) || 0) - (parseFloat(style.borderRightWidth) || 0)
        return { right, ellipsis: style.textOverflow === 'ellipsis' }
      }
    }
    return null
  }

  function emitText(textNode, nodeRoot, out) {
    const parent = textNode.parentElement
    const style = win.getComputedStyle(parent)
    const preserve = /^pre/.test(style.whiteSpace)
    const text = preserve ? textNode.textContent : textNode.textContent.replace(/\s+/g, ' ').trim()
    if (!text) return
    const ink = colour(style.color)
    if (!ink) return

    const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    measureCtx.font = font
    const measure = (value) => measureCtx.measureText(value).width
    const metrics = measureCtx.measureText(text)
    const size = parseFloat(style.fontSize) || 12
    const ascent = metrics.fontBoundingBoxAscent ?? size * 0.8
    const descent = metrics.fontBoundingBoxDescent ?? size * 0.2

    const range = doc.createRange()
    range.selectNodeContents(textNode)
    const lineRects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0).map(toFlow)
    range.detach?.()
    if (!lineRects.length) return

    // Wrapped text: share the words out over the rendered lines.
    let lines = [text]
    if (lineRects.length > 1) {
      lines = []
      let words = text.split(' ')
      for (const [i, line] of lineRects.entries()) {
        if (i === lineRects.length - 1) {
          lines.push(words.join(' '))
          break
        }
        let take = 1
        while (take < words.length && measure(words.slice(0, take + 1).join(' ')) <= line.width + 1) take++
        lines.push(words.slice(0, take).join(' '))
        words = words.slice(take)
      }
    }

    const clip = clipFor(parent, nodeRoot)
    lines.forEach((line, i) => {
      const rect = lineRects[i]
      if (!line || !rect) return
      const shown = clip && rect.x + measure(line) > clip.right + 0.5 ? fitText(line, clip.right - rect.x, measure, clip.ellipsis) : line
      if (!shown) return
      const baseline = rect.y + (rect.height - (ascent + descent)) / 2 + ascent
      out.push(
        el(
          'text',
          {
            x: rect.x,
            y: baseline,
            'font-family': style.fontFamily,
            'font-size': size,
            'font-weight': style.fontWeight !== '400' ? style.fontWeight : null,
            'font-style': style.fontStyle !== 'normal' ? style.fontStyle : null,
            ...paintAttrs('fill', ink),
            'xml:space': preserve ? 'preserve' : null,
          },
          escapeXml(shown)
        )
      )
      bounds.add(rect.x, rect.y, Math.min(measure(shown), rect.width), rect.height)
    })
  }

  let inlineSvgCount = 0

  /** Copies an inline <svg> (a glyph or other artwork in a node) into the export, clipped to its box. */
  function emitInlineSvg(svg, style, out) {
    const rect = toFlow(svg.getBoundingClientRect())
    const ctm = svg.getScreenCTM?.()
    if (!ctm || rect.width < 0.5 || rect.height < 0.5) return
    const idPrefix = `svg${++inlineSvgCount}-`
    const content = serialiseInlineSvg(svg, {
      getStyle: (element) => win.getComputedStyle(element),
      colour,
      idPrefix,
      serialise: (element) => new win.XMLSerializer().serializeToString(element),
    })
    if (!content) return
    const clips = style.overflow !== 'visible'
    if (clips) {
      out.push(`<clipPath id="${idPrefix}clip">${el('rect', { x: rect.x, y: rect.y, width: rect.width, height: rect.height })}</clipPath>`)
    }
    // The clip is in flow coordinates, so it goes on a group outside the matrix.
    out.push(
      `<g${clips ? ` clip-path="url(#${idPrefix}clip)"` : ''}><g transform="${flowMatrix(ctm, rootRect, viewport)}">${content}</g></g>`
    )
    bounds.add(rect.x, rect.y, rect.width, rect.height)
  }

  function walk(element, nodeRoot, out) {
    if (element.matches(skip)) return
    // walk meets SVG only where HTML holds it, which is at an outer <svg>; emitInlineSvg copies the rest.
    if (element instanceof win.SVGElement && !(element instanceof win.SVGSVGElement)) return
    const style = win.getComputedStyle(element)
    if (isHidden(style)) return
    if (element instanceof win.SVGSVGElement) {
      const parts = []
      emitInlineSvg(element, style, parts)
      const opacity = parseFloat(style.opacity)
      if (parts.length && opacity < 1) out.push(`<g opacity="${num(opacity)}">`, ...parts, '</g>')
      else out.push(...parts)
      return
    }
    const parts = []
    emitBox(element, style, parts)
    if (element.matches('i.pi, span.pi')) {
      emitIcon(element, style, parts)
    } else {
      for (const child of element.childNodes) {
        if (child.nodeType === 3) emitText(child, nodeRoot, parts)
        else if (child.nodeType === 1) walk(child, nodeRoot, parts)
      }
    }
    const opacity = parseFloat(style.opacity)
    if (parts.length && opacity < 1) out.push(`<g opacity="${num(opacity)}">`, ...parts, '</g>')
    else out.push(...parts)
  }

  const nodeParts = []
  for (const node of root.querySelectorAll('.vue-flow__nodes .vue-flow__node')) {
    const parts = []
    walk(node, node, parts)
    if (!parts.length) continue
    const id = node.getAttribute('data-id')
    const name = node.querySelector('.name-text')?.textContent.trim()
    nodeParts.push(
      `<g${id ? ` id="node-${escapeXml(id)}"` : ''}>`,
      ...(name ? [el('title', {}, escapeXml(name))] : []),
      ...parts,
      '</g>'
    )
  }

  // Edge labels (Vue Flow's EdgeLabelRenderer), such as the coupling-conflict badge, are HTML too.
  const labelParts = []
  for (const label of root.querySelectorAll('.vue-flow__edge-labels > *')) walk(label, label, labelParts)

  if (bounds.empty) return null

  // ── Document ──────────────────────────────────────────────────────────
  const x = bounds.minX - padding
  const y = bounds.minY - padding
  const width = bounds.maxX - bounds.minX + 2 * padding
  const height = bounds.maxY - bounds.minY + 2 * padding

  let backdrop = null
  if (background === 'auto') {
    for (let current = root; current && !backdrop; current = current.parentElement) {
      backdrop = colour(win.getComputedStyle(current).backgroundColor)
    }
    backdrop ??= colour(win.getComputedStyle(doc.body).backgroundColor)
  } else if (background) {
    backdrop = colour(background)
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="${num(x)} ${num(y)} ${num(width)} ${num(height)}" width="${num(width)}" height="${num(height)}">`,
    el('title', {}, escapeXml(title)),
    backdrop ? el('rect', { x, y, width, height, ...paintAttrs('fill', backdrop) }) : '',
    `<g id="edges">${edgeParts.join('')}</g>`,
    labelParts.length ? `<g id="edge-labels">${labelParts.join('')}</g>` : '',
    `<g id="nodes">${nodeParts.join('')}</g>`,
    '</svg>',
    '',
  ]
    .filter((line) => line !== '')
    .join('\n')
}
