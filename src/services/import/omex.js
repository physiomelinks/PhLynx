import JSZip from 'jszip'
import { processCellMLData } from '../../utils/cellml'
import { isModuleConfigFile, isPhlynxFlowSnapshotFile, isSimulationJsonFile } from './omexClassifiers'
import { classifyAnnotationEntry, isAnnotationCandidate } from './omexAnnotations'
import { FLATTENED_FOLDER } from '../export/omex'

const jsonMimeTypeRegex = /^application\/(?:json|.+\+json)$/i
const CELLML_FORMAT = 'http://identifiers.org/combine.specifications/cellml'
const SEDML_FORMAT = 'http://identifiers.org/combine.specifications/sed-ml'

/**
 * Picks an archive's model: its only CellML file, its master one, or else the one its SED-ML runs, as a modular
 * archive's module files are CellML too.
 *
 * @param {Array<{location: string, isMaster: boolean}>} cellmlEntries
 * @param {string|null} [sedmlSource] - The location the SED-ML's model reads.
 * @returns {string}
 * @throws {Error} When none of these picks one.
 */
export function validateCellmlEntries(cellmlEntries, sedmlSource = null) {
  if (!Array.isArray(cellmlEntries) || cellmlEntries.length === 0) {
    throw new Error('Invalid OMEX file: no CellML files found.')
  }

  if (cellmlEntries.length === 1) {
    return cellmlEntries[0].location
  }

  const masters = cellmlEntries.filter((entry) => entry.isMaster)
  if (!masters.length && cellmlEntries.some((entry) => entry.location === sedmlSource)) return sedmlSource
  if (masters.length !== 1) {
    throw new Error('Invalid OMEX file: multiple CellML files require exactly one master CellML file.')
  }

  const sourced = cellmlEntries.filter((entry) => modelSources.includes(entry.location))
  if (!masters.length && sourced.length === 1) {
    return sourced[0].location
  }

  throw new Error('Invalid OMEX file: multiple CellML files require exactly one master CellML file.')
}

/**
 * Reads the archive locations a SED-ML document's models name, resolved against the document's folder.
 *
 * @param {string} sedmlText
 * @param {string} sedmlLocation
 * @returns {string[]}
 */
export function readSedmlModelSources(sedmlText, sedmlLocation) {
  const document = new DOMParser().parseFromString(sedmlText, 'application/xml')
  if (document.getElementsByTagName('parsererror')[0]) return []

  const folder = sedmlLocation.includes('/') ? sedmlLocation.slice(0, sedmlLocation.lastIndexOf('/') + 1) : ''
  return Array.from(document.getElementsByTagName('*'))
    .filter((element) => element.localName === 'model')
    .map((model) => model.getAttribute('source'))
    .filter(Boolean)
    .map((source) => (source.startsWith('./') ? source.slice(2) : source))
    .flatMap((source) => (folder ? [folder + source, source] : [source]))
}

/**
 * Adds the units of an archive's other CellML files, such as units/units.cellml, to the library under each file's
 * name. Only their units: the model's math comes from the flow snapshot or the model CellML.
 *
 * @param {JSZip} archive
 * @param {string[]} locations
 * @param {{ addUnitsFile: Function }} libraryStore
 * @returns {Promise<string[]>} The names of the units files added.
 */
export async function registerArchiveUnits(archive, locations, libraryStore) {
  const added = []
  for (const location of locations ?? []) {
    const file = archive.file(location)
    if (!file) continue

    const result = processCellMLData(await file.async('string'))
    if (result.type !== 'success' || !result.units.count) continue

    const componentFile = location.split('/').pop()
    libraryStore.addUnitsFile({ componentFile, model: result.units.model })
    added.push(componentFile)
  }
  return added
}

/**
 * The location a SED-ML document's first model reads.
 *
 * @param {string} sedml
 * @returns {string|null}
 */
function sedmlModelSource(sedml) {
  const source = /<(?:\w+:)?model\b[^>]*\bsource\s*=\s*"([^"]*)"/.exec(sedml)?.[1]
  // An export's SED-ML runs the flattened copy of its modular main model (see generateOmexArchive).
  return source ? source.replace(/^\.\//, '').replace(new RegExp(`^${FLATTENED_FOLDER}/`), '') : null
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
    annotations: { sidecars: [] },
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
    }

    foundFiles.extras.push({ location, format })
  }

  if (typeof updateProgress === 'function') {
    updateProgress('Importing OMEX file... (70/100)')
  }

  const sedmlSource = foundFiles.sedml ? sedmlModelSource(await archive.file(foundFiles.sedml).async('string')) : null
  const cellmlLocation = validateCellmlEntries(foundFiles.cellmls, sedmlSource)

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
    // Not files, so the archive's other files aren't kept as extras: their units go to the library.
    otherCellmls: foundFiles.cellmls.map(({ location }) => location).filter((location) => location !== cellmlLocation),
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
