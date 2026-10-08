import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useOmexStore } from '../../../src/stores/omexStore.js'
import { useProtocolStore } from '../../../src/stores/protocolStore.js'
import { useSimulationResultsStore } from '../../../src/stores/simulationResultsStore.js'

const PROTOCOL = { pre_times: [0], sim_times: [[1]], params_to_change: { 'a/k': [[2]] } }

/**
 * Gives the workspace's archive a file.
 *
 * @param {string} location
 * @param {string} text
 */
function addExtra(location, text) {
  useOmexStore().setArchive({ extras: [{ location, format: 'application/json', payload: new TextEncoder().encode(text).buffer }] })
}

describe('protocolStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it("reads the protocol of the archive's obs_data file", () => {
    const store = useProtocolStore()
    expect(store.hasProtocol).toBe(false)

    addExtra('model_obs_data.json', JSON.stringify({ protocol_info: PROTOCOL, data_items: [] }))
    expect(store.hasProtocol).toBe(true)
    expect(store.validation).toEqual({ errors: [], warnings: [] })
    expect(store.view.controls.map(({ parameter }) => parameter)).toEqual(['a/k'])
  })

  it('runs the protocol only once it is turned on, and signs it while it is', () => {
    addExtra('model_obs_data.json', JSON.stringify({ protocol_info: PROTOCOL }))
    const store = useProtocolStore()
    expect([store.isActive, store.signature]).toEqual([false, ''])

    store.isProtocolMode = true
    expect(store.isActive).toBe(true)
    expect(store.signature).not.toBe('')
    store.resetState()
    expect(store.isProtocolMode).toBe(false)
  })

  it("reports a protocol that can't run, and an obs_data file that isn't JSON", () => {
    const store = useProtocolStore()
    addExtra('model_obs_data.json', JSON.stringify({ protocol_info: { ...PROTOCOL, sim_times: [[0]] } }))
    expect(store.validation.errors).toEqual(['Experiment 1, sub-experiment 1 needs a length greater than 0.'])
    expect(store.view).toBeNull()

    addExtra('broken_obs_data.json', '{')
    expect(store.hasProtocol).toBe(false)
    expect(store.validation.errors[0]).toMatch(/^broken_obs_data.json isn't valid JSON: /)
  })

  it('saves an edited document over the file read, or as a new one named after the model', () => {
    const store = useProtocolStore()
    const omexStore = useOmexStore()
    omexStore.cellmlFileName = 'heart.cellml'
    store.saveDocument({ protocol_info: PROTOCOL })
    expect(omexStore.preservedExtras.map(({ location, format }) => [location, format])).toEqual([['heart_obs_data.json', 'application/json']])
    expect(store.view.controls[0].parameter).toBe('a/k')

    store.saveDocument({ protocol_info: { ...PROTOCOL, params_to_change: { 'a/g': [[1]] } } })
    expect(omexStore.preservedExtras).toHaveLength(1)
    expect(store.view.controls[0].parameter).toBe('a/g')
  })

  describe('several protocols', () => {
    const encode = (value) => new TextEncoder().encode(JSON.stringify(value)).buffer
    const read = (entry) => JSON.parse(new TextDecoder().decode(entry.payload))
    const withK = (k) => ({ protocol_info: { ...PROTOCOL, params_to_change: { 'a/k': [[k]] } }, data_items: [{ k }] })

    /**
     * Gives the workspace's archive a model and files.
     *
     * @param {Array<[string, *]>} files - Each file's location and JSON contents.
     */
    function setFiles(files) {
      useOmexStore().setArchive({
        cellmlFileName: 'heart.cellml',
        extras: files.map(([location, value]) => ({ location, format: 'application/json', payload: encode(value) })),
      })
    }

    const locations = () => useOmexStore().preservedExtras.map(({ location }) => location)

    it('lists them, the first in the archive being the active one, as CUFLynx picks it', () => {
      setFiles([
        ['notes.json', { note: 1 }],
        ['heart_obs_data.json', withK(1)],
        ['heart_Long_pacing_obs_data.json', withK(2)],
      ])
      const store = useProtocolStore()
      expect(store.protocols).toEqual([
        { location: 'heart_obs_data.json', name: 'heart' },
        { location: 'heart_Long_pacing_obs_data.json', name: 'Long pacing' },
      ])
      expect(store.activeProtocol).toEqual(store.protocols[0])
      expect(store.source.entry.location).toBe('heart_obs_data.json')
      expect(store.view.controls[0].cells[0][0].value).toBe(1)
    })

    it('chooses one by moving its file ahead of the others, starting from its first experiment', () => {
      setFiles([
        ['notes.json', { note: 1 }],
        ['heart_obs_data.json', withK(1)],
        ['other.json', { note: 2 }],
        ['heart_Long_pacing_obs_data.json', withK(2)],
      ])
      const store = useProtocolStore()
      store.isProtocolMode = true
      const before = store.signature
      store.setActiveExperiment(1)
      store.chooseProtocol('heart_Long_pacing_obs_data.json')
      expect(locations()).toEqual(['notes.json', 'heart_Long_pacing_obs_data.json', 'heart_obs_data.json', 'other.json'])
      expect(store.activeProtocol.name).toBe('Long pacing')
      expect(store.activeExperiment).toBe(0)
      expect(store.signature).not.toBe(before)
      // The order is what a saved workspace keeps.
      expect(useOmexStore().getState().preservedExtras.map(({ location }) => location)).toEqual(locations())

      store.chooseProtocol('missing.json')
      expect(store.activeProtocol.name).toBe('Long pacing')
    })

    it('shows the first experiment of the results too, when the active protocol changes', () => {
      setFiles([
        ['heart_obs_data.json', withK(1)],
        ['heart_Long_pacing_obs_data.json', withK(2)],
      ])
      const store = useProtocolStore()
      const showExperiment = vi.spyOn(useSimulationResultsStore(), 'showExperiment')
      store.setActiveExperiment(1)
      store.chooseProtocol('heart_Long_pacing_obs_data.json')
      expect(showExperiment).toHaveBeenLastCalledWith(0)
      store.setActiveExperiment(1)
      showExperiment.mockClear()
      store.removeProtocol('heart_obs_data.json')
      expect(showExperiment).not.toHaveBeenCalled()
      expect(store.activeExperiment).toBe(1)
      store.removeProtocol('heart_Long_pacing_obs_data.json')
      expect(showExperiment).toHaveBeenLastCalledWith(0)
      expect(store.activeExperiment).toBe(0)
    })

    it('creates an empty protocol and makes it the active one', () => {
      setFiles([['heart_obs_data.json', withK(1)]])
      const store = useProtocolStore()
      const location = store.createProtocol('Long pacing')
      expect(location).toBe('heart_Long_pacing_obs_data.json')
      expect(store.protocols.map(({ name }) => name)).toEqual(['Long pacing', 'heart'])
      expect(store.hasProtocol).toBe(true)
      expect(store.view.controls).toEqual([])
    })

    it('refuses a name another protocol has, or one CUFLynx would pass over', () => {
      setFiles([
        ['heart_obs_data.json', withK(1)],
        ['heart_Long_pacing_obs_data.json', withK(2)],
      ])
      const store = useProtocolStore()
      expect(store.checkProtocolName('long  pacing')).toBe('Another protocol has this name.')
      expect(store.checkProtocolName('heart')).toBe('Another protocol has this name.')
      expect(store.checkProtocolName(' / ')).toBe('Give the protocol a name.')
      expect(store.checkProtocolName('Parameter sweep')).toBe('A protocol’s name can’t contain “param”.')
      expect(store.checkProtocolName('Long pacing', 'heart_Long_pacing_obs_data.json')).toBe('')
      expect(() => store.createProtocol('Long pacing')).toThrow('Another protocol has this name.')
      expect(locations()).toHaveLength(2)
    })

    it('refuses a name too long for a file, and tells how a name will be shown', () => {
      setFiles([['heart_obs_data.json', withK(1)]])
      const store = useProtocolStore()
      expect(store.checkProtocolName('a'.repeat(65))).toBe('Keep the name to 64 characters or fewer.')
      expect(store.checkProtocolName('a'.repeat(64))).toBe('')
      expect(store.nameProtocol('Low g_M')).toBe('Low g M')
      expect(store.nameProtocol('High M (x3)')).toBe('High M x3')
      expect(store.nameProtocol('Long pacing')).toBe('Long pacing')
    })

    it('duplicates a protocol with its observations, in its folder', () => {
      setFiles([
        ['heart_obs_data.json', withK(1)],
        ['folder/heart_b_obs_data.json', withK(2)],
      ])
      const store = useProtocolStore()
      const copied = store.duplicateProtocol('folder/heart_b_obs_data.json', 'b copy')
      expect(copied).toBe('folder/heart_b_copy_obs_data.json')
      expect(store.activeProtocol.location).toBe(copied)
      const extras = useOmexStore().preservedExtras
      expect(read(extras.find(({ location }) => location === copied))).toEqual(withK(2))
      expect(read(extras.find(({ location }) => location === 'folder/heart_b_obs_data.json'))).toEqual(withK(2))
    })

    it('renames a protocol in place, keeping it active', () => {
      setFiles([
        ['folder/heart_a_obs_data.json', withK(1)],
        ['heart_b_obs_data.json', withK(2)],
      ])
      const store = useProtocolStore()
      expect(store.renameProtocol('folder/heart_a_obs_data.json', 'Fast pacing')).toBe('folder/heart_Fast_pacing_obs_data.json')
      expect(locations()).toEqual(['folder/heart_Fast_pacing_obs_data.json', 'heart_b_obs_data.json'])
      expect(store.activeProtocol.name).toBe('Fast pacing')
      expect(() => store.renameProtocol('heart_b_obs_data.json', 'fast pacing')).toThrow('Another protocol has this name.')
    })

    it('removes a protocol, the next becoming the active one, and may leave none', () => {
      setFiles([
        ['heart_a_obs_data.json', withK(1)],
        ['heart_b_obs_data.json', withK(2)],
      ])
      const store = useProtocolStore()
      store.setActiveExperiment(1)
      store.removeProtocol('heart_a_obs_data.json')
      expect(store.activeProtocol.name).toBe('b')
      expect(store.activeExperiment).toBe(0)
      store.removeProtocol('heart_b_obs_data.json')
      expect(store.protocols).toEqual([])
      expect(store.hasProtocol).toBe(false)
    })

    it('names a protocol found by its contents with "obs" before adding another, so CUFLynx still sees it', () => {
      setFiles([['study.json', withK(1)]])
      const store = useProtocolStore()
      expect(store.protocols).toEqual([{ location: 'study.json', name: 'study' }])
      store.createProtocol('Second')
      expect(locations()).toEqual(['heart_Second_obs_data.json', 'study_obs_data.json'])
      expect(store.protocols.map(({ name }) => name)).toEqual(['Second', 'study'])
    })
  })
})
