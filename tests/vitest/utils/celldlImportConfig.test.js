// @vitest-environment happy-dom
import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { IMPORT_KEYS, IMPORT_LABELS } from '../../../src/utils/constants.js'
import { getImportConfig, hasRelevantExtension, isCelldl } from '../../../src/utils/import.js'
import { parseForRole } from '../../../src/utils/importBatch.js'

const RC = fs.readFileSync(path.resolve(__dirname, '../fixtures/celldl/rc.celldl'), 'utf8')
const field = getImportConfig(IMPORT_KEYS.CELLDL_FILE).fields[0]
const file = (name, text) => new File([text], name)

describe('CellDL import config', () => {
  it('takes .celldl files', () => {
    expect(field).toMatchObject({ key: IMPORT_KEYS.CELLDL_FILE, label: IMPORT_LABELS.CELLDL_FILE, accept: '.celldl' })
    expect(IMPORT_LABELS.CELLDL_FILE).toBe('CellDL Diagram (.celldl)')
    expect(hasRelevantExtension('rc.celldl')).toBe(true)
  })

  it('reads a CellDL document as its text', async () => {
    const result = await parseForRole(file('rc.celldl', RC), [field])

    expect(result).toMatchObject({ key: IMPORT_KEYS.CELLDL_FILE, data: RC })
  })

  it('rejects an SVG without CellDL metadata, and skips a file that is no SVG', async () => {
    const drawing = await parseForRole(file('drawing.celldl', '<svg xmlns="http://www.w3.org/2000/svg"><metadata/></svg>'), [field])
    expect(drawing.error).toContain('no CellDL metadata')
    expect(drawing.skip).toBeUndefined()

    const text = await parseForRole(file('notes.celldl', 'not a diagram'), [field])
    expect(text.skip).toBe(true)
  })

  it('skips files of other types', async () => {
    expect((await parseForRole(file('rc.cellml', RC), [field])).skip).toBe(true)
  })
})

describe('isCelldl', () => {
  it("finds CellDL's metadata element, with either quote", () => {
    expect(isCelldl(RC)).toBe(true)
    expect(isCelldl("<svg><metadata data-x='1' id='celldl-rdf-metadata'></metadata></svg>")).toBe(true)
    expect(isCelldl('<svg><metadata id="other"></metadata></svg>')).toBe(false)
    expect(isCelldl('<metadata id="celldl-rdf-metadata"/>')).toBe(false)
    expect(isCelldl(null)).toBe(false)
  })
})
