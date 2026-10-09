import { defineStore } from 'pinia'
import { computed, markRaw, ref } from 'vue'
import {
  OBS_DATA_FORMAT,
  buildObsDataLocation,
  findCircAutogenLimits,
  findObsDataExtra,
  readObsDataParts,
  readProtocolInfo,
  serialiseObsData,
  validateProtocolInfo,
} from '@physiomelinks/protocol-kit'

import { planDrivers } from '../services/protocol/libopencorEngine/protocolDrivers'
import { listFeatureOperands } from '../services/simulation/protocolFeatures'
import { cyrb53 } from '../utils/misc'
import { useOmexStore } from './omexStore'

// The experiment to show for every experiment at once.
export const ALL_EXPERIMENTS = -1

/**
 * Warns of what PhLynx ignores in a protocol_info: offline_pre_time, which only calibration uses.
 *
 * @param {Object} protocolInfo
 * @returns {string[]}
 */
export const findIgnoredSettings = (protocolInfo) =>
  protocolInfo?.offline_pre_time != null ? ['offline_pre_time is only used for calibration, so PhLynx ignores it.'] : []

/**
 * The workspace's experiment protocol, read from the obs_data.json its archive carries (CUFLynx and circulatory
 * autogen's format), and whether play runs it. Never saved itself: the obs_data file is saved with the archive's
 * other files.
 */
export const useProtocolStore = defineStore('protocol', () => {
  const omexStore = useOmexStore()
  /** Whether play runs the protocol rather than the settings' time course; the session's choice. */
  const isProtocolMode = ref(false)
  /** The experiment whose results are shown, by index, or ALL_EXPERIMENTS. */
  const activeExperiment = ref(0)
  /** Whether the values the protocol set are plotted after the results. */
  const isShowingInputs = ref(false)

  /** The obs_data file found among the archive's files, or null. */
  const source = computed(() => findObsDataExtra(omexStore.preservedExtras))
  /** The file's protocol_info, or null when it has none or can't be read. */
  const protocolInfo = computed(() => (source.value?.document === undefined ? null : readObsDataParts(source.value.document).protocolInfo))
  /** Whether the workspace has a protocol to run. */
  const hasProtocol = computed(() => protocolInfo.value != null)
  /** `{ errors, warnings }` from checking the protocol; an unreadable file is an error. */
  const validation = computed(() => {
    if (source.value?.parseError) return { errors: [`${source.value.entry.location} isn't valid JSON: ${source.value.parseError.message}`], warnings: [] }
    if (!hasProtocol.value) return { errors: [], warnings: [] }
    const { errors, warnings: checked, protocolInfo: valid } = validateProtocolInfo(protocolInfo.value)
    const warnings = [...checked, ...findIgnoredSettings(protocolInfo.value)]
    // What CUFLynx couldn't run, though PhLynx can.
    return { errors, warnings: valid ? [...warnings, ...findCircAutogenLimits(readProtocolInfo(valid))] : warnings }
  })
  /** The protocol as experiments of sub-experiments (see readProtocolInfo), or null when it can't run. */
  const view = computed(() => {
    if (!hasProtocol.value) return null
    const { errors, protocolInfo: valid } = validateProtocolInfo(protocolInfo.value)
    return errors.length ? null : markRaw(readProtocolInfo(valid))
  })
  /** The drivers its ramps and traces need, written into the model (see planDrivers). */
  const drivers = computed(() => (view.value ? markRaw(planDrivers(view.value)) : []))
  /** The drivers as written into the model, to tell when it needs flattening again. */
  const driverSignature = computed(() => (drivers.value.length ? String(cyrb53(JSON.stringify(drivers.value))) : ''))
  /** Whether play runs the protocol. */
  const isActive = computed(() => isProtocolMode.value && (hasProtocol.value || !!source.value?.parseError))
  /**
   * Whether the sliders are off: a protocol runs the model as it is, so their values wait, untouched, for the time
   * course. What every slider and run goes by.
   */
  const areSlidersOff = computed(() => isActive.value)
  /** The protocol's inputs to a run, and what its features record, to tell when its results have gone stale. */
  const signature = computed(() =>
    isActive.value ? String(cyrb53(JSON.stringify([protocolInfo.value, listFeatureOperands(source.value?.document)]))) : ''
  )

  /**
   * Shows an experiment's results.
   *
   * @param {number} index
   */
  function setActiveExperiment(index) {
    activeExperiment.value = index
  }

  /**
   * Saves an edited obs_data document into the archive's files: over the one read, or as a new file named after the
   * model.
   *
   * @param {Object|Array} document
   */
  function saveDocument(document) {
    const location = source.value?.entry.location ?? buildObsDataLocation((omexStore.archiveName || omexStore.cellmlFileName).replace(/\.[^.]*$/, ''))
    omexStore.writeExtra({ location, format: source.value?.entry.format ?? OBS_DATA_FORMAT, payload: serialiseObsData(document) })
  }

  function resetState() {
    isProtocolMode.value = false
    activeExperiment.value = 0
    isShowingInputs.value = false
  }

  return {
    isProtocolMode,
    activeExperiment,
    isShowingInputs,
    source,
    protocolInfo,
    hasProtocol,
    validation,
    view,
    drivers,
    driverSignature,
    isActive,
    areSlidersOff,
    signature,
    setActiveExperiment,
    saveDocument,
    resetState,
  }
})
