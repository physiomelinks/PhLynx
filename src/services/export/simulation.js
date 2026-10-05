/**
 * Builds the `simulation.json` companion file used inside a Web OpenCOR OMEX
 * archive (see "simulation.json" in the enterocyte.omex example) directly
 * from the payload SimSettingsDialog.vue emits on @confirm:
 *
 *   { simulationSettings, plotConfig: { groups, selections, ... }, parameterScan: { selections } }
 *
 * Shapes this reads (as produced by SimSettingsDialog.vue's handleConfirm):
 *   plotConfig.groups     -> [{ id, name }]
 *   plotConfig.selections -> [{ key, nodeId, nodeName, variableName, units, type, plot, groupId }]
 *   parameterScan.selections -> [{ key, nodeId, nodeName, parameterName, units, type, min, default, max }]
 *
 * @param {object} plotConfig - The `plotConfig` field of SimSettingsDialog's confirm payload.
 * @param {object} parameterScan - The `parameterScan` field of SimSettingsDialog's confirm payload.
 * @param {object} supplementalData - extractVoiAndParametersFromModel's result: `{ voi, mappedParameters }`.
 *   `voi` (the time axis variable) is null for a model without ODEs.
 * @returns {string|null} The simulation.json text, or null when there is nothing to simulate.
 */
export function buildSimulationJson(plotConfig, parameterScan, supplementalData) {
  const voiInformation = supplementalData.voi
  const selections = plotConfig?.selections || []
  const scanSelections = parameterScan?.selections || []

  // Plots are over the VOI, so a model without one (no ODEs) gets no simulation.json.
  if (!voiInformation || (selections.length === 0 && scanSelections.length === 0)) {
    return null
  }

  const timeVariable = { id: formVoiVariableId(voiInformation), name: formVoiVariableName(voiInformation), units: voiInformation.units }

  const input = buildInput(scanSelections)
  const data = buildOutputData(selections, timeVariable)
  const plots = buildOutputPlots(plotConfig, selections, timeVariable)
  const parameters = buildParameters(scanSelections, supplementalData.mappedParameters)

  return JSON.stringify({
    input,
    output: { data, plots },
    parameters,
  })
}

export const SIM_STEPS = 30

// input: one entry per parameter-scan selection. id/name are both just the
// constant's own name (per spec: "id and name can just be the variable name").
function buildInput(scanSelections) {
  return scanSelections.map((sel) => {
    const stepValue = (sel.max - sel.min) / SIM_STEPS
    return {
      id: `id__${sel.nodeName}__${sel.parameterName}`,
      name: sel.parameterName,
      defaultValue: sel.default,
      minimumValue: sel.min,
      maximumValue: sel.max,
      stepValue: sel.step === null || sel.step === undefined ? stepValue : sel.step,
    }
  })
}

function formVoiVariableId(variableInfo) {
  return `voi__${variableInfo.componentName.toLowerCase()}__${variableInfo.name.toLowerCase()}`
}

function formVoiVariableName(variableInfo) {
  return `${variableInfo.componentName}/${variableInfo.name}`
}

function formDataVariableId(nodeName, variableName) {
  return `data__${nodeName.toLowerCase()}__${variableName.toLowerCase()}`
}

// output.data: one entry per plotted variable ("instance name/variable name"),
// plus the shared time axis — unless a plotted variable is already literally
// named "time", in which case that one is used instead of adding a duplicate.
function buildOutputData(selections, timeVariable) {
  const data = selections.map((sel) => ({
    id: formDataVariableId(sel.nodeName, sel.variableName),
    name: `${sel.nodeName}/${sel.variableName}`,
  }))

  data.push({id: timeVariable.id, name: timeVariable.name})

  return data
}

// output.plots: one entry per subplot group. Built off the flat `selections`
// list (grouped by groupId here) rather than plotConfig.groupedSelections, so
// this stays correct even in the edge case where a variable's group was
// deleted and it ended up without one — those fall into a trailing
// "ungrouped" plot instead of silently being dropped.
function buildOutputPlots(plotConfig, selections, timeVariable) {
  const groupOrder = (plotConfig?.groups || []).map((group) => group.id)
  const groupNameMap = new Map((plotConfig?.groups || []).map((group) => [group.id, group.name]))
  const UNGROUPED = '__ungrouped__'

  const byGroup = new Map()
  for (const sel of selections) {
    const groupKey = sel.groupId || UNGROUPED
    if (!byGroup.has(groupKey)) byGroup.set(groupKey, [])
    byGroup.get(groupKey).push(sel)
  }

  const orderedGroupKeys = [
    ...groupOrder.filter((id) => byGroup.has(id)),
    ...Array.from(byGroup.keys()).filter((key) => !groupOrder.includes(key)),
  ]

  return orderedGroupKeys
    .map((groupKey) => byGroup.get(groupKey))
    .filter((groupSelections) => groupSelections.length > 0)
    .map(([first, ...rest]) => ({
      xValue: timeVariable.id,
      yValue: formDataVariableId(first.nodeName, first.variableName),
      name: `${first.nodeName}/${first.variableName}`,
      additionalTraces: rest.map((sel) => ({
        xValue: timeVariable.id,
        yValue: formDataVariableId(sel.nodeName, sel.variableName),
        name: `${sel.nodeName}/${sel.variableName}`,
      })),
      // Currently this is a lie, because of the bug in libCellML we don't know the units of the time axis variable. Once that is fixed, this can be restored to the correct value.
      // xAxisTitle: `${timeVariable.name} (${timeVariable.units})`,
      xAxisTitle: '',
      yAxisTitle: '',
    }))
}

// parameters: node-qualified constant name -> the id used for it in `input`
// above. Per spec this is simplified to just reuse the constant's own name
// (rather than inventing a separate short alias, as the example archive does).
function buildParameters(scanSelections, mappedParameters) {
  return scanSelections.map((sel) => {
    const sourceName = `${sel.nodeName}/${sel.parameterName}`
    const mapped = mappedParameters[sourceName]
    if (!mapped) {
      console.warn(`No mapped parameter found for ${sourceName}. This may indicate a problem with the CellML model or the parameter scan configuration.`)
    }
    const parameterName = mapped ? mapped.name : sel.parameterName
    const componentName = mapped ? mapped.componentName : sel.nodeName
    return {
      name: `${componentName}/${parameterName}`,
      value: `id__${sel.nodeName}__${sel.parameterName}`,
    }
  })
}
