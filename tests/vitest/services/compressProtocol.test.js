import JSZip from 'jszip'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { generateOmexArchive } from '../../../src/services/compress.js'
import { useOmexStore } from '../../../src/stores/omexStore.js'
import { useProtocolStore } from '../../../src/stores/protocolStore.js'
import { BASELINE_SIMULATION_SETTINGS } from '../../../src/utils/constants.js'

const DOCUMENT = { protocol_info: { pre_times: [0], sim_times: [[1]], params_to_change: { 'soma_SN/g_M': [[0.01]] } }, data_items: [] }

const SETTINGS = { simulationSettings: BASELINE_SIMULATION_SETTINGS, plotConfig: {}, parameterScanConfig: {} }
const ADD_INFO = { extractedData: { voi: null, mappedParameters: {} }, modified: false, cellmlFileName: 'sn.cellml' }

describe('an OMEX with a protocol', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('carries the obs_data as JSON, named with "obs", as CUFLynx finds it', async () => {
    useOmexStore().cellmlFileName = 'sn.cellml'
    useProtocolStore().saveDocument(DOCUMENT)

    const blob = await generateOmexArchive(
      { blob: new Blob(['<model/>']) },
      '{}',
      { simulationSettings: BASELINE_SIMULATION_SETTINGS, plotConfig: {}, parameterScanConfig: {} },
      { extractedData: { voi: null, mappedParameters: {} }, modified: false, cellmlFileName: 'sn.cellml' }
    )
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())

    expect(await zip.file('manifest.xml').async('string')).toMatch(/location="(\.\/)?sn_obs_data\.json"\s+format="application\/json"/)
    expect(JSON.parse(await zip.file('sn_obs_data.json').async('string'))).toEqual(DOCUMENT)
  })

  it('lists the active protocol first of several, so CUFLynx picks it too', async () => {
    useOmexStore().cellmlFileName = 'sn.cellml'
    const store = useProtocolStore()
    store.saveDocument(DOCUMENT)
    store.createProtocol('Second')
    store.createProtocol('Third')
    store.chooseProtocol('sn_Second_obs_data.json')

    const blob = await generateOmexArchive({ blob: new Blob(['<model/>']) }, '{}', SETTINGS, ADD_INFO)
    const manifest = await (await JSZip.loadAsync(await blob.arrayBuffer())).file('manifest.xml').async('string')
    const listed = [...manifest.matchAll(/location="(?:\.\/)?([^"]*_obs_data\.json)"/g)].map(([, location]) => location)
    expect(listed).toEqual(['sn_Second_obs_data.json', 'sn_Third_obs_data.json', 'sn_obs_data.json'])
  })
})
