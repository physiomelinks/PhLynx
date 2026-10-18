import Papa from 'papaparse'

import { IMPORT_KEYS, IMPORT_LABELS, RELEVANT_EXTENSIONS } from './constants'
import { isCellML, doesComponentExistInModel } from './cellml'
import {
  looksLikeSupermoduleInstance,
  MODULE_ARRAY_COLUMNS,
  moduleArrayCsvToRecords,
  moduleArrayLayout,
  normaliseModuleRecords,
  toInstanceRows,
} from '../services/import/caModuleArray'
import { moduleRefOf, normaliseModuleConfig, resolveModuleRefs } from '../services/import/caModuleConfig'
import { ambiguousParameterFileMessage, matchParameterFile, referencedParameterFiles } from '../services/import/caParameters'
import { expandSupermodules } from '../services/import/caSupermodules'

/** Columns a parameters CSV must have. */
const PARAMETER_COLUMNS = ['variable_name', 'units', 'value', 'data_reference']

/** Keys only a module config entry has, in either key style; a module-array record has none. */
const MODULE_CONFIG_ONLY_KEYS = [
  'component_file',
  'component_type',
  'module_file',
  'module_format',
  'submodules',
  'entrance_ports',
  'exit_ports',
  'general_ports',
  'variables_and_units',
]

/**
 * Builds a format error naming the required fields a file lacks, or null when none are missing.
 * Files with none of the required fields are marked `unrelated`.
 * @param {string} description - What the file failed to be, e.g. 'instance array file'.
 * @param {string[]} required - Required column or key names.
 * @param {string[]} present - Column or key names the file actually has.
 * @param {string} fieldNoun - 'columns' or 'keys'.
 * @returns {Error|null}
 */
function missingFieldsError(description, required, present, fieldNoun) {
  const missing = required.filter((name) => !present.includes(name))
  if (!missing.length) return null
  return Object.assign(new Error(`Invalid ${description} format. Missing ${fieldNoun}: ${missing.join(', ')}.`), {
    unrelated: missing.length === required.length,
  })
}

/**
 * Returns the lower-case extension of a file name, including the dot.
 * @param {string} filename
 * @returns {string}
 */
export function extensionOf(filename) {
  const dot = filename.lastIndexOf('.')
  return dot === -1 ? '' : filename.slice(dot).toLowerCase()
}

export function hasRelevantExtension(filename) {
  return RELEVANT_EXTENSIONS.has(extensionOf(filename))
}

export function readEntries(dirReader) {
  return new Promise((resolve, reject) => dirReader.readEntries(resolve, reject))
}

export function fileFromEntry(fileEntry) {
  return new Promise((resolve, reject) => fileEntry.file(resolve, reject))
}

export async function collectEntry(entry, path, depth, maxDepth, results) {
  if (!entry || depth > maxDepth) return
  if (entry.name.startsWith('.') || entry.name === 'node_modules') return

  const fullPath = path ? `${path}/${entry.name}` : entry.name

  if (entry.isFile) {
    if (!hasRelevantExtension(entry.name)) return
    try {
      const file = await fileFromEntry(entry)
      results.push({ file, path: fullPath })
    } catch {
      // Unreadable file — skip it rather than aborting the whole drop.
    }
  } else if (entry.isDirectory) {
    const reader = entry.createReader()
    // readEntries only returns a batch at a time; must be called
    // repeatedly until it resolves an empty array.
    let batch
    do {
      batch = await readEntries(reader)
      for (const child of batch) {
        await collectEntry(child, fullPath, depth + 1, maxDepth, results)
      }
    } while (batch.length > 0)
  }
}

/**
 * Checks that the library holds what a module array's rows use: each component module and its math, through every
 * super-module they instantiate, whose submodules are what is asked for.
 *
 * Super-module instances also need the parameter files CA reads for them (see caParameters
 * referencedParameterFiles): each one named outright is asked for. A file several dropped files could be, or one that
 * could not be read, stops the import; an entry's default that could not be read is left out, with a note. Once every
 * module is there, the instances are expanded as the import expands them, so a module array CA would stop on stops
 * here too.
 *
 * @param {Object[]} requestedModules - The rows.
 * @param {Object} store - availableModules, availableMath, and optionally caVariants, availableSupermodules,
 *   supermoduleErrors (problems found while staging super-modules), caParameterFiles (path -> rows),
 *   caParameterFileErrors (path -> why it could not be read) and caConfigPaths (moduleRef -> config path).
 * @returns {{warnings: string[], errors: string[], notes: string[], resourcesAreLoaded: boolean,
 *   missingResources: {modules: Set<string>, math: Set<string>, parameterisations: Set<string>},
 *   supermoduleInstances: string[]}} `supermoduleInstances` lists the rows that are super-module instances, as
 *   `name (type:subtype)`, which are imported as super instances; `parameterisations` the parameter files missing, as
 *   `type:subtype parameterisations/<name>/<name>_parameters.csv`.
 */
export const checkResourcesAreLoaded = (requestedModules, store) => {
  const warnings = []
  const errors = [...(store.supermoduleErrors ?? [])]
  const notes = []
  const missingResources = {
    modules: new Set(),
    math: new Set(),
    parameterisations: new Set(),
  }

  if (!requestedModules || requestedModules.length === 0) {
    warnings.push('No modules specified in the instance array file.')
  }

  const rows = requestedModules ?? []
  const supermodules = store.availableSupermodules ?? new Map()
  const resolved = resolveModuleRefs(rows, supermodules)
  for (const moduleRef of resolved.components) {
    // A per-instance variant from a CA export is kept aside from the library (see libraryStore.caVariants).
    const found = store.availableModules.get(moduleRef) ?? store.caVariants?.get(moduleRef)
    if (!found) {
      missingResources.modules.add(moduleRef)
    } else {
      const mathRef = found.mathRef
      if (!(store.availableMath.has(mathRef))) {
        missingResources.math.add(mathRef)
      }
    }
  }
  resolved.cycles.forEach((cycle) => errors.push(`Supermodules nest in a cycle (${cycle}).`))

  const supermoduleInstances = rows
    .filter((row) => supermodules.has(moduleRefOf(row.module_type, row.module_subtype)) || looksLikeSupermoduleInstance(row))
    .map((row) => `${row.name} (${moduleRefOf(row.module_type, row.module_subtype)})`)
  const parameterFiles = store.caParameterFiles ?? new Map()
  const configPaths = store.caConfigPaths ?? new Map()
  const unreadable = store.caParameterFileErrors ?? new Map()
  for (const { entry, request, required, label } of referencedParameterFiles(rows, supermodules)) {
    const { path, ambiguous } = matchParameterFile(parameterFiles.keys(), configPaths, entry, request)
    if (ambiguous.length) errors.push(ambiguousParameterFileMessage(entry, request, ambiguous))
    else if (path && unreadable.has(path)) {
      if (required) errors.push(`Parameter file ${path}: ${unreadable.get(path)}`)
      else notes.push(`Parameter file ${path} is left out: ${unreadable.get(path)}`)
    } else if (required && !path) missingResources.parameterisations.add(label)
  }

  // As the import expands them (see caFold.buildCaModel); parameters are checked above.
  if (supermoduleInstances.length && !missingResources.modules.size && !resolved.cycles.length) {
    try {
      expandSupermodules(normaliseModuleRecords(rows), supermodules)
    } catch (error) {
      errors.push(error.message)
    }
  }

  // Generate warnings
  if (missingResources.modules.size > 0) {
    warnings.push(`Missing modules: ${[...missingResources.modules].join(', ')}`)
  }

  if (missingResources.math.size > 0) {
    warnings.push(`Missing math: ${[...missingResources.math].join(', ')}`)
  }

  if (missingResources.parameterisations.size > 0) {
    warnings.push(`Missing parameter files: ${[...missingResources.parameterisations].join(', ')}`)
  }

  return {
    warnings,
    errors,
    notes,
    resourcesAreLoaded: warnings.length === 0 && errors.length === 0,
    missingResources,
    supermoduleInstances,
  }
}

/**
 * Validates that a config's component_file field correctly points to a file
 * that contains the specified component_type.
 * 
 * This ensures that components come from the CellML file specified in the config.
 * 
 * @param {Object} config - The configuration object with module_type, module_subtype, component_file, component_type
 * @param {Object} libraryStore - The store containing availableCollections
 * @returns {Object|null} - Issue object if there's a problem, null if validation passes
 */
function validateCollectionFileAssociation(config, libraryStore) {
  const { component_file, component_type, module_type, module_subtype } = config
  
  // Config doesn't specify a component file
  if (!component_file) {
    return {
      config: `${module_type}:${module_subtype}`,
      expectedFile: 'unknown',
      componentType: component_type,
      issue: 'no_file_specified',
      message: `Config for ${module_type}:${module_subtype} doesn't specify a component_file`,
    }
  }
  
  // Find the collection in the library
  const collection = libraryStore.availableCollections.find(
    f => f.componentFile === component_file
  )
  
  // Expected file is missing (or provided one is empty)
  if (!collection || !collection.model) {
    return {
      config: `${module_type}:${module_subtype}`,
      expectedFile: component_file,
      componentType: component_type,
      issue: 'missing_file',
      message: `Component file "${component_file}" not found (needed for ${module_type}:${module_subtype})`,
    }
  }
  
  // Only config provided and still need component 
  if (collection.isStub) {
    return {
      config: `${module_type}:${module_subtype}`,
      expectedFile: component_file,
      componentType: component_type,
      issue: 'stub_file',
      message: `Component file "${component_file}" needs to be uploaded (needed for ${module_type}:${module_subtype})`,
    }
  }
  
  if (!doesComponentExistInModel(collection.model, component_type)) {
    return {
      config: `${module_type}:${module_subtype}`,
      expectedFile: component_file,
      componentType: component_type,
      issue: 'component_not_in_file',
      message: `Component "${component_type}" not found in "${component_file}"`,
    }
  }

  // All checks passed
  return null
}

/**
 * Groups collection file issues by file AND issue type.
 * This ensures different issues (e.g., 'missing_file' vs 'component_not_in_file')
 * for the same file are reported separately.
 * @param {Array} componentFileIssues - Array of issue objects
 * @returns {Array} Grouped issues with consolidated messages
 */
export function groupCollectionFileIssues(componentFileIssues) {
  if (!componentFileIssues || componentFileIssues.length === 0) {
    return []
  }

  // key: "file:issueType"
  const issuesGrouped = new Map()
  
  componentFileIssues.forEach(issue => {
    const file = issue.expectedFile
    // Create a composite key to separate different issues for the same file
    const groupKey = `${file}:${issue.issue}`
    
    if (!issuesGrouped.has(groupKey)) {
      issuesGrouped.set(groupKey, {
        file,
        issue: issue.issue,
        configs: [],
        componentTypes: new Set(),
        // Generate a unique ID for UI loops
        uniqueKey: groupKey
      })
    }
    
    const group = issuesGrouped.get(groupKey)
    group.configs.push(issue.config)
    if (issue.componentType) {
      group.componentTypes.add(issue.componentType)
    }
  })
  
  // Convert to array and format messages
  return Array.from(issuesGrouped.values()).map(group => {
    let message = ''
    
    switch (group.issue) {
      case 'missing_file':
        message = `Component file "${group.file}" not found.`
        break
      case 'stub_file':
        message = `Component file "${group.file}" needs to be uploaded.`
        break
      case 'component_not_in_file':
        message = `Component file "${group.file}" missing components: ${[...group.componentTypes].join(', ')}.`
        break
      case 'no_file_specified':
        message = `Module config doesn't specify a component file.`
        break
      default:
        message = `Issue with "${group.file}"`
    }
    
    message += ` (needed for: ${group.configs.join(', ')})`
    
    return {
      file: group.file,
      issue: group.issue,
      message,
      configs: group.configs,
      componentTypes: [...group.componentTypes],
      uniqueKey: group.uniqueKey
    }
  })
}

/**
 * Reads a file's text.
 * @param {File} file
 * @returns {Promise<string>}
 */
function readText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}

/**
 * Reads a CSV module array (the legacy format), in either column layout, as raw records.
 * @param {File} file
 * @returns {Promise<Object[]>}
 */
function readModuleArrayCsv(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim(),
      transform: (v) => v.trim(),
      complete: (results) => {
        try {
          const columns = results.meta.fields ?? []
          const layout = moduleArrayLayout(columns, file.name) ?? 'phlynx'
          const schemaError = missingFieldsError('instance array file', MODULE_ARRAY_COLUMNS[layout], columns, 'columns')
          if (schemaError) throw schemaError
          resolve(moduleArrayCsvToRecords(results.data, columns))
        } catch (err) {
          reject(err)
        }
      },
      error: (err) => reject(err),
    })
  })
}

/**
 * Reads a JSON module array, a list of records.
 * @param {File} file
 * @returns {Promise<Object[]>}
 */
async function readModuleArrayJson(file) {
  const parsed = JSON.parse(await readText(file))
  const records = Array.isArray(parsed) ? parsed : null
  // Module configs are JSON lists too: theirs are entries, with no name.
  const isConfig = records?.some((r) => r && typeof r === 'object' && MODULE_CONFIG_ONLY_KEYS.some((key) => key in r))
  if (!records || (isConfig && !records.some((r) => r && typeof r === 'object' && 'name' in r))) {
    throw Object.assign(new Error('A module array must be a JSON list of records.'), { unrelated: true })
  }
  return records
}

/**
 * Parses a module array: `<prefix>_module_array.json`, or a legacy CSV. Rows come back as buildWorkflowGraph reads
 * them (inp/out names space-separated), with every other key, per_submodule_* included, kept.
 * @param {File} file
 * @param {Object} [libraryStore] - When given, readiness is checked against it.
 * @returns {Promise<{data: Object[], completionStatus: Object|null}>}
 */
const parseInstanceArray = async (file, libraryStore = null) => {
  const raw = extensionOf(file.name) === '.json' ? await readModuleArrayJson(file) : await readModuleArrayCsv(file)
  if (!raw.length) throw new Error('Instance array file has no rows.')
  const data = toInstanceRows(normaliseModuleRecords(raw, file.name))
  return { data, completionStatus: libraryStore ? checkResourcesAreLoaded(data, libraryStore) : null }
}

/**
 * Parses a module configuration file, checking every entry as circulatory_autogen does. Entries come back in PhLynx
 * keys; a JSON module array is reported as unrelated.
 * @param {File} file
 * @returns {Promise<Object[]>}
 */
const parseConfigJson = async (file) => {
  const parsed = JSON.parse(await readText(file))
  if (!Array.isArray(parsed)) {
    throw Object.assign(new Error('Config file must be an array of configuration objects.'), { unrelated: true })
  }
  if (parsed.length === 0) {
    throw new Error('Config file must be a non-empty array of configuration objects.')
  }
  const isObject = (entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
  if (parsed.every((entry) => isObject(entry) && 'name' in entry && !MODULE_CONFIG_ONLY_KEYS.some((key) => key in entry))) {
    throw Object.assign(new Error('This is a module array, not a module configuration file.'), { unrelated: true })
  }
  return normaliseModuleConfig(parsed, file.name)
}

export const parseParametersFile = (file) => {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,

      complete: (results) => {
        const schemaError = missingFieldsError('parameter file', PARAMETER_COLUMNS, results.meta.fields, 'columns')
        if (schemaError) {
          reject(schemaError)
          return
        }

        const cleanData = results.data.filter((row) => {
          return row.variable_name && !row.variable_name.trim().startsWith('#')
        })
        if (cleanData.length === 0) {
          reject(new Error('Parameter file has no parameter rows.'))
          return
        }

        resolve(cleanData)
      },

      error: (err) => reject(err),
    })
  })
}

const parseCellML = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const content = e.target.result
        if (!isCellML(content)) {
          // Files without the CellML namespace are some other XML, not broken CellML.
          reject(Object.assign(new Error('Invalid CellML file.'), { unrelated: !/cellml\.org\/cellml/.test(content) }))
          return
        }
        resolve(content)
      } catch (err) {
        reject(err)
      }
    }
    reader.readAsText(file)
  })
}

const parseOMEX = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const content = e.target.result
        // Basic validation for OMEX (COMBINE Archive)
        if (!file.name.endsWith('.omex') && !file.name.endsWith('.zip')) {
          reject(new Error('Invalid OMEX file.'))
          return
        }
        resolve(content)
      } catch (err) {
        reject(err)
      }
    }
    reader.readAsArrayBuffer(file)
  })
}

export function createDynamicFields(completionStatus) {
  const fields = []

  if (completionStatus.missingResources.math?.size > 0) {

    fields.push({
      key: IMPORT_KEYS.CELLML_FILE,
      label: IMPORT_LABELS.CELLML_FILE,
      required: true,
      accept: '.cellml, .xml',
      parser: parseCellML,
      helpText: `Required components: ${(completionStatus.missingResources.math)}`,
      processUpload: 'cellml',
    })
  }

  if (completionStatus.missingResources.modules?.size > 0) {
    fields.push({
      key: IMPORT_KEYS.MODULE_CONFIG,
      label: IMPORT_LABELS.MODULE_CONFIG,
      required: true,
      accept: '.json',
      parser: parseConfigJson,
      helpText: `Required Configurations: ${(completionStatus.missingResources.modules)}`,
      processUpload: 'config',
    })
  }

  return fields
}

const configs = {
  [IMPORT_KEYS.INSTANCE_ARRAY]: {
    title: 'Import Instance Array File',
    fields: [
      {
        key: IMPORT_KEYS.INSTANCE_ARRAY,
        label: IMPORT_LABELS.INSTANCE_ARRAY,
        accept: '.json, .csv',
        limit: 1,
        required: true,
        parser: parseInstanceArray,
        isDynamic: true,
      },
      {
        key: IMPORT_KEYS.PARAMETER,
        label: IMPORT_LABELS.PARAMETER,
        accept: '.csv',
        required: false,
        parser: parseParametersFile,
      },
    ],
  },
  [IMPORT_KEYS.MODULE_CONFIG]: {
    title: 'Import CellML Module Configuration',
    fields: [
      {
        key: IMPORT_KEYS.MODULE_CONFIG,
        label: IMPORT_LABELS.MODULE_CONFIG,
        accept: '.json',
        parser: parseConfigJson,
      },
    ],
  },
  [IMPORT_KEYS.CELLML_FILE]: {
    title: 'Import CellML File',
    fields: [
      {
        key: IMPORT_KEYS.CELLML_FILE,
        label: IMPORT_LABELS.CELLML_FILE,
        required: true,
        accept: '.cellml, .xml',
        parser: parseCellML,
      },
    ],
  },
  [IMPORT_KEYS.PARAMETER]: {
    title: 'Import Parameter Configuration',
    fields: [
      {
        key: IMPORT_KEYS.PARAMETER,
        label: IMPORT_LABELS.PARAMETER,
        accept: '.csv',
        parser: parseParametersFile,
      },
    ],
  },
  [IMPORT_KEYS.UNITS]: {
    title: 'Import Units Configuration',
    fields: [
      {
        key: IMPORT_KEYS.UNITS,
        label: IMPORT_LABELS.UNITS,
        accept: '.cellml, .xml',
        parser: parseCellML,
      },
    ],
  },
  [IMPORT_KEYS.OMEX]: {
    title: 'Import COMBINE Archive (OMEX)',
    fields: [
      {
        key: IMPORT_KEYS.OMEX,
        label: IMPORT_LABELS.OMEX,
        accept: '.omex, .zip',
        parser: parseOMEX,
      },
    ],
  },
}

export function getImportConfig(type) {
  return configs[type] || null
}