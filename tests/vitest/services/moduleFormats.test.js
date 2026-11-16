import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MODULE_FORMAT,
  MODULE_FORMATS,
  checkMathSource,
  getEditorTabFormats,
  getModuleFormat,
} from '../../../src/services/moduleFormats.js'

describe('module formats', () => {
  it('treats a missing format as CellML', () => {
    for (const id of [undefined, null, '']) expect(getModuleFormat(id)).toBe(MODULE_FORMATS[DEFAULT_MODULE_FORMAT])
    expect(getModuleFormat('cellml').isMathLocked).toBe(false)
  })

  it('locks the math of a CellDL module, which still exports as CellML', () => {
    const format = getModuleFormat('celldl')
    expect(format).toMatchObject({ id: 'celldl', label: 'CellDL', isMathLocked: true, caModuleFormat: 'cellml' })
  })

  it('gives an unknown format a locked, unavailable fallback named after it', () => {
    const format = getModuleFormat('python')
    expect(format).toMatchObject({ id: 'python', label: 'python', isMathLocked: true, isAvailable: false })
  })

  it('offers the CellDL editor tab, locked for other formats with a note on where diagrams start', () => {
    expect(getEditorTabFormats().map((format) => format.id)).toEqual(['celldl'])
    expect(getModuleFormat('celldl').editorTab).toMatchObject({
      value: 'celldl',
      label: 'CellDL (beta)',
      lockedNotice: 'CellDL diagrams can only start from the template',
    })
    expect(getModuleFormat('cellml').editorTab).toBeUndefined()
  })

  it('does not look formats up on the object prototype', () => {
    expect(getModuleFormat('toString').isMathLocked).toBe(true)
  })

  it('cannot be changed', () => {
    expect(Object.isFrozen(MODULE_FORMATS)).toBe(true)
    expect(Object.isFrozen(MODULE_FORMATS.cellml)).toBe(true)
  })
})

describe('checking a math source', () => {
  const source = { format: 'celldl', document: '<svg/>', documentUri: 'https://example.org/rc.celldl', elements: {} }

  it('keeps a well-formed source as it is, unknown fields too', () => {
    expect(checkMathSource(source)).toBe(source)
    expect(checkMathSource({ ...source, document: null })).not.toBeNull()
    const newer = { ...source, format: 'python', extra: 1 }
    expect(checkMathSource(newer)).toBe(newer)
  })

  it('drops a malformed source', () => {
    for (const bad of [
      null,
      'celldl',
      [],
      { ...source, format: '' },
      { ...source, format: 3 },
      { ...source, document: 1 },
      { ...source, document: undefined },
      { ...source, documentUri: null },
    ]) {
      expect(checkMathSource(bad)).toBeNull()
    }
  })
})
