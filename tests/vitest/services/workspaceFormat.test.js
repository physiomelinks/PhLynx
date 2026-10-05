import fs from 'node:fs'
import path from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'
import { PHLYNX_PROJECT_VERSION } from '../../../src/utils/constants'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'
import { loadAndSave } from '../helpers/workspaceSave.js'

const RESOURCES_DIR = path.resolve(process.cwd(), 'tests/resources/migration-versioning')
const FIXTURE_DIR = path.join(RESOURCES_DIR, `v${PHLYNX_PROJECT_VERSION.replaceAll('.', '-')}`)
const SHAPE_FILE = path.join(RESOURCES_DIR, 'shapes', `${PHLYNX_PROJECT_VERSION}.json`)
const ERAS = fs.readdirSync(RESOURCES_DIR).filter((name) => name === 'legacy' || /^v\d+-\d+-\d+$/.test(name))

// Objects keyed by data (e.g. node ids) rather than by field name; their keys aren't part of the format.
const MAP_PATHS = new Set(['simulation.plotConfig', 'simulation.parameterScanConfig'])

const SHAPE_CHANGED = `The saved workspace file's shape no longer matches format ${PHLYNX_PROJECT_VERSION}.
Any change to the saved file needs a new format version: bump PHLYNX_PROJECT_VERSION and add a
migration step in src/services/workspaceMigrator.js, plus a fixture in tests/resources/migration-versioning.
If ${PHLYNX_PROJECT_VERSION} has not reached production yet, amend its migration step instead.
Then regenerate the shape with UPDATE_WORKSPACE_SHAPE=1 yarn vitest run tests/vitest/services/workspaceFormat.test.js.
Never edit the shape of a released version.`

/**
 * Collects the key paths of a value. Array elements share one path, and map objects one key.
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

  const isMap = MAP_PATHS.has(prefix)
  for (const [key, child] of Object.entries(value)) {
    const childPath = isMap ? `${prefix}{*}` : prefix ? `${prefix}.${key}` : key
    paths.add(childPath)
    collectPaths(child, childPath, paths)
  }
}

describe('workspace file format', () => {
  beforeAll(async () => {
    await ensureLibCellmlReady()
  })

  it(`saves the shape recorded for format ${PHLYNX_PROJECT_VERSION}`, { timeout: 60000 }, () => {
    expect(fs.existsSync(FIXTURE_DIR), `No fixture folder for format ${PHLYNX_PROJECT_VERSION}.\n${SHAPE_CHANGED}`).toBe(true)

    // Every era, since only migrating older files runs the code that builds rows.
    const paths = new Set()
    for (const era of ERAS) {
      for (const file of fs.readdirSync(path.join(RESOURCES_DIR, era)).filter((name) => name.endsWith('.json'))) {
        collectPaths(loadAndSave(JSON.parse(fs.readFileSync(path.join(RESOURCES_DIR, era, file), 'utf8'))), '', paths)
      }
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
