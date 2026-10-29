import fs from 'node:fs'
import path from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'
import { PHLYNX_PROJECT_VERSION } from '../../../src/utils/constants'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'
import { SYNTHETIC_VERSIONS, syntheticCaseNames, syntheticWorkspace } from '../helpers/syntheticWorkspaces/index.js'
import { loadAndSave } from '../helpers/workspaceSave.js'

const SHAPE_FILE = path.resolve(process.cwd(), 'tests/resources/migration-versioning/shapes', `${PHLYNX_PROJECT_VERSION}.json`)

// Cases holding saved fields a released shape doesn't record, as its fixtures never held them; `<version>/<case>`.
// A shape recorded from 1.3.0 on records them.
const UNRECORDED = {
  '1.2.0': new Set(['legacy/domainType', '1.2.0/inspectionPlotSelection', '1.2.0/parameterScanLabel']),
}

// Objects keyed by data (a diagram's element ids) rather than by field name; their keys aren't part of the format.
const DATA_KEYED_PATHS = new Set(['store.mathSources[][].elements'])

const SHAPE_CHANGED = `The saved workspace file's shape no longer matches format ${PHLYNX_PROJECT_VERSION}.
Any change to the saved file needs a new format version: bump PHLYNX_PROJECT_VERSION, add a migration step
in src/services/workspaceMigrator.js, and add a synthetic case for the change to the new version's workspace in
tests/vitest/helpers/syntheticWorkspaces, not a fixture file.
If ${PHLYNX_PROJECT_VERSION} has not reached production yet, amend its migration step instead.
Then regenerate the shape with UPDATE_WORKSPACE_SHAPE=1 yarn vitest run tests/vitest/services/workspaceFormat.test.js.
Never edit the shape of a released version.`

/**
 * Collects the key paths of a value. Array elements share one path, as do the entries of a data-keyed object (`*`).
 *
 * @param {*} value
 * @param {string} prefix - The path so far.
 * @param {Set<string>} paths - Collected into.
 */
function collectPaths(value, prefix, paths) {
  if (Array.isArray(value)) {
    for (const element of value) collectPaths(element, `${prefix}[]`, paths)
    return
  }
  if (!value || typeof value !== 'object') return

  for (const [key, child] of Object.entries(value)) {
    const childPath = DATA_KEYED_PATHS.has(prefix) ? `${prefix}.*` : prefix ? `${prefix}.${key}` : key
    paths.add(childPath)
    collectPaths(child, childPath, paths)
  }
}

describe('workspace file format', () => {
  beforeAll(async () => {
    await ensureLibCellmlReady()
  })

  it(`saves the shape recorded for format ${PHLYNX_PROJECT_VERSION}`, { timeout: 60000 }, () => {
    expect(SYNTHETIC_VERSIONS, `No synthetic workspace for format ${PHLYNX_PROJECT_VERSION}.\n${SHAPE_CHANGED}`).toContain(
      PHLYNX_PROJECT_VERSION
    )

    // Every version, since only migrating older files runs the code that builds rows.
    const unrecorded = UNRECORDED[PHLYNX_PROJECT_VERSION] ?? new Set()
    for (const entry of unrecorded) {
      const [version, name] = entry.split('/')
      expect(syntheticCaseNames(version), `UNRECORDED names no case ${entry}.`).toContain(name)
    }
    const paths = new Set()
    for (const version of SYNTHETIC_VERSIONS) {
      const caseNames = syntheticCaseNames(version).filter((name) => !unrecorded.has(`${version}/${name}`))
      collectPaths(loadAndSave(syntheticWorkspace(version, caseNames)), '', paths)
    }
    const shape = [...paths].sort()

    if (process.env.UPDATE_WORKSPACE_SHAPE) {
      fs.mkdirSync(path.dirname(SHAPE_FILE), { recursive: true })
      fs.writeFileSync(SHAPE_FILE, `${JSON.stringify({ version: PHLYNX_PROJECT_VERSION, paths: shape }, null, 2)}\n`)
    }

    expect(fs.existsSync(SHAPE_FILE), `No recorded shape for format ${PHLYNX_PROJECT_VERSION}.\n${SHAPE_CHANGED}`).toBe(true)
    const recorded = JSON.parse(fs.readFileSync(SHAPE_FILE, 'utf8'))
    expect(shape, SHAPE_CHANGED).toEqual(recorded.paths)
  })
})
