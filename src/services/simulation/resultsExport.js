/**
 * Turns the plotted results into files: a CSV of every plotted series, and one PNG of every chart.
 */

/**
 * Gets the columns of the plotted results: the variable of integration, then each plotted series once,
 * in chart order, even when it is on more than one chart.
 *
 * @param {{label: string, unit: string, values: Float64Array}} xAxis
 * @param {Array<{unit: string, series: Array<{key: string, label: string, values: Float64Array}>}>} charts
 * @returns {Array<{key: string, label: string, unit: string, values: Float64Array}>}
 */
export function collectResultColumns(xAxis, charts) {
  const columns = [{ key: '__voi__', label: xAxis.label, unit: xAxis.unit, values: xAxis.values }]
  const seen = new Set()
  for (const chart of charts) {
    for (const series of chart.series) {
      if (seen.has(series.key)) continue
      seen.add(series.key)
      columns.push({ key: series.key, label: series.label, unit: chart.unit, values: series.values })
    }
  }
  return columns
}

/**
 * Quotes a CSV field when it holds a comma, a quote or a line break.
 *
 * @param {string} field
 * @returns {string}
 */
const csvField = (field) => (/[",\r\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field)

/**
 * Names a column with its unit, as the CSV header and the table show it.
 *
 * @param {{label: string, unit: string}} column
 * @returns {string}
 */
export const columnHeader = ({ label, unit }) => (unit ? `${label} (${unit})` : label)

/**
 * Writes the columns as CSV: a header of names and units, then one row per output point, with every value
 * at full precision.
 *
 * @param {Array<{label: string, unit: string, values: Float64Array}>} columns
 * @returns {string}
 */
export function buildResultsCsv(columns) {
  const pointCount = Math.min(...columns.map((column) => column.values.length))
  const lines = [columns.map((column) => csvField(columnHeader(column))).join(',')]
  // A gap, where one experiment shown with others has no point, is an empty field.
  for (let i = 0; i < pointCount; i++) lines.push(columns.map((column) => (column.values[i] == null ? '' : String(column.values[i]))).join(','))
  return `${lines.join('\r\n')}\r\n`
}

const PADDING = 16
const TITLE_HEIGHT = 22
const LEGEND_HEIGHT = 22
const SWATCH = 10
const GAP = 12

/**
 * Splits a legend into lines that fit a width.
 *
 * @param {CanvasRenderingContext2D} context - Set to the legend's font.
 * @param {Array<{label: string, colour: string}>} legend
 * @param {number} width
 * @returns {Array<Array<{label: string, colour: string, left: number}>>}
 */
function layOutLegend(context, legend, width) {
  const lines = [[]]
  let left = 0
  for (const item of legend) {
    const itemWidth = SWATCH + 4 + context.measureText(item.label).width
    if (left > 0 && left + itemWidth > width) {
      lines.push([])
      left = 0
    }
    lines.at(-1).push({ ...item, left })
    left += itemWidth + GAP
  }
  return lines
}

/**
 * Draws charts one under another on one canvas, each with its title above and a legend of its series
 * below, since uPlot draws its legend as HTML rather than on its canvas.
 *
 * @param {Array<{title: string, canvas: HTMLCanvasElement, legend: Array<{label: string, colour: string}>}>} charts
 * @param {{background: string, text: string, font?: string}} theme
 * @returns {HTMLCanvasElement}
 */
export function composeChartsImage(charts, { background, text, font = 'system-ui, -apple-system, "Segoe UI", sans-serif' }) {
  // The charts' canvases are drawn at the screen's pixel ratio; the image keeps it.
  const ratio = Math.max(1, ...charts.map((chart) => chart.canvas.width / (chart.canvas.clientWidth || chart.canvas.width)))
  const widths = charts.map((chart) => chart.canvas.width / ratio)
  const heights = charts.map((chart) => chart.canvas.height / ratio)
  const width = Math.ceil(Math.max(...widths) + 2 * PADDING)

  const image = document.createElement('canvas')
  const context = image.getContext('2d')
  const legendFont = `11px ${font}`
  context.font = legendFont
  const legends = charts.map((chart) => layOutLegend(context, chart.legend, width - 2 * PADDING))
  const height = Math.ceil(
    PADDING +
      charts.reduce((total, _, index) => total + TITLE_HEIGHT + heights[index] + legends[index].length * LEGEND_HEIGHT + GAP, 0) -
      GAP +
      PADDING
  )

  // Sizing a canvas resets its drawing state.
  image.width = Math.round(width * ratio)
  image.height = Math.round(height * ratio)
  context.scale(ratio, ratio)
  context.fillStyle = background
  context.fillRect(0, 0, width, height)
  context.textBaseline = 'middle'

  let top = PADDING
  charts.forEach((chart, index) => {
    context.fillStyle = text
    context.font = `600 13px ${font}`
    context.fillText(chart.title, PADDING, top + TITLE_HEIGHT / 2)
    top += TITLE_HEIGHT

    context.drawImage(chart.canvas, PADDING, top, widths[index], heights[index])
    top += heights[index]

    context.font = legendFont
    for (const line of legends[index]) {
      for (const { label, colour, left } of line) {
        context.fillStyle = colour
        context.fillRect(PADDING + left, top + (LEGEND_HEIGHT - SWATCH) / 2, SWATCH, SWATCH)
        context.fillStyle = text
        context.fillText(label, PADDING + left + SWATCH + 4, top + LEGEND_HEIGHT / 2)
      }
      top += LEGEND_HEIGHT
    }
    top += GAP
  })
  return image
}
