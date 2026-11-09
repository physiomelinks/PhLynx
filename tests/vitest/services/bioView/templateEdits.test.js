import { describe, expect, it, vi } from 'vitest'

import { getBuiltInTemplate } from '../../../../src/services/bioView/builtInTemplates.js'
import { scaffoldFromTemplates } from '../../../../src/services/bioView/scaffold.js'
import {
  addToEdits,
  editedTemplate,
  freePieceId,
  instanceTemplate,
  normaliseEdits,
  removeFromEdits,
  sitesOf,
} from '../../../../src/services/bioView/templates.js'

const synapse = getBuiltInTemplate('chemical-synapse')
const epithelial = getBuiltInTemplate('epithelial-cell')
const definitions = new Map([synapse, epithelial].map((template) => [template.id, template]))

describe('a placed template’s own additions', () => {
  it('keeps only pieces it can read, and nothing when there are none', () => {
    expect(normaliseEdits(undefined)).toBeNull()
    expect(normaliseEdits({ added: { facets: [], other: [1] } })).toBeNull()
    expect(normaliseEdits({ added: { processes: [{ cell: 'pre', id: 'zone-1', label: 'Z' }, 'junk'] } })).toEqual({
      added: { processes: [{ cell: 'pre', id: 'zone-1', label: 'Z' }] },
    })
  })

  it('adds a protein site on a free edge, a compartment against a facet and a process zone, each a site', () => {
    let edits = null
    for (const [kind, piece] of [
      ['facets', { cell: 'post', id: 'site-1', label: 'Protein site (bottom)', edge: 'bottom' }],
      ['compartments', { id: 'compartment-1', label: 'Glia', against: ['post.site-1'], tone: 'lime' }],
      ['processes', { cell: 'post', id: 'zone-1', label: 'Process zone 1' }],
    ]) {
      const result = addToEdits(synapse, edits, kind, piece)
      expect(result.errors).toEqual([])
      edits = result.edits
    }
    const { template } = editedTemplate(synapse, edits)
    const paths = sitesOf(template).map((site) => site.path)
    expect(paths).toEqual(expect.arrayContaining(['post.site-1', 'compartment-1', 'post.zone-1']))
    // The template itself is untouched.
    expect(sitesOf(synapse).map((site) => site.path)).not.toContain('post.site-1')
  })

  it('refuses a piece that doesn’t fit, saying why', () => {
    const taken = addToEdits(epithelial, null, 'facets', { cell: 'cell', id: 'site-1', label: 'Again', edge: 'top' })
    expect(taken.edits).toBeNull()
    expect(taken.errors.join(' ')).toMatch(/top edge already has facet "apical"/)
    const nowhere = addToEdits(epithelial, null, 'processes', { cell: 'nope', id: 'zone-1', label: 'Z' })
    expect(nowhere).toEqual({ edits: null, errors: ['There is no cell "nope" to add "zone-1" to.'] })
  })

  it('picks ids free in the cell, or among every cell and compartment', () => {
    expect(freePieceId(epithelial, 'zone', 'cell')).toBe('zone-1')
    const { template } = editedTemplate(epithelial, {
      added: { processes: [{ cell: 'cell', id: 'zone-1', label: 'Z' }], compartments: [{ id: 'compartment-1', label: 'C' }] },
    })
    expect(freePieceId(template, 'zone', 'cell')).toBe('zone-2')
    expect(freePieceId(template, 'compartment')).toBe('compartment-2')
  })

  it('draws each placement with its own additions, worked out once, and ignores ones that no longer fit', () => {
    const edits = { added: { processes: [{ cell: 'cell', id: 'zone-1', label: 'Zone' }] } }
    const instances = [
      { id: 'bt-1', template: 'epithelial-cell', at: { x: 0, y: 0 }, edits },
      { id: 'bt-2', template: 'epithelial-cell', at: { x: 900, y: 0 } },
    ]
    expect(instanceTemplate(instances[0], definitions)).toBe(instanceTemplate({ ...instances[0] }, definitions))
    expect(instanceTemplate(instances[1], definitions)).toBe(epithelial)
    const { cells } = scaffoldFromTemplates(instances, definitions)
    expect(cells.map((cell) => cell.processes.map((process) => process.id))).toEqual([['metabolism', 'zone-1'], ['metabolism']])

    // An equal copy of the edits, as an undo or a move makes, draws the same template.
    expect(instanceTemplate({ ...instances[0], edits: structuredClone(edits) }, definitions)).toBe(
      instanceTemplate(instances[0], definitions)
    )

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const broken = { id: 'bt-3', template: 'epithelial-cell', at: { x: 0, y: 0 }, edits: { added: { facets: [{ cell: 'cell', id: 'x', label: 'X', edge: 'top' }] } } }
    expect(instanceTemplate(broken, definitions)).toBe(epithelial)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('keeps only the latest few versions of a placement’s edits', () => {
    const zone = (n) => ({ added: { processes: [{ cell: 'cell', id: `zone-${n}`, label: `Zone ${n}` }] } })
    const at = { x: 0, y: 0 }
    const first = instanceTemplate({ id: 'bt-1', template: 'epithelial-cell', at, edits: zone(1) }, definitions)
    // Still known while it is among the latest.
    expect(instanceTemplate({ id: 'bt-1', template: 'epithelial-cell', at, edits: zone(1) }, definitions)).toBe(first)
    for (let n = 2; n <= 40; n++) instanceTemplate({ id: 'bt-1', template: 'epithelial-cell', at, edits: zone(n) }, definitions)
    const again = instanceTemplate({ id: 'bt-1', template: 'epithelial-cell', at, edits: zone(1) }, definitions)
    expect(again).not.toBe(first)
    expect(again).toEqual(first)
  })
})

describe('removing from a placed template', () => {
  const paths = (edits, template = epithelial) => sitesOf(editedTemplate(template, edits).template).map((site) => site.path)

  it('keeps removed paths it can read, once each', () => {
    expect(normaliseEdits({ removed: ['paracellular', 'paracellular', 'Bad Path', 3] })).toEqual({ removed: ['paracellular'] })
  })

  it('removes a compartment, a facet with what lies against it, and a cell’s membrane or process', () => {
    expect(paths(removeFromEdits(epithelial, null, 'paracellular').edits)).not.toContain('paracellular')
    const facet = removeFromEdits(epithelial, null, 'cell.apical').edits
    expect(facet).toEqual({ removed: ['cell.apical'] })
    expect(paths(facet)).not.toEqual(expect.arrayContaining(['cell.apical']))
    expect(paths(facet)).not.toContain('apical-fluid')
    expect(paths(removeFromEdits(epithelial, null, 'cell.membrane').edits)).not.toContain('cell.membrane')
    expect(paths(removeFromEdits(epithelial, null, 'cell.metabolism').edits)).not.toContain('cell.metabolism')
  })

  it('removes a whole cell with its facets and processes; compartments keep to the cells left', () => {
    const two = getBuiltInTemplate('two-cell-epithelium')
    const { edits, errors } = removeFromEdits(two, null, 'b')
    expect(errors).toEqual([])
    const { template } = editedTemplate(two, edits)
    expect(template.cells.map((cell) => cell.id)).toEqual(['a'])
    const against = Object.fromEntries(template.compartments.map((c) => [c.id, c.against]))
    // The bands span only cell a now, and the gap runs down its side.
    expect(against).toEqual({ 'apical-fluid': ['a.apical'], 'basolateral-fluid': ['a.basolateral'], paracellular: ['a.lateral-right'] })
    // One against nothing else goes with it.
    expect(paths(removeFromEdits(epithelial, null, 'cell.lateral-right').edits)).not.toContain('paracellular')
  })

  it('takes an added piece out of the additions, with what was added against it', () => {
    let { edits } = addToEdits(synapse, null, 'facets', { cell: 'post', id: 'site-1', label: 'Site', edge: 'bottom' })
    ;({ edits } = addToEdits(synapse, edits, 'compartments', { id: 'compartment-1', label: 'C', against: ['post.site-1'] }))
    ;({ edits } = addToEdits(synapse, edits, 'processes', { cell: 'post', id: 'zone-1', label: 'Z' }))
    expect(removeFromEdits(synapse, edits, 'post.site-1').edits).toEqual({
      added: { processes: [{ cell: 'post', id: 'zone-1', label: 'Z' }] },
    })
    // A cell removed takes what was added in it.
    expect(removeFromEdits(synapse, edits, 'post').edits).toEqual({ removed: ['post'] })
    expect(removeFromEdits(synapse, { added: { processes: [{ cell: 'post', id: 'zone-1', label: 'Z' }] } }, 'post.zone-1').edits).toBeNull()
  })

  it('refuses to remove what the template can’t do without, keeping the changes as they were', () => {
    const edits = { removed: ['paracellular'] }
    const last = removeFromEdits(epithelial, edits, 'cell')
    expect(last.edits).toBe(edits)
    expect(last.errors.join(' ')).toMatch(/"cells" must be a non-empty list/)
  })

  it('keeps a removed piece’s id from being reused, so restoring it can’t clash', () => {
    const local = editedTemplate(epithelial, {
      added: { processes: [{ cell: 'cell', id: 'zone-1', label: 'Z' }] },
    }).template
    const { template } = editedTemplate(local, { removed: ['cell.zone-1'] })
    expect(freePieceId(template, 'zone', 'cell')).toBe('zone-1')
    expect(freePieceId(template, 'zone', 'cell', ['cell.zone-1'])).toBe('zone-2')
    expect(freePieceId(template, 'zone', 'cell', ['zone-2'])).toBe('zone-1')
  })
})

