import JSZip from 'jszip'
import { processCellMLDataInBackground } from '../libcellml/cellmlImport'
import { isModuleConfigFile, isPhlynxFlowSnapshotFile, isSimulationJsonFile } from './omexClassifiers'
import { classifyAnnotationEntry, isAnnotationCandidate } from './omexAnnotations'

// Where exports made before libOpenCOR resolved imports kept a flattened copy of the modular model, which their SED-ML
// runs. Read only, to load those archives.
const FLATTENED_FOLDER = 'flattened'

const jsonMimeTypeRegex = /^application\/(?:json|.+\+json)$/i
const CELLML_FORMAT = 'http://identifiers.org/combine.specifications/cellml'
const SEDML_FORMAT = 'http://identifiers.org/combine.specifications/sed-ml'

/**
 * Picks the model CellML: the only one, the one master, or else the one the SED-ML's models use, as a PhLynx export
 * marks only the SED-ML as master and also carries module and units CellML files.
 *
 * @param {Array<{ location: string, isMaster: boolean }>} cellmlEntries
 * @param {string[]} [modelSources] - Archive locations the SED-ML's models name.
 * @returns {string} The model CellML's location.
 * @throws {Error} When none of these picks one.
 */
export function validateCellmlEntries(cellmlEntries, modelSources = []) {
  if (!Array.isArray(cellmlEntries) || cellmlEntries.length === 0) {
    throw new Error('Invalid OMEX file: no CellML files found.')
  }

  if (cellmlEntries.length === 1) {
    return cellmlEntries[0].location
  }

  const masters = cellmlEntries.filter((entry) => entry.isMaster)
  if (masters.length === 1) {
    return masters[0].location
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
    // An older export's SED-ML runs the flattened copy of its modular main model.
    .map((source) => (source.startsWith(`${FLATTENED_FOLDER}/`) ? source.slice(FLATTENED_FOLDER.length + 1) : source))
    .flatMap((source) => (folder ? [folder + source, source] : [source]))
}

/**
 * Reads the archive locations a CellML model imports components from, resolved against the model's folder.
 *
 * @param {string} cellmlText
 * @param {string} cellmlLocation
 * @returns {Set<string>}
 */
export function readComponentImports(cellmlText, cellmlLocation) {
  const document = new DOMParser().parseFromString(cellmlText, 'application/xml')
  if (document.getElementsByTagName('parsererror')[0]) return new Set()

  const folder = cellmlLocation.includes('/') ? cellmlLocation.slice(0, cellmlLocation.lastIndexOf('/') + 1) : ''
  return new Set(
    Array.from(document.getElementsByTagName('*'))
      .filter((element) => element.localName === 'import')
      .filter((element) => Array.from(element.children).some((child) => child.localName === 'component'))
      .map((element) => element.getAttribute('xlink:href') ?? element.getAttributeNS('http://www.w3.org/1999/xlink', 'href'))
      .filter(Boolean)
      .map((href) => folder + (href.startsWith('./') ? href.slice(2) : href)),
  )
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

    const result = await processCellMLDataInBackground(await file.async('string'))
    if (result.type !== 'success' || !result.units.count) continue

    const componentFile = location.split('/').pop()
    libraryStore.addUnitsFile({ componentFile, model: result.units.model })
    added.push(componentFile)
  }
  return added
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

  const sedmlFile = foundFiles.sedml && archive.file(foundFiles.sedml)
  const modelSources = sedmlFile ? readSedmlModelSources(await sedmlFile.async('string'), foundFiles.sedml) : []
  const cellmlLocation = validateCellmlEntries(foundFiles.cellmls, modelSources)
  // An older export's flattened copy and the modules the model imports components from carry the model's math, not
  // units files.
  const moduleLocations = readComponentImports(await archive.file(cellmlLocation).async('string'), cellmlLocation)

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
    otherCellmls: foundFiles.cellmls
      .map(({ location }) => location)
      .filter((location) => location !== cellmlLocation && !location.startsWith(`${FLATTENED_FOLDER}/`) && !moduleLocations.has(location)),
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
