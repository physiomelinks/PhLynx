/**
 * The modular CellML export: a main model that imports each instance's component from a module file, with the
 * modules' sidecars. The main model keeps the parameter values, couplings and generated components; only simulation
 * flattens (generateFlattenedModel). Ids stay as the library stores them, so they may repeat across module files.
 */
import JSZip from 'jszip'

import { AFFINE_UNIT_CONVERSIONS, CELLML_NS, STANDARD_UNITS } from '../../utils/constants'
import { generateFlattenedModel, getLibCellML, stripCelsiusToArbitraryUnit, uniqueComponentIds } from '../../utils/cellml'
import { parseMathRef } from '../../utils/config'
import { renameSidecar } from '../annotations/sidecarEdit'
import { groupingCellmlFile, unitsUsedBy } from '../userModules'
import { TURTLE_FORMAT, sidecarLocation } from './annotationsRdf'

export const MODULAR_MAIN_FILE = 'model.cellml'
const XLINK_NS = 'http://www.w3.org/1999/xlink'
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/'
const STANDARD = new Set(STANDARD_UNITS)

/**
 * Builds the modular CellML of a workspace. An instance whose math is as stored imports its component from one file
 * per grouping; one whose math the build changes, such as by dropping a driven state, gets a file of its own,
 * `<component>_<instance>.cellml`, and a copy of its sidecar re-pointed at it.
 *
 * @param {Array} nodes - As for generateFlattenedModel.
 * @param {Array} edges
 * @param {Object} libraryStore - Also provides getModuleAnnotations(mathRef).
 * @param {Array} [inspectionModules]
 * @param {Object} [options] - Passed to generateFlattenedModel.
 * @param {string} [options.mainFileName] - The main model's location, which no module file may take.
 * @returns {Promise<{ main: string, flat: string, files: Array<{ location: string, text: string }>,
 *   sidecars: Array<{ location: string, format: string, text: string }>, warnings: string[] }>} The main model, the
 *   flattened model it is equivalent to, the module files and sidecars, and why any sidecar is left out.
 * @throws {Error} As generateFlattenedModel does.
 */
export async function buildModularModel(nodes, edges, libraryStore, inspectionModules = [], options = {}) {
  const { mainFileName = MODULAR_MAIN_FILE, ...flattenOptions } = options
  const instanceSources = new Map()
  const flat = await (await generateFlattenedModel(nodes, edges, libraryStore, inspectionModules, { ...flattenOptions, instanceSources })).text()
  const flatDoc = new DOMParser().parseFromString(flat, 'application/xml')
  const flatUnits = new Map(childrenNamed(flatDoc.documentElement, 'units').map((el) => [el.getAttribute('name'), el]))

  const taken = new Set([mainFileName.toLowerCase()])
  const claim = (name) => {
    const stem = name.replace(/\.cellml$/i, '')
    let location = `${stem}.cellml`
    for (let n = 2; taken.has(location.toLowerCase()); n++) location = `${stem}_${n}.cellml`
    taken.add(location.toLowerCase())
    return location
  }

  // Instances on math as stored share their grouping's file; the others get one each.
  const shared = new Map()
  const sharedInstances = []
  const own = []
  for (const source of instanceSources.values()) {
    const stored = libraryStore.availableMath.get(source.mathRef)
    const { componentFile, componentName } = parseMathRef(source.mathRef)
    if (source.xml === stored) {
      if (!shared.has(componentFile)) shared.set(componentFile, new Map())
      shared.get(componentFile).set(componentName, stored)
      sharedInstances.push({ name: source.name, componentFile, componentName })
    } else {
      own.push({ ...source, componentName })
    }
  }

  const files = []
  const sidecars = []
  const warnings = []
  const imports = new Map() // instance name -> { href, componentRef }
  const addSidecar = async (mathRef, newRef, ids) => {
    const text = libraryStore.getModuleAnnotations?.(mathRef)
    if (!text?.trim()) return
    const location = sidecarLocation(newRef)
    if (!location) {
      warnings.push(`The sidecar for ${mathRef} has no place in the export, so it is left out.`)
      return
    }
    try {
      const moved = newRef === mathRef && !ids?.size ? text : await renameSidecar(text, mathRef, newRef, { ids })
      sidecars.push({ location, format: TURTLE_FORMAT, text: moved })
    } catch (error) {
      warnings.push(`The sidecar for ${mathRef} is left out: ${error.message}`)
    }
  }

  const locationOf = new Map()
  for (const [componentFile, maths] of shared) {
    const location = claim(cellmlFileName(componentFile))
    locationOf.set(componentFile, location)
    const names = [...maths.keys()]
    const { models, idMaps } = uniqueComponentIds([...maths.values()])
    files.push({ location, text: moduleFile(location, models, flatUnits) })
    for (const [i, name] of names.entries()) await addSidecar(`${componentFile}:${name}`, `${location}:${name}`, idMaps[i])
  }
  for (const { name, componentFile, componentName } of sharedInstances) {
    imports.set(name, { href: locationOf.get(componentFile), componentRef: componentName })
  }
  for (const source of own) {
    const location = claim(`${source.componentName}_${source.name}`)
    files.push({ location, text: moduleFile(location, [source.xml], flatUnits) })
    imports.set(source.name, { href: location, componentRef: source.componentName })
    await addSidecar(source.mathRef, `${location}:${source.componentName}`)
  }

  return { main: mainModel(flatDoc, imports), flat, files, sidecars, warnings }
}

/**
 * Zips a modular export: the main model, its module files and their sidecars.
 *
 * @param {{ main: string, files: Array<{ location: string, text: string }>, sidecars: Array<{ location: string,
 *   text: string }> }} modular - From buildModularModel.
 * @param {string} [mainFileName]
 * @returns {Promise<Blob>}
 */
export function zipModularModel({ main, files, sidecars }, mainFileName = MODULAR_MAIN_FILE) {
  const zip = new JSZip()
  zip.file(mainFileName, main)
  for (const { location, text } of [...files, ...sidecars]) zip.file(location, text)
  return zip.generateAsync({ type: 'blob' })
}

/** A grouping's name as a CellML file. */
function cellmlFileName(componentFile) {
  const file = groupingCellmlFile(componentFile)
  return /\.cellml$/i.test(file) ? file : `${file}.cellml`
}

/** An element's child elements of one local name. */
function childrenNamed(parent, localName) {
  return [...parent.children].filter((el) => el.localName === localName)
}

/**
 * Writes a module file: the maths' components, each variable public so the main model can connect it, and the units
 * they use, as the flattened model defines them.
 *
 * @param {string} location - Names the file's model.
 * @param {string[]} maths - One-component models whose ids don't repeat across them.
 * @param {Map<string, Element>} flatUnits - The flattened model's units, by name.
 * @returns {string}
 */
function moduleFile(location, maths, flatUnits) {
  const libcellml = getLibCellML()
  const serializer = new XMLSerializer()
  const components = maths.map((math) => {
    const doc = new DOMParser().parseFromString(math, 'application/xml')
    const component = childrenNamed(doc.documentElement, 'component')[0]
    for (const variable of childrenNamed(component, 'variable')) {
      const type = variable.getAttribute('interface')
      if (type !== 'public' && type !== 'public_and_private') variable.setAttribute('interface', 'public')
    }
    return serializer.serializeToString(component)
  })

  const units = new Map()
  const pending = maths.flatMap((math) => [...unitsUsedBy(math)])
  while (pending.length) {
    const name = pending.shift()
    if (units.has(name) || STANDARD.has(name)) continue
    const definition = flatUnits.get(name)
    if (definition) {
      units.set(name, serializer.serializeToString(definition))
      pending.push(...childrenNamed(definition, 'unit').map((unit) => unit.getAttribute('units')))
    } else if (AFFINE_UNIT_CONVERSIONS[name]) {
      // As the flattened model masks it, before stripCelsiusToArbitraryUnit.
      units.set(name, `<units name="${name}"><unit units="${AFFINE_UNIT_CONVERSIONS[name].baseUnit}"/></units>`)
    }
  }

  const name = location.replace(/\.cellml$/i, '').replace(/[^A-Za-z0-9_]/g, '_').replace(/^(?=\d)/, '_')
  const xml = stripCelsiusToArbitraryUnit(
    `<model xmlns="${CELLML_NS}" xmlns:cellml="${CELLML_NS}" name="${name}">${[...units.values(), ...components].join('')}</model>`
  )
  return reprint(libcellml, xml)
}

/**
 * Replaces each imported instance's component in the flattened model with its import.
 *
 * @param {Document} flatDoc - Changed in place.
 * @param {Map<string, { href: string, componentRef: string }>} imports - By instance name.
 * @returns {string}
 */
function mainModel(flatDoc, imports) {
  const model = flatDoc.documentElement
  const importOf = new Map()
  const firstChild = childrenNamed(model, 'units')[0] ?? childrenNamed(model, 'component')[0] ?? null
  for (const component of childrenNamed(model, 'component')) {
    const target = imports.get(component.getAttribute('name'))
    if (!target) continue
    if (!importOf.has(target.href)) {
      const element = flatDoc.createElementNS(CELLML_NS, 'import')
      // Declared outright, as happy-dom's serializer leaves the prefix undeclared.
      element.setAttributeNS(XMLNS_NS, 'xmlns:xlink', XLINK_NS)
      element.setAttributeNS(XLINK_NS, 'xlink:href', target.href)
      model.insertBefore(element, firstChild)
      importOf.set(target.href, element)
    }
    const imported = flatDoc.createElementNS(CELLML_NS, 'component')
    imported.setAttribute('name', component.getAttribute('name'))
    imported.setAttribute('component_ref', target.componentRef)
    importOf.get(target.href).appendChild(imported)
    component.remove()
  }
  return reprint(getLibCellML(), new XMLSerializer().serializeToString(flatDoc))
}

/** Prints CellML through libCellML, one element per line. */
function reprint(libcellml, xml) {
  const parser = new libcellml.Parser(false)
  const printer = new libcellml.Printer()
  const model = parser.parseModel(xml)
  try {
    if (parser.errorCount()) {
      const issues = Array.from({ length: parser.errorCount() }, (_, i) => parser.error(i).description())
      throw new Error(`The modular CellML doesn't parse: ${issues.join(' ')}`)
    }
    return printer.printModel(model, false)
  } finally {
    model.delete()
    printer.delete()
    parser.delete()
  }
}
