import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'

import { extractOmexArchive, importOmexFile } from '../../../../src/services/import/omex.js'
import { isSimulationJsonFile, isPhlynxFlowSnapshotFile } from '../../../../src/services/import/omexClassifiers.js'
import { PHLYNX_PROJECT_VERSION } from '../../../../src/utils/constants.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function resourcePath(relativePath) {
  return path.resolve(__dirname, '../../../resources', relativePath)
}

async function loadUploadStyleFile(relativePath, fileName, type = 'application/xml') {
  const fileBuffer = await readFile(resourcePath(relativePath))
  const arrayBuffer = fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength)
  return { isValid: true, payload: arrayBuffer }
}

async function loadArchive(relativePath) {
  const fileBuffer = await readFile(resourcePath(relativePath))
  const arrayBuffer = fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength)
  return JSZip.loadAsync(arrayBuffer)
}

describe('Import OMEX', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects a file upload that is not an OMEX file', async () => {
    const uploadedFile = await loadUploadStyleFile('model.cellml', 'model.cellml', 'application/xml')

    expect(uploadedFile.payload).toBeInstanceOf(ArrayBuffer)

    const importPayload = new Map()
    importPayload.set('omex', new Map([[uploadedFile.name, uploadedFile]]))

    const payload = await extractOmexArchive(importPayload)

    await expect(importOmexFile(payload)).rejects.toThrow('Invalid OMEX file: is not a valid ZIP archive')
  })

  it('loads a valid OMEX upload successfully', async () => {
    const uploadedFile = await loadUploadStyleFile('3compartment.omex', '3compartment.omex', 'application/zip')

    expect(uploadedFile.payload).toBeInstanceOf(ArrayBuffer)

    const importPayload = new Map()
    importPayload.set('omex', new Map([['3compartment.omex', uploadedFile]]))

    const updateProgress = vi.fn()

    const payload = await extractOmexArchive(importPayload)
    await expect(importOmexFile(payload.omex, updateProgress)).resolves.toEqual({
      files: {
        cellml: '3compartment_flat.cellml',
        simulationJson: null,
        sedml: null,
        moduleConfig: null,
        flowSnapshot: null,
      },
      extras: [
        { location: '3compartment_obs_data.json', format: 'application/json' },
        { location: '3compartment_params_for_id.csv', format: 'text/csv' },
        { location: 'module_config.json', format: 'application/json' },
      ],
      fileType: 'omex',
    })

    expect(updateProgress).toHaveBeenCalledWith('Importing OMEX file... (100/100)')
  })

  it('rejects multiple CellML files without exactly one master file', async () => {
    const zip = new JSZip()
    zip.file(
      'manifest.xml',
      `<?xml version="1.0" encoding="utf-8"?>
      <omexManifest xmlns="http://identifiers.org/combine.specifications/omex-manifest">
        <content location="./model_a.cellml" format="http://identifiers.org/combine.specifications/cellml"/>
        <content location="./model_b.cellml" format="http://identifiers.org/combine.specifications/cellml"/>
      </omexManifest>`
    )
    zip.file('model_a.cellml', '<model />')
    zip.file('model_b.cellml', '<model />')

    const payload = await zip.generateAsync({ type: 'arraybuffer' })
    const importPayload = new Map([['omex', new Map([['bad-master.omex', { isValid: true, payload }]])]])

    const archivePayload = await extractOmexArchive(importPayload)
    await expect(importOmexFile(archivePayload.omex)).rejects.toThrow(
      'multiple CellML files require exactly one master CellML file'
    )
  })
})

describe('isPhlynxFlowSnapshotFile', () => {
  const snapshotFile = (fields) => ({
    async: async () => JSON.stringify({ id: 'phlynx-flow-snapshot', nodeData: [], edges: [], ...fields }),
  })

  it.each(['1.0.0', '1.1.0', '1.10.0', '2.0.0'])('accepts version %s', async (version) => {
    expect(await isPhlynxFlowSnapshotFile(snapshotFile({ version }))).toBe(true)
  })

  it.each([undefined, '', '0.9.0', 'legacy', '1.1.0-beta'])('rejects version %s', async (version) => {
    expect(await isPhlynxFlowSnapshotFile(snapshotFile({ version }))).toBe(false)
  })

  it('recognises the snapshot in an archive exported at the current version', async () => {
    const zip = new JSZip()
    zip.file(
      'manifest.xml',
      `<?xml version="1.0" encoding="utf-8"?>
      <omexManifest xmlns="http://identifiers.org/combine.specifications/omex-manifest">
        <content location="./model.cellml" format="http://identifiers.org/combine.specifications/cellml" master="true"/>
        <content location="./phlynx_flow.json" format="application/json"/>
      </omexManifest>`
    )
    zip.file('model.cellml', '<model />')
    zip.file(
      'phlynx_flow.json',
      JSON.stringify({ id: 'phlynx-flow-snapshot', version: PHLYNX_PROJECT_VERSION, nodeData: [], edges: [] })
    )

    const payload = await zip.generateAsync({ type: 'arraybuffer' })
    const importPayload = new Map([['omex', new Map([['current.omex', { isValid: true, payload }]])]])

    const archivePayload = await extractOmexArchive(importPayload)
    const { files } = await importOmexFile(archivePayload.omex)
    expect(files.flowSnapshot).toBe('phlynx_flow.json')
  })
})
