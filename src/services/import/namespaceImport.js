/**
 * Where imported files go in the library's namespaces. Files from a folder or zip come in the
 * folder's namespace, which the user may rename on import; where that namespace already has
 * different versions of the files, the user chooses to leave the loaded ones or overwrite them.
 * Files with no namespace of their own, such as a lone config or parameters file, go to the one
 * namespace that fits, and the user picks only when several do.
 */
import { processCellMLDataInBackground } from '../libcellml/cellmlImport'
import { parseMathRef } from '../../utils/config'
import {
  NO_NAMESPACE,
  baseNameOf,
  namespaceLabel,
  namespaceOfFileKey,
  namespaceOfModuleRef,
  pickTargetNamespace,
  renameFileNamespace,
  sanitiseNamespace,
} from '../../utils/namespaces'

const MAX_LISTED = 6

function describeClash({ kind, key }) {
  if (kind === 'math') {
    const { componentFile, componentName } = parseMathRef(key)
    return `math of ${componentName} in ${componentFile}`
  }
  if (kind === 'units') return `units in ${key}`
  const [type, subtype] = key.split(':')
  return `configuration ${type}:${subtype}`
}

/** The namespace a clash is in, '' for none. */
function namespaceOfClash({ kind, key }) {
  if (kind === 'module') return namespaceOfModuleRef(key) ?? NO_NAMESPACE
  return namespaceOfFileKey(kind === 'math' ? parseMathRef(key).componentFile : key) ?? NO_NAMESPACE
}

/** The file a clash is about, or null for a module's. */
function fileOfClash({ kind, key }) {
  if (kind === 'module') return null
  return kind === 'math' ? parseMathRef(key).componentFile : key
}

/**
 * What CellML files would add to the library, in the form findClashes takes.
 *
 * @param {Array<{ key: string, cellml: string }>} files - Library keys and the CellML to load under them.
 * @returns {Promise<{ mathFiles: Array, unitsFiles: Array }>}
 */
export async function incomingFromCellml(files) {
  const mathFiles = []
  const unitsFiles = []
  const results = await Promise.all(files.map(({ cellml }) => processCellMLDataInBackground(cellml, { hoist: true })))
  for (const [index, { key }] of files.entries()) {
    const result = results[index]
    if (result.type !== 'success') continue
    if (result.components?.length) mathFiles.push({ key, components: result.components })
    if (result.units.count) unitsFiles.push({ key, model: result.units.model })
  }
  return { mathFiles, unitsFiles }
}

/** A plan for when nothing is asked: every key loads as it is. */
export const AS_IS = Object.freeze({
  mapKey: (key) => key,
  isSkipped: () => false,
  isReplaced: () => false,
  clashes: [],
})

/**
 * A plan for loading files, after their namespaces are named and any clashes settled. Each method
 * takes a key as it was imported.
 *
 * @typedef {Object} NamespacePlan
 * @property {(key: string) => string} mapKey - The file key in the namespace the user chose.
 * @property {(key: string) => boolean} isSkipped - Whether to leave the file out: its namespace was
 *   cancelled, or it clashes where the user chose to leave the loaded files.
 * @property {(key: string) => boolean} isReplaced - Whether loading it should replace what the
 *   library holds, as the user chose to overwrite.
 * @property {Array<Object>} clashes - What was found, by findClashes; each holds both versions.
 */

/**
 * Asks which namespace each imported namespace goes in, then, for any already in use with
 * different versions of the files, whether to leave or overwrite them. Files with no namespace are
 * loaded as before, without asking.
 *
 * @param {string[]} keys - File keys as imported (see fileKeyFromPath).
 * @param {Object} deps
 * @param {Object} deps.store - The library store.
 * @param {Function} deps.prompt - From useConfirmDialog: resolves the text entered, or null.
 * @param {Function} deps.choose - From useConfirmDialog: resolves 'accept', 'extra' or 'reject'.
 * @param {(mapKey: (key: string) => string|null) => Object|Promise<Object>} deps.incomingFor - What the files would add, as
 *   findClashes takes it, under their mapped keys; mapKey gives null for a file being left out.
 * @returns {Promise<NamespacePlan>}
 */
export async function planNamespaceImport(keys, { store, prompt, choose, incomingFor }) {
  const imported = [...new Set(keys.map(namespaceOfFileKey).filter(Boolean))]
  if (!imported.length) return AS_IS

  const loaded = [...store.loadedNamespaces()].sort()
  const chosen = new Map()
  for (const namespace of imported) {
    const answer = await prompt({
      header: 'Import Into Namespace',
      message:
        `The files from "${namespace}" go in a namespace of the library, which keeps them apart from same-named ` +
        'files elsewhere. Name it, or leave it blank for none.',
      value: namespace,
      suggestions: loaded,
      hint: (value) => {
        const name = sanitiseNamespace(value)
        return loaded.includes(name) ? `"${name}" is in use: files it already has are checked next.` : ''
      },
      acceptLabel: 'Import',
      rejectLabel: 'Cancel',
    })
    chosen.set(namespace, answer === null ? undefined : sanitiseNamespace(answer))
  }

  const isCancelled = (key) => {
    const namespace = namespaceOfFileKey(key)
    return Boolean(namespace) && chosen.get(namespace) === undefined
  }
  const mapKey = (key) => {
    const namespace = namespaceOfFileKey(key)
    if (!namespace || chosen.get(namespace) === undefined) return key
    return renameFileNamespace(key, namespace, chosen.get(namespace) || null)
  }
  const targets = new Set([...chosen.values()].filter((value) => value !== undefined))

  const clashes = (await store.findClashes(await incomingFor((key) => (isCancelled(key) ? null : mapKey(key)))))
    .filter((clash) => targets.has(namespaceOfClash(clash)))
  const byNamespace = new Map()
  for (const clash of clashes) {
    const namespace = namespaceOfClash(clash)
    if (!byNamespace.has(namespace)) byNamespace.set(namespace, [])
    byNamespace.get(namespace).push(clash)
  }

  const left = new Set()
  const overwritten = new Set()
  const cancelled = new Set()
  for (const [namespace, found] of byNamespace) {
    const issues = found.slice(0, MAX_LISTED).map((clash) => ({ key: clash.key, message: describeClash(clash) }))
    if (found.length > MAX_LISTED) issues.push({ key: 'more', message: `…and ${found.length - MAX_LISTED} more` })
    const choice = await choose({
      header: 'Namespace Already in Use',
      message:
        `${namespaceLabel(namespace)} already has different versions of these. Leave the loaded ones and import ` +
        'the rest, or overwrite them?',
      issues,
      severity: 'warning',
      extraLabel: 'Leave',
      acceptLabel: 'Overwrite',
      rejectLabel: 'Cancel',
    })
    if (choice === 'extra') left.add(namespace)
    else if (choice === 'accept') overwritten.add(namespace)
    else cancelled.add(namespace)
  }

  const clashingFiles = new Set(clashes.map(fileOfClash).filter(Boolean))
  const targetOf = (key) => namespaceOfFileKey(mapKey(key)) ?? NO_NAMESPACE
  return {
    clashes,
    mapKey,
    isSkipped(key) {
      if (isCancelled(key)) return true
      if (!namespaceOfFileKey(key)) return false
      const target = targetOf(key)
      return cancelled.has(target) || (left.has(target) && clashingFiles.has(mapKey(key)))
    },
    isReplaced(key) {
      return Boolean(namespaceOfFileKey(key)) && overwritten.has(targetOf(key))
    },
  }
}

/**
 * Picks the namespace for files with none of their own: the one where what they refer to is
 * loaded, else the library's only namespace, else none; asking only when several fit.
 *
 * @param {Iterable<string>} matching - Namespaces ('' for none) that fit, such as those holding a
 *   config's math.
 * @param {Object} deps
 * @param {Object} deps.store - The library store.
 * @param {Function} deps.prompt - From useConfirmDialog.
 * @param {string} deps.what - What is being loaded, for the question, such as `config.json`.
 * @returns {Promise<string|null>} The namespace, '' for none; null when the user cancels.
 */
export async function chooseTargetNamespace(matching, { store, prompt, what }) {
  const picked = pickTargetNamespace(matching, store.loadedNamespaces())
  if (!picked.choices) return picked.namespace
  const answer = await prompt({
    header: 'Choose a Namespace',
    message: `Several namespaces could take ${what}. Which should it load into?`,
    value: picked.choices[0],
    choices: picked.choices.map((namespace) => ({ label: namespaceLabel(namespace), value: namespace })),
    acceptLabel: 'Load',
    rejectLabel: 'Cancel',
  })
  return answer === null ? null : answer
}

/**
 * The namespace a config file loads into: its own when it came in one, else the one holding the
 * math its configs name (chooseTargetNamespace).
 *
 * @param {string} key - The config file's key as imported.
 * @param {Object[]} configs
 * @param {Object} deps - As chooseTargetNamespace takes.
 * @param {NamespacePlan} [plan] - Where the config's own namespace went.
 * @param {Iterable<string>} [arriving] - Keys of CellML files loading with it, after the plan maps them.
 * @returns {Promise<string|null>} '' for none; null when the user cancels.
 */
export async function configNamespace(key, configs, deps, plan = AS_IS, arriving = []) {
  if (namespaceOfFileKey(key)) return namespaceOfFileKey(plan.mapKey(key)) ?? NO_NAMESPACE
  const files = new Set((Array.isArray(configs) ? configs : []).map((config) => baseNameOf(config?.component_file ?? '')))
  const matching = new Set(deps.store.namespacesWithFiles(files))
  for (const file of arriving) {
    if (files.has(baseNameOf(file))) matching.add(namespaceOfFileKey(file) ?? NO_NAMESPACE)
  }
  return chooseTargetNamespace(matching, { ...deps, what: key })
}
