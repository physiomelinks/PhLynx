import JSZip from 'jszip'
import { isModuleConfigFile, isPhlynxFlowSnapshotFile, isSimulationJsonFile } from './omexClassifiers'
import { classifyAnnotationEntry, isAnnotationCandidate } from './omexAnnotations'

const jsonMimeTypeRegex = /^application\/(?:json|.+\+json)$/i
const CELLML_FORMAT = 'http://identifiers.org/combine.specifications/cellml'
const SEDML_FORMAT = 'http://identifiers.org/combine.specifications/sed-ml'

export function validateCellmlEntries(cellmlEntries) {
  if (!Array.isArray(cellmlEntries) || cellmlEntries.length === 0) {
    throw new Error('Invalid OMEX file: no CellML files found.')
  }

  if (cellmlEntries.length === 1) {
    return cellmlEntries[0].location
  }

  const masters = cellmlEntries.filter((entry) => entry.isMaster)
  if (masters.length !== 1) {
    throw new Error('Invalid OMEX file: multiple CellML files require exactly one master CellML file.')
  }

  return masters[0].location
}

export const extractOmexArchive = async (importPayload, updateProgress) => {
  const omexFiles = importPayload instanceof Map ? importPayload.get('omex') : null

  if (!(omexFiles instanceof Map) || omexFiles.size === 0) {
    throw new Error('Uploaded content does not contain any files')
  }

  const firstEntry = omexFiles.entries().next().value
  const omexFile = firstEntry?.[1]

  if (!omexFile || !omexFile?.isValid || !(omexFile?.payload instanceof ArrayBuffer)) {
    throw new Error('Invalid OMEX file: is not a valid ArrayBuffer')
  }

  if (typeof updateProgress === 'function') {
    updateProgress('Importing OMEX file... (10/100)')
  }

  return { omex: omexFile.payload, name: firstEntry?.[0] }
}

export const importOmexFile = async (payload, updateProgress) => {
  let archive = null
  try {
    archive = await JSZip.loadAsync(payload)
  } catch {
    throw new Error('Invalid OMEX file: is not a valid ZIP archive')
  }

  if (typeof updateProgress === 'function') {
    updateProgress('Importing OMEX file... (30/100)')
  }

  const manifestFile = archive.file('manifest.xml')
  if (!manifestFile) {
    throw new Error('Invalid OMEX file: missing manifest.xml')
  }

  const manifestText = await manifestFile.async('string')
  const manifestDocument = new DOMParser().parseFromString(manifestText, 'application/xml')
  const parserError = manifestDocument.getElementsByTagName('parsererror')[0]

  if (parserError) {
    throw new Error('Invalid OMEX file: manifest.xml is not valid XML')
  }

  const rootElement = manifestDocument.documentElement
  const expectedNamespace = 'http://identifiers.org/combine.specifications/omex-manifest'

  if (rootElement?.localName !== 'omexManifest' || rootElement?.namespaceURI !== expectedNamespace) {
    throw new Error('Invalid OMEX file: manifest.xml is not a valid omexManifest')
  }

  const foundFiles = {
    extras: [],
    cellmls: [],
    sedml: null,
    simulationJson: null,
    flowSnapshot: null,
    moduleConfig: null,
    annotations: { sidecars: [], instanceFiles: [] },
  }
  // Each entry's manifest format, so a file kept as an extra keeps it.
  const formats = {}

  for (const contentElement of rootElement.getElementsByTagNameNS(expectedNamespace, 'content')) {
    let location = contentElement.getAttribute('location')
    const format = contentElement.getAttribute('format')

    if (!location || !format) {
      throw new Error('Invalid OMEX file: manifest.xml contains a content entry missing location or format')
    }

    if (location.startsWith('./')) {
      location = location.slice(2)
    }

    if (location === '.' || location === 'manifest.xml') {
      continue
    }

    const fileObject = archive.file(location)
    if (location !== '.' && !fileObject) {
      throw new Error(`Invalid OMEX file: manifest.xml references missing file "${location}"`)
    }

    formats[location] = format

    if (format === CELLML_FORMAT) {
      foundFiles.cellmls.push({ location, isMaster: contentElement.getAttribute('master') === 'true' })
      continue
    }

    if (format === SEDML_FORMAT) {
      foundFiles.sedml = location
      continue
    }

    if (jsonMimeTypeRegex.test(format) || format === 'http://purl.org/NET/mediatypes/application/json') {
      if (await isPhlynxFlowSnapshotFile(fileObject)) {
        foundFiles.flowSnapshot = location
        continue
      }

      if (await isSimulationJsonFile(fileObject)) {
        foundFiles.simulationJson = location
        continue
      }

      if (await isModuleConfigFile(fileObject)) {
        if (foundFiles.moduleConfig) {
          throw new Error('Invalid OMEX file: multiple module configuration files found in the archive')
        }
        foundFiles.moduleConfig = location
        continue
      }
    }

    if (isAnnotationCandidate(location, format)) {
      const text = await fileObject.async('string')
      const annotation = await classifyAnnotationEntry(location, format, text)
      if (annotation?.kind === 'generated') continue
      if (annotation?.kind === 'sidecar') {
        foundFiles.annotations.sidecars.push({ location, mathRef: annotation.mathRef, text })
        continue
      }
      if (annotation?.kind === 'instances') {
        foundFiles.annotations.instanceFiles.push({ location, format: annotation.format, text })
        continue
      }
    }

    foundFiles.extras.push({ location, format })
  }

  if (typeof updateProgress === 'function') {
    updateProgress('Importing OMEX file... (70/100)')
  }

  const cellmlLocation = validateCellmlEntries(foundFiles.cellmls)

  if (typeof updateProgress === 'function') {
    updateProgress('Importing OMEX file... (100/100)')
  }

  return {
    files: {
      cellml: cellmlLocation,
      simulationJson: foundFiles.simulationJson,
      sedml: foundFiles.sedml,
      flowSnapshot: foundFiles.flowSnapshot,
      moduleConfig: foundFiles.moduleConfig,
    },
    extras: foundFiles.extras,
    annotations: foundFiles.annotations,
    formats,
    fileType: 'omex',
  }
}

/**
 * Reads the files importOmexFile found, each with its manifest format, so an extra keeps it on the next export.
 *
 * @param {JSZip} archive - The loaded archive.
 * @param {Object} result - From importOmexFile.
 * @returns {Promise<Array<{ location: string, format: string, payload: ArrayBuffer }>>}
 */
export async function readArchiveEntries(archive, result) {
  const formats = new Map((result.extras || []).map((entry) => [entry.location, entry.format]))
  for (const [location, format] of Object.entries(result.formats || {})) if (!formats.has(location)) formats.set(location, format)
  const locations = new Set([...Object.values(result.files || {}).filter(Boolean), ...(result.extras || []).map((entry) => entry.location)])

  const entries = []
  for (const location of locations) {
    const fileObject = archive.file(location)
    if (!fileObject) continue
    entries.push({
      location,
      format: formats.get(location) ?? 'application/octet-stream',
      payload: await fileObject.async('arraybuffer'),
    })
  }
  return entries
}
