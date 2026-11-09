/**
 * What the physiological view plots of its selection: a flux site's flows, a storage site's amounts and a
 * membrane's potential, read from the side-cars alone. Nothing is guessed: an unannotated variable is never
 * plotted, and an instance without annotations plots nothing.
 */

import { displayLabel } from '../annotations/labels.js'
import { locationText } from '../annotations/display.js'
import { OPB } from '../annotations/iris.js'

/** The selection plot's group id, apart from the workspace's `plot-<n>` ones. */
export const SELECTION_PLOT_ID = '__selection__'

/** At most this many variables are plotted, so a large selection stays readable. */
export const SELECTION_PLOT_LIMIT = 12

/** The annotated properties each role plots, in the order they're plotted. */
const PROPERTIES_BY_ROLE = {
  // Flux sites: what they carry.
  membraneProtein: [OPB.molarFlowRate, OPB.amountDensityFlowRate, OPB.chargeFlowRate],
  cytosolic: [OPB.molarFlowRate, OPB.amountDensityFlowRate, OPB.chargeFlowRate],
  // Storage sites: what they hold.
  cytosol: [OPB.concentration, OPB.amount, OPB.fluidVolume],
  region: [OPB.concentration, OPB.amount, OPB.fluidVolume],
  membrane: [OPB.electricalPotential, OPB.chargeFlowRate],
}

/**
 * Names a sidecar location for a label, or null for the instance's own place.
 *
 * @param {string|null} location
 * @returns {string|null}
 */
function placeOf(location) {
  if (!location || location === 'self') return null
  return location.startsWith('self+') ? displayLabel(location.slice('self+'.length)) : locationText(location)
}

/**
 * Labels an annotated variable, e.g. 'NKA · Na⁺ molar flow rate (cytoplasm)'.
 *
 * @param {string} nodeName
 * @param {{ property: string, species?: string[], location?: string|null }} annotation
 * @returns {string}
 */
export function selectionLabel(nodeName, { property, species = [], location = null }) {
  const what = [...species.map(displayLabel), displayLabel(property)].join(' ')
  const place = placeOf(location)
  return `${nodeName} · ${what}${place ? ` (${place})` : ''}`
}

/**
 * Gives the variables a selected instance plots: its annotated flows for a flux site, its concentrations
 * (then amounts and volume) for a storage site, its potential (and charge flow) for a membrane.
 *
 * @param {{ id: string, data?: { name?: string } }} node
 * @param {string} role - From resolveBioRole.
 * @param {Object|null} sidecar - From parseSidecar.
 * @returns {Array<{ nodeId: string, variable: string, label: string }>}
 */
export function selectionPlotVariables(node, role, sidecar) {
  const properties = PROPERTIES_BY_ROLE[role]
  if (!properties || !sidecar?.variables?.length) return []
  const rank = (property) => properties.indexOf(property)
  const name = node.data?.name ?? node.id
  return sidecar.variables
    .map((annotation, index) => ({ annotation, index }))
    .filter(({ annotation }) => annotation.variable && rank(annotation.property) >= 0)
    .sort((a, b) => rank(a.annotation.property) - rank(b.annotation.property) || a.index - b.index)
    .map(({ annotation }) => ({
      nodeId: node.id,
      variable: annotation.variable,
      label: selectionLabel(name, annotation),
    }))
}

/**
 * Builds the selection plot: the selected instances' variables on one plot of its own, never saved. Variables
 * chosen some other way, as a species token's are, can be given as entries, plotted first.
 *
 * @param {Array<Object>} nodes - The selected instances.
 * @param {{ roleOf: (node: Object) => string, sidecarOf: (node: Object) => Object|null, limit?: number,
 *   entries?: Array<{ nodeId: string, nodeName?: string, variable: string, label: string }> }} options
 * @returns {{ plotConfig: { groups: Array, selections: Array }, total: number, unannotated: string[] }} `total`
 *   counts every variable found, of which at most `limit` are plotted; `unannotated` names the instances with
 *   nothing to plot.
 */
export function buildSelectionPlot(nodes, { roleOf, sidecarOf, limit = SELECTION_PLOT_LIMIT, entries = [] }) {
  const seen = new Set()
  const variables = []
  const unannotated = []
  const add = (entry, nodeName) => {
    const key = `${entry.nodeId}::${entry.variable}`
    if (seen.has(key)) return
    seen.add(key)
    variables.push({ ...entry, key, nodeName })
  }
  for (const entry of entries) add(entry, entry.nodeName ?? entry.nodeId)
  for (const node of nodes) {
    const found = selectionPlotVariables(node, roleOf(node), sidecarOf(node))
    if (!found.length) unannotated.push(node.data?.name ?? node.id)
    for (const entry of found) add(entry, node.data?.name ?? node.id)
  }
  const selections = variables.slice(0, limit).map(({ key, nodeId, nodeName, variable, label }) => ({
    key,
    nodeId,
    nodeName,
    variableName: variable,
    label,
    plot: true,
    groupId: SELECTION_PLOT_ID,
  }))
  return {
    plotConfig: { groups: [{ id: SELECTION_PLOT_ID, name: 'Selection' }], selections },
    total: variables.length,
    unannotated,
  }
}
