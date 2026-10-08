import { defineStore } from 'pinia'
import { computed, markRaw, ref } from 'vue'

import {
  MAXIMUM_PROTOCOL_NAME_LENGTH,
  OBS_DATA_FORMAT,
  buildObsDataLocation,
  listObsDataExtras,
  nameObsDataFile,
  readObsDataParts,
  serialiseObsData,
  slugifyProtocolName,
} from '../services/protocol/obsDataDocument'
import { ensureProtocol } from '../services/protocol/protocolEditing'
import { planDrivers } from '../services/protocol/libopencorEngine/protocolDrivers'
import { findCircAutogenLimits } from '../services/protocol/protocolCompatibility'
import { readProtocolInfo } from '../services/protocol/protocolModel'
import { validateProtocolInfo } from '../services/protocol/protocolValidation'
import { cyrb53 } from '../utils/misc'
import { useOmexStore } from './omexStore'
import { useSimulationResultsStore } from './simulationResultsStore'

// The experiment to show for every experiment at once.
export const ALL_EXPERIMENTS = -1

/**
 * Gives the folder part of a file's location, with its trailing "/", or nothing at the archive's root.
 *
 * @param {string} location
 * @returns {string}
 */
const folderOf = (location) => location.slice(0, location.lastIndexOf('/') + 1)

/**
 * The workspace's experiment protocols, each an obs_data.json its archive carries (CUFLynx and circulatory autogen's
 * format), which of them is active and whether play runs it. The active protocol is the one CUFLynx would pick, the
 * first in the archive's order, so choosing one moves its file ahead of the others. Never saved itself: the obs_data
 * files are saved, in order, with the archive's other files.
 */
export const useProtocolStore = defineStore('protocol', () => {
  const omexStore = useOmexStore()
  /** Whether play runs the protocol rather than the settings' time course; the session's choice. */
  const isProtocolMode = ref(false)
  /** The experiment whose results are shown, by index, or ALL_EXPERIMENTS. */
  const activeExperiment = ref(0)
  /** Whether the values the protocol set are plotted after the results. */
  const isShowingInputs = ref(false)

  /** The model's name, which obs_data files are named after. */
  const modelStem = computed(() => (omexStore.archiveName || omexStore.cellmlFileName).replace(/\.[^.]*$/, ''))
  /** The archive's obs_data files, in the order CUFLynx would pick them. */
  const candidates = computed(() => listObsDataExtras(omexStore.preservedExtras))
  /** The protocols to choose from, each as `{ location, name }`, the active one first. */
  const protocols = computed(() => candidates.value.map(({ entry }) => ({ location: entry.location, name: nameObsDataFile(entry.location, modelStem.value) })))
  /** The active protocol's obs_data file, or null. */
  const source = computed(() => candidates.value[0] ?? null)
  /** The active protocol, as `{ location, name }`, or null. */
  const activeProtocol = computed(() => protocols.value[0] ?? null)
  /** The file's protocol_info, or null when it has none or can't be read. */
  const protocolInfo = computed(() => (source.value?.document === undefined ? null : readObsDataParts(source.value.document).protocolInfo))
  /** Whether the workspace has a protocol to run. */
  const hasProtocol = computed(() => protocolInfo.value != null)
  /** `{ errors, warnings }` from checking the protocol; an unreadable file is an error. */
  const validation = computed(() => {
    if (source.value?.parseError) return { errors: [`${source.value.entry.location} isn't valid JSON: ${source.value.parseError.message}`], warnings: [] }
    if (!hasProtocol.value) return { errors: [], warnings: [] }
    const { errors, warnings, protocolInfo: valid } = validateProtocolInfo(protocolInfo.value)
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
  /** The protocol's inputs to a run, to tell when its results have gone stale. */
  const signature = computed(() => (isActive.value ? String(cyrb53(JSON.stringify(protocolInfo.value))) : ''))

  /**
   * Shows an experiment's results.
   *
   * @param {number} index
   */
  function setActiveExperiment(index) {
    activeExperiment.value = index
  }

  /**
   * Goes back to the first experiment when another protocol becomes the active one, in the results shown too, so
   * the experiment picker and the plots name the same experiment.
   */
  function showFirstExperiment() {
    activeExperiment.value = 0
    useSimulationResultsStore().showExperiment(0)
  }

  /**
   * Saves an edited obs_data document into the archive's files: over the one read, or as a new file named after the
   * model.
   *
   * @param {Object|Array} document
   */
  function saveDocument(document) {
    const location = source.value?.entry.location ?? buildObsDataLocation(modelStem.value)
    omexStore.writeExtra({ location, format: source.value?.entry.format ?? OBS_DATA_FORMAT, payload: serialiseObsData(document) })
  }

  /**
   * Says what is wrong with a name for a protocol, if anything: it needs letters or digits, mustn't read as a
   * parameter file's, which CUFLynx passes over, and must be unlike every other protocol's.
   *
   * @param {string} name
   * @param {string} [location] - The protocol being renamed, which may keep its name.
   * @returns {string} Empty when the name will do.
   */
  function checkProtocolName(name, location) {
    const slug = slugifyProtocolName(name)
    if (!slug) return 'Give the protocol a name.'
    if (String(name).trim().length > MAXIMUM_PROTOCOL_NAME_LENGTH) return `Keep the name to ${MAXIMUM_PROTOCOL_NAME_LENGTH} characters or fewer.`
    if (/param/i.test(slug)) return 'A protocol’s name can’t contain “param”.'
    const next = locateProtocol(name, location)
    const taken = nameObsDataFile(next, modelStem.value).toLowerCase()
    const others = protocols.value.filter((protocol) => protocol.location !== location)
    if (others.some((protocol) => protocol.name.toLowerCase() === taken)) return 'Another protocol has this name.'
    if (omexStore.preservedExtras.some((extra) => extra.location !== location && extra.location.toLowerCase() === next.toLowerCase())) return 'Another file has this name.'
    return ''
  }

  /**
   * Gives the name a protocol is shown with once given a name: its file keeps only some characters, and underscores
   * read as spaces.
   *
   * @param {string} name
   * @returns {string}
   */
  const nameProtocol = (name) => nameObsDataFile(buildObsDataLocation(modelStem.value, name), modelStem.value)

  /**
   * Gives the location of a protocol's file by its name, in the folder of the one it replaces or comes from.
   *
   * @param {string} name
   * @param {string} [near] - A location whose folder to use; the active protocol's when not given.
   * @returns {string}
   */
  function locateProtocol(name, near = source.value?.entry.location ?? '') {
    return `${folderOf(near)}${buildObsDataLocation(modelStem.value, name)}`
  }

  /**
   * Throws when a name won't do for a protocol.
   *
   * @param {string} name
   * @param {string} [location]
   * @throws {Error}
   */
  function assertProtocolName(name, location) {
    const problem = checkProtocolName(name, location)
    if (problem) throw new Error(problem)
  }

  /**
   * Names a protocol found by its contents with "obs", before another joins it: CUFLynx takes files named with
   * "obs" first, so it would otherwise be passed over.
   */
  function nameSourceAsObsData() {
    const location = source.value?.entry.location
    if (!location || /obs/i.test(location.split('/').at(-1))) return
    const next = location.replace(/(\.json)?$/i, '_obs_data.json')
    if (!omexStore.preservedExtras.some((extra) => extra.location === next)) omexStore.renameExtra(location, next)
  }

  /**
   * Makes a protocol the active one, which play runs and the Protocol dialog edits, by moving its file ahead of the
   * other protocols'.
   *
   * @param {string} location
   */
  function chooseProtocol(location) {
    const target = candidates.value.find(({ entry }) => entry.location === location)
    if (!target) return
    const first = candidates.value[0]
    if (first.entry.location !== location) omexStore.moveExtra(location, first.index)
    showFirstExperiment()
  }

  /**
   * Adds an empty protocol and makes it the active one.
   *
   * @param {string} name
   * @returns {string} Its file's location.
   * @throws {Error} When the name won't do (see checkProtocolName).
   */
  function createProtocol(name) {
    assertProtocolName(name)
    nameSourceAsObsData()
    const location = locateProtocol(name)
    omexStore.writeExtra({ location, format: OBS_DATA_FORMAT, payload: serialiseObsData(ensureProtocol(null)) })
    chooseProtocol(location)
    return location
  }

  /**
   * Copies a protocol, with its observations, as another and makes the copy the active one.
   *
   * @param {string} location
   * @param {string} name - The copy's name.
   * @returns {string} The copy's location.
   * @throws {Error} When the name won't do (see checkProtocolName).
   */
  function duplicateProtocol(location, name) {
    const original = omexStore.preservedExtras.find((extra) => extra.location === location)
    if (!original) throw new Error(`${location} isn’t in the workspace.`)
    assertProtocolName(name)
    nameSourceAsObsData()
    const copied = locateProtocol(name, location)
    const payload = original.payload instanceof ArrayBuffer ? original.payload.slice(0) : original.payload
    omexStore.writeExtra({ location: copied, format: original.format, payload })
    chooseProtocol(copied)
    return copied
  }

  /**
   * Renames a protocol, which renames its file, in the same folder and place.
   *
   * @param {string} location
   * @param {string} name
   * @returns {string} Its file's new location.
   * @throws {Error} When the name won't do (see checkProtocolName).
   */
  function renameProtocol(location, name) {
    assertProtocolName(name, location)
    const renamed = locateProtocol(name, location)
    omexStore.renameExtra(location, renamed)
    return renamed
  }

  /**
   * Removes a protocol and its observations. The next protocol becomes the active one when it was.
   *
   * @param {string} location
   */
  function removeProtocol(location) {
    if (source.value?.entry.location === location) showFirstExperiment()
    omexStore.removeExtra(location)
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
    protocols,
    activeProtocol,
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
    checkProtocolName,
    nameProtocol,
    chooseProtocol,
    createProtocol,
    duplicateProtocol,
    renameProtocol,
    removeProtocol,
    resetState,
  }
})
