/**
 * Small saved workspaces built in code, one per format version, for testing migration and the saved format.
 *
 * Each version's module exports its `version`, a `base()` holding the envelope and what every file of it has,
 * and `cases`: named edge cases its migration handles, each a function returning the part of a workspace (nodes,
 * edges, store entries, settings) that holds it. A case's nodes and store entries are its own, so cases build alone
 * or together. To add a format version, add a module like v1-3-0.js and list it in VERSIONS.
 */
import { mergeParts } from './builders.js'
import * as legacy from './legacy.js'
import * as v1_0_0 from './v1-0-0.js'
import * as v1_1_0 from './v1-1-0.js'
import * as v1_2_0 from './v1-2-0.js'
import * as v1_3_0 from './v1-3-0.js'

const VERSIONS = [legacy, v1_0_0, v1_1_0, v1_2_0, v1_3_0]
const byVersion = new Map(VERSIONS.map((module) => [module.version, module]))

/** Every format version with a synthetic workspace, oldest first. */
export const SYNTHETIC_VERSIONS = VERSIONS.map(({ version }) => version)

/**
 * Gets the names of a version's cases.
 *
 * @param {string} version - e.g. 'legacy' or '1.2.0'.
 * @returns {Array<string>}
 */
export const syntheticCaseNames = (version) => Object.keys(versionModule(version).cases)

/**
 * Builds a version's synthetic workspace.
 *
 * @param {string} version
 * @param {Array<string>} [caseNames] - The cases to hold; every case when not given.
 * @returns {Object} A parsed workspace file of that version.
 */
export function syntheticWorkspace(version, caseNames = syntheticCaseNames(version)) {
  const { base, cases } = versionModule(version)
  return mergeParts(
    base(),
    ...caseNames.map((name) => {
      if (!cases[name]) throw new Error(`No synthetic ${version} case '${name}'.`)
      return cases[name]()
    })
  )
}

/**
 * Builds a version's synthetic workspace holding one case.
 *
 * @param {string} version
 * @param {string} caseName
 * @returns {Object}
 */
export const syntheticCase = (version, caseName) => syntheticWorkspace(version, [caseName])

/** Gets a version's module, throwing for a version with none. */
function versionModule(version) {
  const module = byVersion.get(version)
  if (!module) throw new Error(`No synthetic workspace for format ${version}.`)
  return module
}
