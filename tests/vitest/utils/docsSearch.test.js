import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

import { buildDocsSearchIndex, extractDocSections } from '../../../scripts/docsSearchIndex'
import { buildSnippet, queryTerms, searchDocs, sectionLocation } from '../../../src/utils/docsSearch'
import { menuGroups } from '../../../src/utils/docsMenu'

/** Joins snippet runs, with matches in brackets. */
const show = (segments) => segments.map((part) => (part.match ? `[${part.text}]` : part.text)).join('')

describe('extractDocSections', () => {
  it('splits a page at its h1 to h4 headings, the h1 naming the page', () => {
    const sections = extractDocSections(
      '# My Page\n\nIntro text.\n\n## First part\n\nBody **one**.\n\n#### Deep\n\nDeeper.\n\n##### Minor\n\nStill deep.',
      '/docs/guides/my-page'
    )

    expect(sections).toEqual([
      { path: '/docs/guides/my-page', anchor: null, page: 'My Page', heading: 'My Page', level: 1, text: 'Intro text.' },
      { path: '/docs/guides/my-page', anchor: 'first-part', page: 'My Page', heading: 'First part', level: 2, text: 'Body one.' },
      // h5 and h6 stay in their section, as the contents list leaves them out.
      { path: '/docs/guides/my-page', anchor: 'deep', page: 'My Page', heading: 'Deep', level: 4, text: 'Deeper. Minor Still deep.' },
    ])
  })

  it('gives headings the ids the docs page gives them', () => {
    const anchors = extractDocSections(
      '# Page\n\n## Set up\n\n## Set up\n\n## Ports & `units`?\n\n## Custom {#my-id}\n\n## Set up',
      '/docs/x'
    ).map((section) => section.anchor)

    expect(anchors).toEqual([null, 'set-up', 'set-up-1', 'ports-units', 'my-id', 'set-up-2'])
  })

  it('reads text as the page shows it: links as their text, glossary links as their term, code kept', () => {
    const [section] = extractDocSections(
      '# Page\n\nSee [the guide](./guide.md), your <GlossaryLink term="modules"/>, and ![a picture](x.png).\n\n```\nunits mV\n```',
      '/docs/x'
    )

    expect(section.text).toBe('See the guide, your modules, and . units mV')
  })
})

describe('the docs index', () => {
  const index = buildDocsSearchIndex()

  it('covers every page in the sidebar', () => {
    const indexed = new Set(index.map((section) => section.path))
    for (const item of menuGroups.flatMap((group) => group.items)) expect(indexed).toContain(item.path)
  })

  it('anchors glossary entries at their terms', () => {
    // The terms' explicit ids, which glossary links point at. Read from the page, not the generated glossary.json,
    // which only `yarn build:glossary` writes.
    const glossary = fs.readFileSync(path.resolve('docs/reference/glossary.md'), 'utf8')
    const termIds = [...glossary.matchAll(/^#+\s+.+?\s+\{#(.+?)\}\s*$/gm)].map((match) => match[1])
    const anchors = index.filter((section) => section.path === '/docs/reference/glossary' && section.anchor).map((s) => s.anchor)

    expect(termIds.length).toBeGreaterThan(0)
    expect(anchors).toEqual(termIds)
  })
})

describe('queryTerms', () => {
  it('splits into unique lower case words', () => {
    expect(queryTerms('  Ghost-Node ghost, OMEX ')).toEqual(['ghost', 'node', 'omex'])
    expect(queryTerms('')).toEqual([])
  })
})

describe('searchDocs', () => {
  const index = [
    { path: '/docs/a', anchor: null, page: 'Ghost Nodes', heading: 'Ghost Nodes', level: 1, text: 'A ghost node is a placeholder.' },
    { path: '/docs/b', anchor: 'build', page: 'Macros', heading: 'Build a macro', level: 2, text: 'Add a ghost node to chain copies.' },
    { path: '/docs/b', anchor: 'export', page: 'Macros', heading: 'Export', level: 2, text: 'Export the macro as CellML.' },
    { path: '/docs/reference/change-log', anchor: 'v1', page: 'Changelog', heading: 'v1', level: 2, text: 'Ghost nodes now ghost nodes.' },
  ]

  it('finds sections holding every word, at the start of words, best first', () => {
    const results = searchDocs(index, 'ghost no')
    expect(results.map((result) => result.section.path)).toEqual(['/docs/a', '/docs/b', '/docs/reference/change-log'])
    expect(searchDocs(index, 'host')).toEqual([])
    expect(searchDocs(index, 'ghost cellml')).toEqual([])
  })

  it('ranks a heading match above a mention', () => {
    expect(searchDocs(index, 'export')[0].section.anchor).toBe('export')
    expect(searchDocs(index, 'macro').map((result) => result.section.anchor)).toEqual(['build', 'export'])
  })

  it('highlights whole words in the heading and snippet', () => {
    const [result] = searchDocs(index, 'ghost', { limit: 1 })
    expect(show(result.headingSegments)).toBe('[Ghost] Nodes')
    expect(show(result.snippet)).toBe('A [ghost] node is a placeholder.')
  })

  it('links a page section to the page and others to their heading', () => {
    expect(sectionLocation(index[0])).toEqual({ path: '/docs/a', hash: '' })
    expect(sectionLocation(index[1])).toEqual({ path: '/docs/b', hash: '#build' })
  })
})

describe('buildSnippet', () => {
  const text = `${'lead '.repeat(40)}the sweep runs ${'tail '.repeat(60)}`.trim()

  it('cuts around the first match at word boundaries', () => {
    const snippet = show(buildSnippet(text, ['sweep'], { before: 20, length: 60 }))
    expect(snippet.startsWith('…lead')).toBe(true)
    expect(snippet).toContain('the [sweep] runs')
    expect(snippet.endsWith('tail…')).toBe(true)
    expect(snippet.length).toBeLessThan(70)
  })

  it('starts at the beginning without a match', () => {
    expect(show(buildSnippet('short text', ['zzz']))).toBe('short text')
    expect(buildSnippet('', ['x'])).toEqual([])
  })
})
