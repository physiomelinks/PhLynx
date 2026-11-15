// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from 'vitest'

import {
  createGitHubSource,
  createMapSource,
  describeImportIssues,
  inlineUnitsImports,
  normalisePath,
  resolveHref,
} from '../../../../src/services/import/cellmlImports.js'
import { resolveCellmlImports } from '../../../../src/services/import/prepareCellml.js'
import { processCellMLData } from '../../../../src/utils/cellml.js'
import { notify } from '../../../../src/utils/notify.js'
import { ensureLibCellmlReady } from '../../helpers/libcellml-bootstrap.js'

vi.mock('../../../../src/utils/notify.js', () => ({ notify: { warning: vi.fn(), info: vi.fn() } }))

const NS = 'http://www.cellml.org/cellml/2.0#'
const XLINK = 'http://www.w3.org/1999/xlink'

const model = (name, body) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<model xmlns="${NS}" xmlns:xlink="${XLINK}" name="${name}">${body}</model>`

const BASE_UNITS = model('base', '<units name="fmol"><unit prefix="femto" units="mole"/></units>')
const UNITS = model(
  'units',
  `<import xlink:href="base.cellml"><units name="fmol" units_ref="fmol"/></import>
   <units name="fmol_per_s"><unit units="fmol"/><unit units="second" exponent="-1"/></units>
   <units name="fA"><unit prefix="femto" units="ampere"/></units>`
)
const NCX = model(
  'NCX',
  `<import xlink:href="../units/units.cellml"><units name="flow" units_ref="fmol_per_s"/><units name="fA" units_ref="fA"/></import>
   <component name="NCX"><variable name="v" units="flow" interface="public"/><variable name="i" units="fA" interface="public"/></component>`
)
const REPO = [
  ['CellML/units/base.cellml', BASE_UNITS],
  ['CellML/units/units.cellml', UNITS],
  ['CellML/math/NCX.cellml', NCX],
]

const unitsNames = (xml) => {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  return [...doc.documentElement.children].filter((e) => e.localName === 'units').map((e) => e.getAttribute('name'))
}
const importCount = (xml) => (xml.match(/<import\b/g) ?? []).length

beforeAll(() => ensureLibCellmlReady(), 120000)

describe('paths', () => {
  it('normalises and refuses to climb above the root', () => {
    expect(normalisePath('a/./b/../c.cellml')).toBe('a/c.cellml')
    expect(normalisePath('../x.cellml')).toBeNull()
  })

  it('resolves hrefs against the importing file', () => {
    expect(resolveHref('CellML/math/NCX.cellml', '../units/u.cellml')).toEqual({ kind: 'path', path: 'CellML/units/u.cellml' })
    expect(resolveHref('NCX.cellml', '../units/u.cellml')).toEqual({ kind: 'outside' })
    expect(resolveHref('a.cellml', 'https://example.org/u.cellml')).toEqual({ kind: 'url', url: 'https://example.org/u.cellml' })
  })
})

describe('inlineUnitsImports', () => {
  it('replaces imported units with concrete definitions, following nested imports and renames', async () => {
    const result = await inlineUnitsImports(NCX, 'CellML/math/NCX.cellml', createMapSource(REPO))

    expect(result.issues).toEqual([])
    expect(importCount(result.cellml)).toBe(0)
    // `flow` is the renamed `fmol_per_s`; `fmol` comes along because `flow` is built from it.
    expect(unitsNames(result.cellml).sort()).toEqual(['fA', 'flow', 'fmol'])
    expect(result.cellml).toContain('<component name="NCX">')
  })

  it('gives the library real units instead of placeholders', async () => {
    const { cellml } = await inlineUnitsImports(NCX, 'CellML/math/NCX.cellml', createMapSource(REPO))
    const processed = processCellMLData(cellml)

    expect(processed.type).toBe('success')
    expect(processed.units.count).toBe(3)
    expect(processed.units.model).not.toContain('import')
  })

  it('removes and reports units it cannot resolve, keeping the rest of the file', async () => {
    const result = await inlineUnitsImports(NCX, 'CellML/math/NCX.cellml', createMapSource([REPO[2]]))

    expect(importCount(result.cellml)).toBe(0)
    expect(unitsNames(result.cellml)).toEqual([])
    expect(result.issues).toEqual([
      { href: '../units/units.cellml', units: ['flow', 'fA'], components: [], reason: 'file not found' },
    ])
    expect(describeImportIssues(result.issues)).toEqual(['units flow, fA from ../units/units.cellml: file not found'])
  })

  it('finds a file by its unique name when it is not at the import’s path', async () => {
    const loose = createMapSource([
      ['NCX.cellml', NCX],
      ['units.cellml', UNITS],
      ['base.cellml', BASE_UNITS],
    ])
    const result = await inlineUnitsImports(NCX, 'NCX.cellml', loose)

    expect(result.issues).toEqual([])
    expect(unitsNames(result.cellml).sort()).toEqual(['fA', 'flow', 'fmol'])
  })

  it('keeps component imports, with their original href, and reports them', async () => {
    const withComponent = model(
      'cell',
      `<import xlink:href="../units/units.cellml"><units name="fA" units_ref="fA"/></import>
       <import xlink:href="NCX.cellml"><component name="exchanger" component_ref="NCX"/></import>`
    )
    const result = await inlineUnitsImports(withComponent, 'CellML/math/cell.cellml', createMapSource(REPO))

    expect(unitsNames(result.cellml)).toEqual(['fA'])
    expect(result.cellml).toContain('xlink:href="NCX.cellml"')
    expect(result.issues).toEqual([
      { href: 'NCX.cellml', units: [], components: ['exchanger'], reason: 'component imports are not supported yet' },
    ])
  })

  it('prefers a local definition over an imported one of the same name', async () => {
    const shadowing = model(
      'shadow',
      `<import xlink:href="../units/units.cellml"><units name="flow" units_ref="fmol_per_s"/></import>
       <units name="fmol"><unit prefix="femto" units="mole"/></units>`
    )
    const result = await inlineUnitsImports(shadowing, 'CellML/math/shadow.cellml', createMapSource(REPO))

    expect(result.inlined).toEqual(['flow'])
    expect(unitsNames(result.cellml).sort()).toEqual(['flow', 'fmol'])
  })

  it('leaves a file without imports untouched', async () => {
    const result = await inlineUnitsImports(BASE_UNITS, 'base.cellml', null)
    expect(result.cellml).toBe(BASE_UNITS)
  })
})

describe('processCellMLData', () => {
  it('leaves imported units out of the library units model', () => {
    const processed = processCellMLData(NCX)
    expect(processed.type).toBe('success')
    expect(processed.units.count).toBe(0)
  })
})

describe('createGitHubSource', () => {
  it('resolves imports by fetching files at a pinned commit', async () => {
    const files = new Map(REPO.map(([path, text]) => [`https://raw.githubusercontent.com/org/repo/abc123/${path}`, text]))
    const fetchImpl = vi.fn(async (url) =>
      files.has(url) ? { ok: true, status: 200, text: async () => files.get(url) } : { ok: false, status: 404 }
    )
    const source = createGitHubSource({ owner: 'org', repo: 'repo', ref: 'abc123', root: 'CellML' }, { fetchImpl })

    const result = await inlineUnitsImports(NCX, 'math/NCX.cellml', source)

    expect(result.issues).toEqual([])
    expect(unitsNames(result.cellml).sort()).toEqual(['fA', 'flow', 'fmol'])
    expect(fetchImpl).toHaveBeenCalledWith('https://raw.githubusercontent.com/org/repo/abc123/CellML/units/units.cellml')
    expect(fetchImpl).toHaveBeenCalledWith('https://raw.githubusercontent.com/org/repo/abc123/CellML/units/base.cellml')
  })
})

describe('resolveCellmlImports', () => {
  it('resolves loose files dropped together by name, and warns once about the rest', async () => {
    const [ncx, , , orphan] = await resolveCellmlImports([
      { name: 'NCX.cellml', content: NCX },
      { name: 'units.cellml', content: UNITS },
      { name: 'base.cellml', content: BASE_UNITS },
      { name: 'orphan.cellml', content: NCX.replace('../units/units.cellml', 'missing.cellml') },
    ])

    expect(unitsNames(ncx).sort()).toEqual(['fA', 'flow', 'fmol'])
    expect(unitsNames(orphan)).toEqual([])
    expect(notify.warning).toHaveBeenCalledTimes(1)
    expect(notify.warning.mock.calls[0][0].message).toContain('orphan.cellml: units flow, fA from missing.cellml: file not found')
  })
})
