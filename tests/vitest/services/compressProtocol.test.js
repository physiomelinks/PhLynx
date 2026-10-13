import JSZip from 'jszip'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { generateOmexArchive } from '../../../src/services/compress.js'
import { useOmexStore } from '../../../src/stores/omexStore.js'
import { useProtocolStore } from '../../../src/stores/protocolStore.js'
import { BASELINE_SIMULATION_SETTINGS } from '../../../src/utils/constants.js'

const DOCUMENT = { protocol_info: { pre_times: [0], sim_times: [[1]], params_to_change: { 'soma_SN/g_M': [[0.01]] } }, data_items: [] }

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
})
