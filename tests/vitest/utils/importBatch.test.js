// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'

import { IMPORT_KEYS } from '../../../src/utils/constants.js'
import { getImportConfig } from '../../../src/utils/import.js'
import {
  buildBatchSummary,
  escapeHtml,
  parseForRole,
  planBatchEntries,
  providesMissingModule,
  requiredCellMLFilenames,
} from '../../../src/utils/importBatch.js'

const MODULES_CSV = 'name,module_type,module_subtype,inp_instances,out_instances\nheart,heart,simple,,\n'
const PARAMETERS_CSV = 'variable_name,units,value,data_reference\nk,second,1,ref\n'
const CONFIG = [
  {
    entrance_ports: [],
    exit_ports: [],
    general_ports: [],
    module_type: 'heart',
    module_subtype: 'simple',
    module_format: 'cellml',
    component_file: 'heart.cellml',
    component_type: 'heart_simple',
  },
]

const entry = (path, text = '') => ({ file: new File([text], path.split('/').pop()), path })
const fieldFor = (key) => getImportConfig(key).fields[0]
const csvCandidates = () => [fieldFor(IMPORT_KEYS.INSTANCE_ARRAY), fieldFor(IMPORT_KEYS.PARAMETER)]
const emptyStore = { availableModules: new Map(), availableMath: new Map() }

describe('planBatchEntries', () => {
  it('gives the same order whatever order the filesystem lists files in', () => {
    const files = ['folder/parameters.csv', 'folder/b.cellml', 'folder/modules.csv', 'folder/config.json']
    const forward = planBatchEntries(files.map((path) => entry(path)))
    const backward = planBatchEntries([...files].reverse().map((path) => entry(path)))

    const paths = (plan) => plan.ordered.map((e) => e.path)
    expect(paths(forward)).toEqual(paths(backward))
    expect(paths(forward)).toEqual(['folder/modules.csv', 'folder/parameters.csv', 'folder/config.json', 'folder/b.cellml'])
  })

  it('keeps the shallowest copy of a repeated file name and reports the rest', () => {
    const { ordered, duplicates } = planBatchEntries([entry('folder/old/modules.csv'), entry('folder/modules.csv')])

    expect(ordered.map((e) => e.path)).toEqual(['folder/modules.csv'])
    expect(duplicates).toEqual([{ name: 'folder/old/modules.csv', reason: 'same name as folder/modules.csv' }])
  })
})

describe('parseForRole', () => {
  it('reads an instance array CSV as the instance array even when parameters is preferred', async () => {
    const [instanceField, parameterField] = csvCandidates()
    const result = await parseForRole(entry('a.csv', MODULES_CSV).file, [parameterField, instanceField], {
      store: emptyStore,
    })

    expect(result.key).toBe(IMPORT_KEYS.INSTANCE_ARRAY)
    expect(result.data).toHaveLength(1)
  })

  it('reads a parameters file as parameters', async () => {
    const result = await parseForRole(entry('b.csv', PARAMETERS_CSV).file, csvCandidates(), { store: emptyStore })

    expect(result.key).toBe(IMPORT_KEYS.PARAMETER)
  })

  it('names the missing columns of the closest format', async () => {
    const text = 'name,module_type,module_subtype,inp_instances\nheart,heart,simple,\n'
    const result = await parseForRole(entry('modules.csv', text).file, csvCandidates(), { store: emptyStore })

    expect(result.unrecognised).toBeUndefined()
    expect(result.error).toContain('Missing columns: out_instances')
  })

  it('reports a file that shares nothing with any format as unrecognised', async () => {
    const result = await parseForRole(entry('results.csv', 'time,pressure\n0,1\n').file, csvCandidates(), {
      store: emptyStore,
    })

    expect(result).toEqual({ error: 'not an instance array or parameters file', unrecognised: true })
  })

  it('explains malformed JSON', async () => {
    const result = await parseForRole(entry('config.json', '[{').file, [fieldFor(IMPORT_KEYS.MODULE_CONFIG)])

    expect(result.error).toMatch(/^not valid JSON/)
  })

  it('reads a module configuration', async () => {
    const result = await parseForRole(entry('config.json', JSON.stringify(CONFIG)).file, [
      fieldFor(IMPORT_KEYS.MODULE_CONFIG),
    ])

    expect(result.key).toBe(IMPORT_KEYS.MODULE_CONFIG)
    expect(result.data).toEqual(CONFIG)
  })

  it('rejects CellML that the processor cannot read, giving its reason', async () => {
    const cellmlField = {
      key: IMPORT_KEYS.CELLML_FILE,
      accept: '.cellml, .xml',
      parser: async () => '<model/>',
      processUpload: 'cellml',
    }
    const processCellML = vi.fn(() => ({ type: 'parser', issues: [{ description: 'Bad units.' }] }))
    const result = await parseForRole(entry('heart.cellml').file, [cellmlField], { processCellML })

    expect(result.error).toBe('Invalid CellML: Bad units.')
  })

  it('rejects configs that cannot be normalised', async () => {
    const broken = JSON.stringify([{ ...CONFIG[0], variables_and_units: null }])
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await parseForRole(entry('config.json', broken).file, [
      { ...fieldFor(IMPORT_KEYS.MODULE_CONFIG), processUpload: 'config' },
    ])

    expect(result.key).toBeUndefined()
    expect(result.error).toBeTruthy()
  })

  it('marks files that no candidate accepts as unsupported', async () => {
    const result = await parseForRole(entry('archive.omex').file, csvCandidates())

    expect(result.unsupported).toBe(true)
  })
})

describe('readiness helpers', () => {
  const status = {
    resourcesAreLoaded: false,
    missingResources: { modules: new Set(['heart:simple']), math: new Set(['heart.cellml:heart_simple']) },
  }

  it('lists required CellML file names', () => {
    expect([...requiredCellMLFilenames(status)]).toEqual(['heart.cellml'])
    expect(requiredCellMLFilenames(null).size).toBe(0)
  })

  it('detects configs that supply a missing module', () => {
    expect(providesMissingModule(CONFIG, status)).toBe(true)
    expect(providesMissingModule([{ ...CONFIG[0], module_subtype: 'other' }], status)).toBe(false)
  })
})

describe('buildBatchSummary', () => {
  const base = {
    placed: [{ name: 'modules.csv', key: IMPORT_KEYS.INSTANCE_ARRAY }],
    failed: [],
    skipped: [],
    isInstanceArrayImport: true,
    hasInstanceArray: true,
    readiness: { resourcesAreLoaded: true, missingResources: { modules: new Set(), math: new Set() } },
  }

  it('reports success when everything is ready', () => {
    const summary = buildBatchSummary(base)

    expect(summary).toMatchObject({ type: 'success', title: 'Ready to Import', duration: 3000 })
  })

  it('lists what is still missing', () => {
    const summary = buildBatchSummary({
      ...base,
      readiness: {
        resourcesAreLoaded: false,
        missingResources: { modules: new Set(['heart:simple']), math: new Set() },
      },
    })

    expect(summary.type).toBe('warning')
    expect(summary.message).toContain('Missing configurations for: heart:simple')
  })

  it('never claims readiness without an instance array', () => {
    const summary = buildBatchSummary({ ...base, hasInstanceArray: false, readiness: null })

    expect(summary.title).toBe('Instance Array Needed')
    expect(summary.message).not.toContain('Ready')
  })

  it('groups reasons, caps lists and escapes names', () => {
    const skipped = Array.from({ length: 7 }, (_, i) => ({ name: `<b>${i}</b>.omex`, reason: 'unsupported' }))
    const summary = buildBatchSummary({ ...base, skipped, failed: [{ name: 'x.json', reason: 'not valid JSON' }] })

    expect(summary.type).toBe('warning')
    expect(summary.message).toContain('Not added: x.json — not valid JSON')
    expect(summary.message).toContain('…and 2 more — unsupported')
    expect(summary.message).toContain('&lt;b&gt;0&lt;/b&gt;.omex')
  })

  it('reports an error when nothing was added', () => {
    const summary = buildBatchSummary({ ...base, placed: [], skipped: [{ name: 'a.omex', reason: 'unsupported' }] })

    expect(summary).toMatchObject({ type: 'error', title: 'Nothing Added', duration: 6000 })
  })

  it('includes files added from the connected folder', () => {
    const summary = buildBatchSummary({ ...base, autoFill: { count: 2, folderName: 'models' } })

    expect(summary.message).toContain('Added 1 file and 2 files from connected folder "models".')
  })
})

describe('escapeHtml', () => {
  it('escapes markup characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
  })
})
