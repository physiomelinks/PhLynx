import { describe, expect, it, vi } from 'vitest'

import { getBuiltInTemplate } from '../../../../src/services/bioView/builtInTemplates.js'
import {
  MAX_TEMPLATE_FILE_BYTES,
  freeLocalId,
  parseTemplateText,
  readTemplateFile,
  summariseProblems,
  templateFile,
} from '../../../../src/services/bioView/templateFiles.js'
import {
  bareTemplateId,
  isLocalTemplateId,
  validateTemplate,
} from '../../../../src/services/bioView/templates.js'

const plain = (value) => JSON.parse(JSON.stringify(value))
const epithelial = () => plain(getBuiltInTemplate('epithelial-cell'))

describe('local template ids', () => {
  it('recognises and strips the local prefix', () => {
    expect(isLocalTemplateId('local:my-cell')).toBe(true)
    expect(isLocalTemplateId('my-cell')).toBe(false)
    expect(isLocalTemplateId('local:My Cell')).toBe(false)
    expect(isLocalTemplateId(undefined)).toBe(false)
    expect(bareTemplateId('local:my-cell')).toBe('my-cell')
    expect(bareTemplateId('my-cell')).toBe('my-cell')
  })

  it('accepts a local id only when asked to', () => {
    const raw = { ...epithelial(), id: 'local:my-cell' }
    expect(validateTemplate(raw).errors).toEqual([
      'Template: "id" must start with a letter and use only lower-case letters, digits and hyphens (2-48 characters).',
    ])
    expect(validateTemplate(raw, { allowLocalId: true }).template.id).toBe('local:my-cell')
    expect(validateTemplate(epithelial(), { allowLocalId: true }).template.id).toBe('epithelial-cell')
    expect(validateTemplate({ ...raw, id: 'local:Bad' }, { allowLocalId: true }).template).toBeNull()
    expect(validateTemplate({ ...raw, id: 'local:' }, { allowLocalId: true }).template).toBeNull()
  })

  it('picks a free local id, numbering when taken and keeping within 48 characters', () => {
    expect(freeLocalId('cell', [])).toBe('local:cell')
    expect(freeLocalId('local:cell', ['cell'])).toBe('local:cell')
    expect(freeLocalId('cell', ['local:cell', 'local:cell-2'])).toBe('local:cell-3')
    const long = 'a'.repeat(48)
    const id = freeLocalId(long, [`local:${long}`])
    expect(id).toBe(`local:${'a'.repeat(46)}-2`)
    expect(isLocalTemplateId(id)).toBe(true)
  })
})

describe('template files', () => {
  it('parses JSON and words what is wrong with text that is not', () => {
    expect(parseTemplateText('{"id": "x"}')).toEqual({ raw: { id: 'x' }, errors: [] })
    expect(parseTemplateText('  ')).toEqual({ raw: undefined, errors: ['The file is empty.'] })
    const { raw, errors } = parseTemplateText('{ "id": ')
    expect(raw).toBeUndefined()
    expect(errors[0]).toMatch(/^The file is not valid JSON: /)
  })

  it('lists the first few problems and counts the rest', () => {
    expect(summariseProblems(['a'])).toBe('a')
    expect(summariseProblems(['a', 'b', 'c'])).toBe('a<br>b<br>c')
    expect(summariseProblems(['a', 'b', 'c', 'd', 'e'])).toBe('a<br>b<br>c<br>…and 2 more.')
    expect(summariseProblems(['a', 'b'], 1)).toBe('a<br>…and 1 more.')
  })

  it('escapes what the problems quote from the file', () => {
    expect(summariseProblems(['Cell "<img src=x onerror=alert(1)>" & co'])).toBe(
      'Cell &quot;&lt;img src=x onerror=alert(1)&gt;&quot; &amp; co'
    )
  })

  it('writes a template under its own id, without the local prefix or a $schema', () => {
    const template = validateTemplate({ ...epithelial(), id: 'local:my-cell' }, { allowLocalId: true }).template
    const { filename, text } = templateFile(template)
    expect(filename).toBe('my-cell.template.json')
    const raw = JSON.parse(text)
    expect(raw.id).toBe('my-cell')
    expect(raw).not.toHaveProperty('$schema')
    expect(text.endsWith('\n')).toBe(true)
    expect(validateTemplate(raw)).toEqual({ template: { ...template, id: 'my-cell' }, errors: [], warnings: [] })
  })
})

describe('readTemplateFile', () => {
  it('parses a file it can read', async () => {
    const file = new Blob([JSON.stringify({ id: 'a' })])
    expect(await readTemplateFile(file)).toEqual({ raw: { id: 'a' }, errors: [] })
  })

  it('refuses a file too big to be a template without reading it', async () => {
    const text = vi.fn()
    const { raw, errors } = await readTemplateFile({ size: MAX_TEMPLATE_FILE_BYTES + 1, text })
    expect(raw).toBeUndefined()
    expect(errors).toEqual(['The file is too big to be a template (over 1024 KB).'])
    expect(text).not.toHaveBeenCalled()
  })

  it('reports a file that cannot be read', async () => {
    const file = { size: 10, text: () => Promise.reject(new Error('gone')) }
    expect(await readTemplateFile(file)).toEqual({ raw: undefined, errors: ['The file could not be read: gone'] })
  })

  it('reports garbage as not JSON', async () => {
    const { raw, errors } = await readTemplateFile(new Blob(['\u0000ÿ{{']))
    expect(raw).toBeUndefined()
    expect(errors[0]).toMatch(/^The file is not valid JSON/)
  })
})
