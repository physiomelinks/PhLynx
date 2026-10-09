import { describe, expect, it } from 'vitest'

import {
  DEFAULT_THEME,
  THEMES_CDN_URL,
  THEME_SCHEMA_VERSION,
  buildSubmissionUrl,
  categoryColour,
  categoryStyle,
  contrastRatio,
  contrastWarnings,
  deriveTheme,
  normaliseColour,
  parseThemeIndex,
  slugify,
  toSubmission,
  validateTheme,
} from '../../../src/utils/nodeThemes'

const domainTypes = {
  schemaVersion: 1,
  id: 'domain-types',
  name: 'Domain types',
  categories: [
    { key: 'compartment', label: 'Compartment', color: '#FFE7E1' },
    { key: 'membrane', label: 'Membrane', color: '#ffe2ec', dark: '#5a2a3a' },
  ],
}

describe('validateTheme', () => {
  it('accepts a well-formed theme and normalises colours', () => {
    const { theme, errors } = validateTheme(domainTypes)
    expect(errors).toEqual([])
    expect(theme.categories[0].color).toBe('#ffe7e1')
    expect(theme.categories[1].dark).toBe('#5a2a3a')
  })

  it('drops unknown fields', () => {
    const { theme } = validateTheme({ ...domainTypes, extra: 'x', categories: [{ ...domainTypes.categories[0], css: 'red' }] })
    expect(theme).not.toHaveProperty('extra')
    expect(theme.categories[0]).not.toHaveProperty('css')
  })

  it('rejects colours that are not hex, so nothing but a colour reaches a style binding', () => {
    for (const color of ['red', 'url(x)', '#12', 'rgb(1,2,3)', '#1234567', 'var(--x)']) {
      const { theme, errors } = validateTheme({ ...domainTypes, categories: [{ key: 'a', label: 'A', color }] })
      expect(theme, color).toBeNull()
      expect(errors.join(' ')).toMatch(/hex colour/)
    }
  })

  it('rejects duplicate keys, bad ids, a wrong schema version and empty categories', () => {
    expect(validateTheme({ ...domainTypes, categories: [domainTypes.categories[0], domainTypes.categories[0]] }).theme).toBeNull()
    expect(validateTheme({ ...domainTypes, id: 'Bad Id' }).theme).toBeNull()
    expect(validateTheme({ ...domainTypes, schemaVersion: 2 }).theme).toBeNull()
    expect(validateTheme({ ...domainTypes, categories: [] }).theme).toBeNull()
    expect(validateTheme(null).theme).toBeNull()
  })

  it('only accepts local ids when asked', () => {
    const local = { ...domainTypes, id: 'local:mine' }
    expect(validateTheme(local).theme).toBeNull()
    expect(validateTheme(local, { allowLocalId: true }).theme.id).toBe('local:mine')
  })
})

describe('parseThemeIndex', () => {
  it('keeps valid themes and reports the rest', () => {
    const { themes, skipped } = parseThemeIndex({
      schemaVersion: 1,
      themes: [domainTypes, { id: 'broken' }, domainTypes, { ...domainTypes, id: 'local:sneaky' }],
    })
    expect(themes.map((t) => t.id)).toEqual(['domain-types'])
    expect(skipped).toHaveLength(3)
  })

  it('copes with junk', () => {
    expect(parseThemeIndex(undefined).themes).toEqual([])
    expect(parseThemeIndex({ themes: 'nope' }).themes).toEqual([])
  })
})

describe('default theme', () => {
  it('is a valid single-colour theme', () => {
    expect(DEFAULT_THEME).not.toBeNull()
    expect(DEFAULT_THEME.categories).toHaveLength(1)
  })

  it('pins the CDN to the schema major version', () => {
    expect(THEMES_CDN_URL).toContain(`@${THEME_SCHEMA_VERSION}/`)
  })
})

describe('colouring', () => {
  const { theme } = validateTheme(domainTypes)

  it('gives CSS variables for a known category and nothing for unknown or empty keys', () => {
    expect(categoryStyle(theme, 'membrane')).toEqual({ '--node-fill': '#ffe2ec', '--node-fill-dark': '#5a2a3a' })
    expect(categoryStyle(theme, 'compartment')['--node-fill-dark']).toMatch(/^color-mix/)
    expect(categoryStyle(theme, 'protein')).toBeNull()
    expect(categoryStyle(theme, null)).toBeNull()
  })

  it('gives plain colours for the MiniMap', () => {
    expect(categoryColour(theme, 'membrane')).toBe('#ffe2ec')
    expect(categoryColour(theme, 'membrane', true)).toBe('#5a2a3a')
    expect(categoryColour(theme, 'compartment', true)).toMatch(/^#[0-9a-f]{6}$/)
    expect(categoryColour(theme, 'protein')).toBeNull()
  })

  it('computes WCAG contrast', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0)
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5)
    expect(normaliseColour('#ABC')).toBe('#aabbcc')
  })

  it('warns about fills that make text hard to read', () => {
    const warnings = contrastWarnings({ categories: [{ key: 'dim', label: 'Dim', color: '#334155', dark: '#f8fafc' }] })
    expect(warnings.map((w) => w.scheme).sort()).toEqual(['dark', 'light'])
    expect(contrastWarnings(theme)).toEqual([])
  })
})

describe('local themes and submission', () => {
  it('derives a local copy with a free id and remembers its origin', () => {
    const { theme } = validateTheme(domainTypes)
    const copy = deriveTheme(theme, { name: 'My Domains', takenIds: ['local:my-domains'] })
    expect(copy.id).toBe('local:my-domains-2')
    expect(copy.derivedFrom).toBe('domain-types')
    copy.categories[0].color = '#000000'
    expect(theme.categories[0].color).toBe('#ffe7e1')

    const copyOfCopy = deriveTheme(copy)
    expect(copyOfCopy.derivedFrom).toBe('domain-types')
    expect(validateTheme(copyOfCopy, { allowLocalId: true }).errors).toEqual([])
  })

  it('strips the local prefix and builds a pre-filled issue link', () => {
    const local = deriveTheme(validateTheme(domainTypes).theme, { name: 'Warm cells' })
    expect(toSubmission(local).id).toBe('warm-cells')
    expect(toSubmission({ ...local, name: 'Renamed later' }).id).toBe('renamed-later')

    const url = new URL(buildSubmissionUrl(local))
    expect(url.pathname).toBe('/physiomelinks/PhLynxThemes/issues/new')
    expect(url.searchParams.get('template')).toBe('theme-submission.yml')
    const submitted = JSON.parse(url.searchParams.get('theme-json'))
    expect(submitted.id).toBe('warm-cells')
    expect(validateTheme(submitted).errors).toEqual([])
  })

  it('slugifies names into ids', () => {
    expect(slugify('  Ça Va — 2 Cells! ')).toBe('ca-va-2-cells')
    expect(slugify('123 abc')).toBe('abc')
    expect(slugify('')).toBe('')
  })
})
