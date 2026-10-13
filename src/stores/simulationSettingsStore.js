import { defineStore } from 'pinia'
import { ref } from 'vue'

import { BASELINE_SIMULATION_SETTINGS } from '../utils/constants'

export function cloneSimulationSettings(settings = {}) {
  return {
    ...BASELINE_SIMULATION_SETTINGS,
    ...settings,
    // A sweep of one parameter, and perhaps its curves' (see services/simulation/sweep.js), copied so a draft of it is
    // its own.
    ...(settings?.sweep && {
      sweep: { ...settings.sweep, ...(settings.sweep.family && { family: { ...settings.sweep.family, values: [...settings.sweep.family.values] } }) },
    }),
  }
}

function clonePlainObject(value) {
  if (!value || typeof value !== 'object') return {}
  return JSON.parse(JSON.stringify(value))
}

export const useSimulationSettingsStore = defineStore('simulationSettings', () => {
  const simulationSettings = ref(cloneSimulationSettings())
  const plotConfig = ref({})
  const parameterScanConfig = ref({})

  function resetState() {
    simulationSettings.value = cloneSimulationSettings()
    plotConfig.value = {}
    parameterScanConfig.value = {}
  }

  function setSimulationSettings(nextSettings) {
    simulationSettings.value = cloneSimulationSettings(nextSettings)
  }

  function setPlotConfig(nextPlotConfig) {
    plotConfig.value = clonePlainObject(nextPlotConfig)
  }

  function setParameterScanConfig(nextParameterScanConfig) {
    parameterScanConfig.value = clonePlainObject(nextParameterScanConfig)
  }

  function loadState(state) {
    if (!state) {
      resetState()
      return
    }

    setSimulationSettings(state.simulationSettings)
    setPlotConfig(state.plotConfig)
    setParameterScanConfig(state.parameterScanConfig)
  }

  function getState() {
    return {
      simulationSettings: cloneSimulationSettings(simulationSettings.value),
      plotConfig: clonePlainObject(plotConfig.value),
      parameterScanConfig: clonePlainObject(parameterScanConfig.value),
    }
  }

  return {
    simulationSettings,
    plotConfig,
    parameterScanConfig,
    resetState,
    setSimulationSettings,
    setPlotConfig,
    setParameterScanConfig,
    loadState,
    getState,
  }
})
