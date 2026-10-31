import { describe, expect, it, vi } from 'vitest'

import schema from '../../../../src/assets/bio_templates/bio-template.schema.json'
import { FACETS } from '../../../../src/services/annotations/apicoord.js'
import {
  BUILT_IN_TEMPLATES,
  getBuiltInTemplate,
  loadBuiltInTemplates,
} from '../../../../src/services/bioView/builtInTemplates.js'
import {
  ANNOTATION_FACETS,
  ANNOTATION_SIDES,
  EDGES,
  LIMITS,
  PIECE_ID,
  TEMPLATE_ID,
  TEMPLATE_KEYS,
  TONES,
  compartmentForm,
  parseSiteRef,
  siteRef,
  sitesOf,
  validateTemplate,
} from '../../../../src/services/bioView/templates.js'

const files = import.meta.glob('../../../../src/assets/bio_templates/*.template.json', { eager: true })

const facet = (id, edge, extra = {}) => ({ id, label: `${id} membrane`, edge, ...extra })
const fourFacets = () => [facet('apical', 'top'), facet('basolateral', 'bottom'), facet('left', 'left'), facet('right', 'right')]
const cell = (id, extra = {}) => ({ id, label: `Cell ${id}`, facets: fourFacets(), ...extra })
const base = (extra = {}) => ({ schemaVersion: 1, id: 'test-template', name: 'Test', cells: [cell('a')], ...extra })

/** Validates `raw` and gives its errors. */
const errorsOf = (raw) => validateTemplate(raw).errors
/** Asserts `raw` fails with one error containing `text`. */
const failsWith = (raw, text) => {
  const { template, errors } = validateTemplate(raw)
  expect(template).toBeNull()
  expect(errors).toHaveLength(1)
  expect(errors[0]).toContain(text)
}
const withCell = (patch) => base({ cells: [cell('a', patch)] })
const withFacet = (patch) => withCell({ facets: [facet('apical', 'top', patch)] })
const withCompartment = (patch, cells = [cell('a')]) => base({ cells, compartments: [{ id: 'fluid', label: 'Fluid', ...patch }] })

describe('validateTemplate', () => {
  it('accepts a minimal template and fills in defaults', () => {
    const { template, errors, warnings } = validateTemplate(base({ compartments: [{ id: 'fluid', label: 'Fluid' }] }))
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
    expect(template.cells[0]).toMatchObject({
      row: 0,
      size: { width: 320, height: 240 },
      membrane: { label: 'Plasma membrane' },
      processes: [],
    })
    expect(template.compartments[0]).toEqual({ id: 'fluid', label: 'Fluid', against: [], tone: 'sky' })
    expect(validateTemplate({ ...base(), compartments: undefined }).template.compartments).toEqual([])
  })

  it('returns a deep-frozen copy', () => {
    const raw = base()
    const { template } = validateTemplate(raw)
    expect(template).not.toBe(raw)
    expect(Object.isFrozen(template)).toBe(true)
    expect(Object.isFrozen(template.cells[0].facets[0])).toBe(true)
    expect(Object.isFrozen(template.cells[0].size)).toBe(true)
  })

  it('keeps optional fields and site: false, and drops site: true', () => {
    const { template } = validateTemplate(
      base({
        description: ' A test. ',
        author: 'Me',
        license: 'CC0-1.0',
        cells: [
          cell('a', {
            row: 2,
            size: { width: 400, height: 300 },
            membrane: false,
            site: false,
            facets: [facet('apical', 'top', { group: 'g', annotation: { facet: 'apical' }, site: true })],
            processes: [{ id: 'p', label: 'P', site: false }],
          }),
        ],
        compartments: [{ id: 'fluid', label: 'Fluid', tone: 'amber', depth: 60, site: false }],
      }),
    )
    expect(template.description).toBe('A test.')
    expect(template.author).toBe('Me')
    expect(template.license).toBe('CC0-1.0')
    expect(template.cells[0]).toMatchObject({ row: 2, size: { width: 400, height: 300 }, membrane: false, site: false })
    expect(template.cells[0].facets[0]).toEqual({ id: 'apical', label: 'apical membrane', edge: 'top', group: 'g', annotation: { facet: 'apical' } })
    expect(template.cells[0].processes[0].site).toBe(false)
    expect(template.compartments[0]).toMatchObject({ tone: 'amber', depth: 60, site: false })
  })

  it('warns about unknown keys at every level and drops them', () => {
    const { template, errors, warnings } = validateTemplate(
      base({
        $schema: './bio-template.schema.json',
        extra: 1,
        cells: [
          cell('a', {
            colour: 'red',
            size: { width: 320, height: 240, depth: 3 },
            membrane: { label: 'M', thickness: 2 },
            facets: [facet('apical', 'top', { shade: 1, annotation: { facet: 'apical', note: 'x' } })],
            processes: [{ id: 'p', label: 'P', speed: 1 }],
          }),
        ],
        compartments: [{ id: 'fluid', label: 'Fluid', volume: 2 }],
      }),
    )
    expect(errors).toEqual([])
    expect(warnings).toEqual([
      'Template: unknown key "extra" was ignored.',
      'Cell "a": unknown key "colour" was ignored.',
      'Cell "a", size: unknown key "depth" was ignored.',
      'Cell "a", membrane: unknown key "thickness" was ignored.',
      'Cell "a", facet 1: unknown key "shade" was ignored.',
      'Cell "a", facet 1, annotation: unknown key "note" was ignored.',
      'Cell "a", process 1: unknown key "speed" was ignored.',
      'Compartment "fluid": unknown key "volume" was ignored.',
    ])
    expect(template).not.toHaveProperty('extra')
    expect(template).not.toHaveProperty('$schema')
    expect(template.cells[0]).not.toHaveProperty('colour')
    expect(template.cells[0].size).toEqual({ width: 320, height: 240 })
    expect(template.cells[0].membrane).toEqual({ label: 'M' })
    expect(template.cells[0].facets[0]).not.toHaveProperty('shade')
    expect(template.cells[0].facets[0].annotation).toEqual({ facet: 'apical' })
    expect(template.cells[0].processes[0]).toEqual({ id: 'p', label: 'P' })
    expect(template.compartments[0]).not.toHaveProperty('volume')
  })

  describe('rejects', () => {
    it.each([null, 'text', [], 3])('a template that is not an object (%s)', (raw) => {
      failsWith(raw, 'must be a JSON object')
    })
    it('a template over the size limit', () => failsWith(base({ description: 'x'.repeat(LIMITS.bytes) }), 'at most 64 KB'))
    it('a template over the size limit in bytes, not characters', () => {
      failsWith(base({ notes: '\u20ac'.repeat(LIMITS.bytes / 2) }), 'at most 64 KB')
    })
    it('a template that cannot be serialised', () => {
      const raw = base()
      raw.self = raw
      failsWith(raw, 'at most 64 KB')
    })
    it('a wrong schemaVersion', () => failsWith(base({ schemaVersion: 2 }), '"schemaVersion" must be 1'))
    it.each(['A-b', 'a', '1ab', 'a_b', 3])('a bad template id (%s)', (id) => failsWith(base({ id }), '"id" must start with a letter'))
    it('a missing name', () => failsWith(base({ name: '  ' }), '"name" is required'))
    it('a name that is not text', () => failsWith(base({ name: 3 }), 'Template: "name" must be text'))
    it('a long name', () => failsWith(base({ name: 'x'.repeat(65) }), '"name" must be at most 64'))
    it('a description that is not text', () => failsWith(base({ description: 3 }), 'Template: "description" must be text'))
    it('a long description', () => failsWith(base({ description: 'x'.repeat(281) }), '"description" must be at most 280'))
    it('a long author', () => failsWith(base({ author: 'x'.repeat(65) }), '"author" must be at most 64'))
    it('a long license', () => failsWith(base({ license: 'x'.repeat(65) }), '"license" must be at most 64'))
    it('missing cells', () => failsWith(base({ cells: [] }), '"cells" must be a non-empty list'))
    it('too many cells', () => {
      const cells = Array.from({ length: 17 }, (_, i) => cell(`c${i}`, { facets: [facet('top', 'top')] }))
      failsWith(base({ cells }), 'at most 16 cells')
    })
    it('a cell that is not an object', () => failsWith(base({ cells: [3] }), 'Cell 1 must be an object'))
    it('a bad cell id', () => failsWith(withCell({ id: 'A' }), 'Cell 1: "id" must start with a letter'))
    it('a cell without a label', () => failsWith(withCell({ label: '' }), 'Cell "a": "label" is required'))
    it('a cell label that is not text', () => failsWith(withCell({ label: 3 }), 'Cell "a": "label" must be text'))
    it('a long cell label', () => failsWith(withCell({ label: 'x'.repeat(65) }), 'Cell "a": "label" must be at most 64'))
    it.each([-1, 1.5, '1', 16])('a bad row (%s)', (row) => failsWith(withCell({ row }), 'Cell "a": "row" must be a whole number'))
    it('a size that is not an object', () => failsWith(withCell({ size: 300 }), 'Cell "a": "size" must be an object'))
    it.each([119, 4001, Infinity, '300', undefined])('a bad width (%s)', (width) => {
      failsWith(withCell({ size: { width, height: 240 } }), 'Cell "a": "size.width" must be a number from 120 to 4000')
    })
    it('a bad height', () => failsWith(withCell({ size: { width: 320, height: 50 } }), '"size.height" must be a number'))
    it('a membrane that is neither an object nor false', () => failsWith(withCell({ membrane: true }), '"membrane" must be an object'))
    it('a membrane without a label', () => failsWith(withCell({ membrane: {} }), 'Cell "a", membrane: "label" is required'))
    it('a cell without facets', () => failsWith(withCell({ facets: [] }), 'Cell "a": "facets" must be a non-empty list'))
    it('a facet that is not an object', () => failsWith(withCell({ facets: ['top'] }), 'Cell "a", facet 1 must be an object'))
    it('a bad facet id', () => failsWith(withFacet({ id: 'Top' }), 'Cell "a", facet 1: "id" must start with a letter'))
    it('a facet without a label', () => failsWith(withFacet({ label: undefined }), 'Cell "a", facet 1: "label" is required'))
    it('a bad edge', () => failsWith(withFacet({ edge: 'middle' }), 'Cell "a", facet 1: "edge" must be one of top, bottom, left, right'))
    it('a bad group', () => failsWith(withFacet({ group: 'Lateral' }), 'Cell "a", facet 1: "group" must start'))
    it('an annotation that is not an object', () => failsWith(withFacet({ annotation: 'apical' }), '"annotation" must be an object'))
    it('an unknown annotation facet', () => failsWith(withFacet({ annotation: { facet: 'luminal' } }), '"annotation.facet" must be one of apical, lateral, basolateral'))
    it('an annotation side on a facet that is not lateral', () => {
      failsWith(withFacet({ annotation: { facet: 'apical', at: 'left' } }), '"annotation.at" is only allowed when')
    })
    it('a bad annotation side', () => failsWith(withFacet({ annotation: { facet: 'lateral', at: 'top' } }), '"annotation.at" must be left or right'))
    it('two facets with the same annotation', () => {
      const facets = [facet('one', 'top', { annotation: { facet: 'apical' } }), facet('two', 'bottom', { annotation: { facet: 'apical' } })]
      failsWith(withCell({ facets }), 'Cell "a", facet 2: annotation apical is already given to facet "one"')
    })
    it('two facets on one edge', () => {
      failsWith(withCell({ facets: [facet('one', 'top'), facet('two', 'top')] }), 'Cell "a", facet 2: the top edge already has facet "one"')
    })
    it('a facet id used twice', () => {
      failsWith(withCell({ facets: [facet('one', 'top'), facet('one', 'bottom')] }), 'Cell "a", facet 2: id "one" is used more than once')
    })
    it('a process id that repeats a facet id', () => {
      failsWith(withCell({ processes: [{ id: 'apical', label: 'P' }] }), 'Cell "a", process 1: id "apical" is used more than once')
    })
    it('a facet called membrane', () => failsWith(withFacet({ id: 'membrane' }), 'Cell "a", facet 1: "membrane" is reserved'))
    it('a process called membrane', () => failsWith(withCell({ processes: [{ id: 'membrane', label: 'P' }] }), 'process 1: "membrane" is reserved'))
    it('processes that are not a list', () => failsWith(withCell({ processes: {} }), 'Cell "a": "processes" must be a list'))
    it('too many processes', () => {
      const processes = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, label: 'P' }))
      failsWith(withCell({ processes }), 'at most 8 processes')
    })
    it('a process that is not an object', () => failsWith(withCell({ processes: [null] }), 'Cell "a", process 1 must be an object'))
    it('a bad process id', () => failsWith(withCell({ processes: [{ id: '9', label: 'P' }] }), 'process 1: "id" must start with a letter'))
    it('a process without a label', () => failsWith(withCell({ processes: [{ id: 'p' }] }), 'process 1: "label" is required'))
    it('a site that is not a boolean', () => failsWith(withCell({ site: 'no' }), 'Cell "a": "site" must be true or false'))
    it('compartments that are not a list', () => failsWith(base({ compartments: {} }), '"compartments" must be a list'))
    it('too many compartments', () => {
      const compartments = Array.from({ length: 33 }, (_, i) => ({ id: `f${i}`, label: 'F', site: false }))
      failsWith(base({ compartments }), 'at most 32 compartments')
    })
    it('a compartment that is not an object', () => failsWith(base({ compartments: [1] }), 'Compartment 1 must be an object'))
    it('a bad compartment id', () => failsWith(withCompartment({ id: 'F' }), 'Compartment 1: "id" must start with a letter'))
    it('a compartment without a label', () => failsWith(withCompartment({ label: '' }), 'Compartment "fluid": "label" is required'))
    it('a bad tone', () => failsWith(withCompartment({ tone: 'red' }), 'Compartment "fluid": "tone" must be one of sky, rose'))
    it.each([19, 1001, NaN])('a bad depth (%s)', (depth) => {
      failsWith(withCompartment({ depth }), 'Compartment "fluid": "depth" must be a number from 20 to 1000')
    })
    it('an id shared by a cell and a compartment', () => failsWith(withCompartment({ id: 'a' }), 'Id "a" is used by more than one'))
    it('two cells with one id', () => failsWith(base({ cells: [cell('a'), cell('a')] }), 'Id "a" is used by more than one'))
    it('too many sites', () => {
      const compartments = Array.from({ length: 32 }, (_, i) => ({ id: `f${i}`, label: 'F' }))
      const processes = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, label: 'P' }))
      const cells = [cell('a', { processes }), cell('b', { processes }), cell('c', { processes })]
      failsWith(base({ cells, compartments }), 'at most 64 sites; this one offers 74')
    })
    it('against that is not a list', () => failsWith(withCompartment({ against: 'a.apical' }), '"against" must be a list'))
    it.each([['b.apical'], ['a.lumen'], ['a'], ['a.apical.x'], [3]])('against that does not resolve (%s)', (ref) => {
      failsWith(withCompartment({ against: [ref] }), `"against" entry 1 (${JSON.stringify(ref)}) does not name a cell's facet`)
    })
    it('against that repeats a facet', () => failsWith(withCompartment({ against: ['a.apical', 'a.apical'] }), 'names "a.apical" more than once'))
    it('a band across rows', () => {
      failsWith(withCompartment({ against: ['a.apical', 'b.apical'] }, [cell('a'), cell('b', { row: 1 })]), 'must share a row')
    })
    it('a band mixing top and bottom facets', () => {
      failsWith(withCompartment({ against: ['a.apical', 'b.basolateral'] }, [cell('a'), cell('b')]), 'A compartment lies against facets')
    })
    it('a side-by-side gap between cells that are not neighbours', () => {
      const cells = [cell('a'), cell('b'), cell('c')]
      failsWith(withCompartment({ against: ['a.right', 'c.left'] }, cells), '"a" and "c" must be neighbours in one row')
    })
    it('a side-by-side gap the wrong way round', () => {
      failsWith(withCompartment({ against: ['b.right', 'a.left'] }, [cell('a'), cell('b')]), '"b" and "a" must be neighbours')
    })
    it('a side-by-side gap across rows', () => {
      failsWith(withCompartment({ against: ['a.right', 'b.left'] }, [cell('a'), cell('b', { row: 1 })]), 'must be neighbours in one row')
    })
    it('a gap within one cell', () => failsWith(withCompartment({ against: ['a.right', 'a.left'] }), 'must be neighbours'))
    it('a vertical gap between rows that are not adjacent', () => {
      failsWith(withCompartment({ against: ['a.basolateral', 'b.apical'] }, [cell('a'), cell('b', { row: 2 })]), '"b" must be in the row just below "a"')
    })
    it('a band or column on a facet that a gap fills', () => {
      const raw = base({
        cells: [cell('a'), cell('b')],
        compartments: [
          { id: 'cleft', label: 'Cleft', against: ['a.right', 'b.left'] },
          { id: 'side', label: 'Side', against: ['b.left'] },
        ],
      })
      failsWith(raw, 'facet "b.left" is already filled by the gap "cleft"')
    })
    it('two left facets', () => failsWith(withCompartment({ against: ['a.left', 'b.left'] }, [cell('a'), cell('b')]), 'one left or right facet'))
    it('three facets that are not one edge', () => {
      failsWith(withCompartment({ against: ['a.apical', 'a.left', 'a.right'] }), 'A compartment lies against facets')
    })
  })

  it('reports several problems at once, naming each element', () => {
    const errors = errorsOf(base({ name: '', cells: [cell('a', { facets: [facet('x', 'up'), facet('Y', 'top')] })] }))
    expect(errors).toEqual([
      'Template: "name" is required.',
      'Cell "a", facet 1: "edge" must be one of top, bottom, left, right.',
      'Cell "a", facet 2: "id" must start with a letter and use only lower-case letters, digits and hyphens (1-32 characters).',
    ])
  })
})

describe('compartment forms', () => {
  const cells = [cell('a'), cell('b'), cell('c', { row: 1 })]
  const formOf = (against) => {
    const { template, errors } = validateTemplate(withCompartment({ against }, cells))
    expect(errors).toEqual([])
    return compartmentForm(template, 'fluid')
  }

  it('is free with no facets', () => expect(formOf(undefined)).toBe('free'))
  it('is a band against one top or bottom facet', () => expect(formOf(['a.basolateral'])).toBe('band'))
  it('is a band against the same edge of cells in a row', () => expect(formOf(['a.apical', 'b.apical'])).toBe('band'))
  it('is a column against one side facet', () => expect(formOf(['b.left'])).toBe('column'))
  it('is a gap between neighbours in a row, either way round', () => {
    expect(formOf(['a.right', 'b.left'])).toBe('gap')
    expect(formOf(['b.left', 'a.right'])).toBe('gap')
  })
  it('is a gap between a cell and one in the row below, either way round', () => {
    expect(formOf(['a.basolateral', 'c.apical'])).toBe('gap')
    expect(formOf(['c.apical', 'b.basolateral'])).toBe('gap')
  })
  it('finds neighbours within a row whatever the declaration order across rows', () => {
    const { errors } = validateTemplate(withCompartment({ against: ['a.right', 'b.left'] }, [cell('a'), cell('c', { row: 1 }), cell('b')]))
    expect(errors).toEqual([])
  })
  it('accepts a compartment object and is null for an unknown id', () => {
    const template = getBuiltInTemplate('epithelial-cell')
    expect(compartmentForm(template, template.compartments[2])).toBe('column')
    expect(compartmentForm(template, 'nowhere')).toBeNull()
  })
})

describe('sitesOf', () => {
  it('gives the epithelial cell ten sites following the structure', () => {
    const sites = sitesOf(getBuiltInTemplate('epithelial-cell'))
    expect(sites).toHaveLength(10)
    expect(sites.map(({ path, role, kind }) => `${path} ${role} ${kind}`)).toEqual([
      'cell cytosol single',
      'cell.membrane membrane single',
      'cell.apical membraneProtein slots',
      'cell.basolateral membraneProtein slots',
      'cell.lateral-left membraneProtein slots',
      'cell.lateral-right membraneProtein slots',
      'cell.metabolism cytosolic slots',
      'apical-fluid region single',
      'basolateral-fluid region single',
      'paracellular region single',
    ])
    expect(sites[2]).toEqual({ path: 'cell.apical', role: 'membraneProtein', kind: 'slots', cell: 'cell', facet: 'apical', label: 'Apical membrane' })
    expect(sites[6]).toMatchObject({ cell: 'cell', process: 'metabolism', label: 'Metabolism' })
    expect(sites[1]).toMatchObject({ cell: 'cell', label: 'Plasma membrane' })
    expect(sites[7]).toMatchObject({ compartment: 'apical-fluid', label: 'Apical fluid (lumen)' })
  })

  it('leaves out pieces with site: false and a cell with no membrane', () => {
    const { template } = validateTemplate(
      base({
        cells: [cell('a', { site: false, membrane: false, facets: [facet('top', 'top', { site: false }), facet('bottom', 'bottom')], processes: [{ id: 'p', label: 'P', site: false }] })],
        compartments: [{ id: 'fluid', label: 'Fluid', site: false }],
      }),
    )
    expect(sitesOf(template).map((site) => site.path)).toEqual(['a.bottom'])
  })

  it('counts the sites of every built-in', () => {
    expect(Object.fromEntries(BUILT_IN_TEMPLATES.map((template) => [template.id, sitesOf(template).length]))).toEqual({
      'epithelial-cell': 10,
      'chemical-synapse': 11,
      enterocyte: 9,
      'two-cell-epithelium': 15,
      'vessel-wall': 8,
    })
  })
})

describe('site references', () => {
  it('round-trips', () => {
    const ref = siteRef('bt-x1', 'cell.apical')
    expect(ref).toBe('bt-x1/cell.apical')
    expect(parseSiteRef(ref)).toEqual({ instance: 'bt-x1', path: 'cell.apical' })
    expect(parseSiteRef(siteRef('bt-x1', 'apical-fluid'))).toEqual({ instance: 'bt-x1', path: 'apical-fluid' })
  })

  it.each([undefined, null, 3, '', 'bt-x1', '/cell', 'bt-x1/', 'bt-x1/Cell', 'bt-x1/a.b.c', 'bt x/cell', 'bt-x1/cell/apical', 'bt-x1/.apical'])(
    'rejects %s',
    (ref) => expect(parseSiteRef(ref)).toBeNull(),
  )

  it('will not build a malformed reference', () => {
    expect(siteRef('', 'cell')).toBeNull()
    expect(siteRef('bt/1', 'cell')).toBeNull()
    expect(siteRef('bt-x1', 'cell..apical')).toBeNull()
    expect(siteRef('bt-x1', null)).toBeNull()
  })
})

describe('built-in templates', () => {
  it('ships five, epithelial cell first and then by name', () => {
    expect(BUILT_IN_TEMPLATES.map((template) => template.id)).toEqual([
      'epithelial-cell',
      'chemical-synapse',
      'enterocyte',
      'two-cell-epithelium',
      'vessel-wall',
    ])
    expect(Object.isFrozen(BUILT_IN_TEMPLATES)).toBe(true)
    expect(getBuiltInTemplate('nowhere')).toBeNull()
  })

  it.each(Object.entries(files))('%s validates with no errors or warnings', (path, module) => {
    const { template, errors, warnings } = validateTemplate(module.default)
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
    expect(path).toContain(`/${template.id}.template.json`)
    expect(module.default.$schema).toBe('./bio-template.schema.json')
  })

  it('gives the enterocyte the same annotated facets as the epithelial cell', () => {
    const aliases = (id) => getBuiltInTemplate(id).cells[0].facets.map((entry) => [entry.id, entry.annotation])
    expect(aliases('enterocyte')).toEqual(aliases('epithelial-cell'))
  })

  it('places each compartment in the form it was drawn for', () => {
    const forms = (id) => Object.fromEntries(getBuiltInTemplate(id).compartments.map((entry) => [entry.id, compartmentForm(getBuiltInTemplate(id), entry)]))
    expect(forms('epithelial-cell')).toEqual({ 'apical-fluid': 'band', 'basolateral-fluid': 'band', paracellular: 'column' })
    expect(forms('two-cell-epithelium')).toEqual({ 'apical-fluid': 'band', 'basolateral-fluid': 'band', paracellular: 'gap' })
    expect(forms('vessel-wall')).toEqual({ lumen: 'band', interstitium: 'band', 'junction-cleft': 'column' })
    expect(forms('chemical-synapse')).toEqual({ cleft: 'gap', ecs: 'band' })
  })

  it('skips and logs a file that fails validation', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const loaded = loadBuiltInTemplates({ 'good.json': { default: base() }, 'bad.json': { default: { id: 'x' } } })
    expect(loaded.map((template) => template.id)).toEqual(['test-template'])
    expect(error).toHaveBeenCalledWith(expect.stringContaining('bad.json'), expect.any(Array))
    error.mockRestore()
  })
})

describe('schema parity', () => {
  const defs = schema.$defs
  const propertiesOf = {
    template: schema.properties,
    cell: defs.cell.properties,
    size: defs.cell.properties.size.properties,
    membrane: defs.cell.properties.membrane.oneOf[0].properties,
    facet: defs.facet.properties,
    annotation: defs.facet.properties.annotation.properties,
    process: defs.process.properties,
    compartment: defs.compartment.properties,
  }

  it('lists the same enums and id patterns as the validator', () => {
    expect(defs.facet.properties.edge.enum).toEqual(EDGES)
    expect(defs.compartment.properties.tone.enum).toEqual(TONES)
    expect(defs.facet.properties.annotation.properties.facet.enum).toEqual(ANNOTATION_FACETS)
    expect(ANNOTATION_FACETS).toEqual(FACETS)
    expect(defs.facet.properties.annotation.properties.at.enum).toEqual(ANNOTATION_SIDES)
    expect(schema.properties.id.pattern).toBe(TEMPLATE_ID.source)
    expect(defs.pieceId.pattern).toBe(PIECE_ID.source)
    expect(schema.properties.schemaVersion.const).toBe(1)
  })

  it('lists the same limits as the validator', () => {
    expect(schema.properties.cells.maxItems).toBe(LIMITS.cells)
    expect(schema.properties.compartments.maxItems).toBe(LIMITS.compartments)
    expect(defs.cell.properties.processes.maxItems).toBe(LIMITS.processes)
    expect(defs.cell.properties.row.maximum).toBe(LIMITS.rows - 1)
    expect(defs.cell.properties.size.properties.width).toMatchObject({ minimum: LIMITS.size.min, maximum: LIMITS.size.max })
    expect(defs.compartment.properties.depth).toMatchObject({ minimum: LIMITS.depth.min, maximum: LIMITS.depth.max })
    expect(defs.label.maxLength).toBe(LIMITS.label)
    expect(schema.properties.name.maxLength).toBe(LIMITS.name)
    expect(schema.properties.description.maxLength).toBe(LIMITS.description)
  })

  it.each(Object.keys(TEMPLATE_KEYS))('knows the same %s keys', (kind) => {
    expect(Object.keys(propertiesOf[kind]).sort()).toEqual([...TEMPLATE_KEYS[kind]].sort())
  })

  it('describes every property', () => {
    const undescribed = []
    for (const [kind, properties] of Object.entries(propertiesOf)) {
      for (const [key, value] of Object.entries(properties)) if (!value.description) undescribed.push(`${kind}.${key}`)
    }
    expect(undescribed).toEqual([])
  })
})
