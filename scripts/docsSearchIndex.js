/**
 * Vite plugin serving `virtual:docs-search-index`: the docs pages split into sections at their h1 to h4 headings,
 * as plain text for searching and for the snippets the results show. Built from the markdown with the renderer's own
 * markdown-it setup, so each section's anchor is the id the docs page gives its heading.
 */
import fs from 'fs'
import path from 'path'
import MarkdownIt from 'markdown-it'
import { markdownItOptions, markdownItSetup } from './markdownSetup.js'

const VIRTUAL_ID = 'virtual:docs-search-index'
const RESOLVED_ID = `\0${VIRTUAL_ID}`
const DOCS_DIR = path.resolve(import.meta.dirname, '../docs')

// The headings the docs page's contents list follows and gives ids to (DocsView's TOC_HEADINGS).
const MAX_SECTION_LEVEL = 4

const GLOSSARY_LINK = /<GlossaryLink\b[^>]*?\bterm="([^"]*)"[^>]*?\/>/g

let markdown = null

function getMarkdown() {
  if (!markdown) {
    markdown = new MarkdownIt(markdownItOptions)
    markdownItSetup(markdown)
  }
  return markdown
}

/**
 * The id DocsView makes for a heading without its own: its text, lower case, hyphenated.
 *
 * @param {string} text
 * @returns {string}
 */
export function headingSlug(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
}

/**
 * The text an inline token shows, as the rendered page's textContent would read: images and markup left out, and a
 * self-closing glossary link as its term.
 *
 * @param {Object} token - A markdown-it inline token.
 * @returns {string}
 */
function inlineText(token) {
  let text = ''
  for (const child of token.children || []) {
    if (child.type === 'text' || child.type === 'code_inline') text += child.content
    else if (child.type === 'softbreak' || child.type === 'hardbreak') text += ' '
    else if (child.type === 'html_inline') text += child.content.replace(GLOSSARY_LINK, '$1').replace(/<[^>]*>/g, '')
  }
  return text
}

/**
 * Collapses whitespace.
 *
 * @param {string} text
 * @returns {string}
 */
function tidy(text) {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Splits a docs page into searchable sections, one per h1 to h4 heading, with the text before the first heading
 * going to the page's own section.
 *
 * @param {string} source - The page's markdown.
 * @param {string} pagePath - The page's route, such as `/docs/guides/macro-build-guide`.
 * @returns {Array<{path: string, anchor: string|null, page: string, heading: string, level: number, text: string}>}
 *   Anchors are null for the page's own section, reached by opening the page.
 */
export function extractDocSections(source, pagePath) {
  const tokens = getMarkdown().parse(source, {})
  const sections = []
  const usedIds = new Set()
  let pageTitle = ''
  let current = { path: pagePath, anchor: null, page: '', heading: '', level: 1, parts: [] }

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]

    if (token.type === 'heading_open') {
      const level = Number(token.tag.slice(1))
      const heading = tidy(inlineText(tokens[i + 1]))
      i += 2 // the inline and heading_close tokens

      if (level > MAX_SECTION_LEVEL) {
        current.parts.push(heading)
        continue
      }

      // Unique the way DocsView does it, in document order across all h1 to h4 headings.
      const baseId = token.attrGet('id') || headingSlug(heading)
      let id = baseId
      for (let counter = 1; usedIds.has(id); counter++) id = `${baseId}-${counter}`
      usedIds.add(id)

      const isPageTitle = level === 1 && !pageTitle && sections.length === 0 && current.parts.length === 0
      if (isPageTitle) {
        pageTitle = heading
        current.heading = heading
        continue
      }

      sections.push(current)
      current = { path: pagePath, anchor: id, page: '', heading, level, parts: [] }
    } else if (token.type === 'inline') {
      current.parts.push(inlineText(token))
    } else if (token.type === 'fence' || token.type === 'code_block') {
      current.parts.push(token.content)
    } else if (token.type === 'html_block') {
      current.parts.push(token.content.replace(GLOSSARY_LINK, '$1').replace(/<[^>]*>/g, ' '))
    }
  }
  sections.push(current)

  return sections
    .map(({ parts, ...section }) => ({
      ...section,
      page: pageTitle,
      heading: section.heading || pageTitle,
      text: tidy(parts.join(' ')),
    }))
    .filter((section) => section.heading || section.text)
}

/**
 * Indexes every page under the docs folder.
 *
 * @param {string} [docsDir]
 * @returns {Array<Object>} The sections of all pages, in path order.
 */
export function buildDocsSearchIndex(docsDir = DOCS_DIR) {
  const files = fs.readdirSync(docsDir, { recursive: true }).filter((file) => file.endsWith('.md')).sort()

  return files.flatMap((file) => {
    const pagePath = `/docs/${file.split(path.sep).join('/').replace(/\.md$/, '')}`
    return extractDocSections(fs.readFileSync(path.join(docsDir, file), 'utf8'), pagePath)
  })
}

/**
 * Creates the plugin. The index is rebuilt whenever a docs page changes in the dev server.
 *
 * @returns {import('vite').Plugin}
 */
export function docsSearchIndex() {
  return {
    name: 'docs-search-index',
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID
    },
    load(id) {
      if (id !== RESOLVED_ID) return
      for (const file of fs.readdirSync(DOCS_DIR, { recursive: true })) {
        if (file.endsWith('.md')) this.addWatchFile(path.join(DOCS_DIR, file))
      }
      return `export default ${JSON.stringify(buildDocsSearchIndex())}`
    },
    hotUpdate({ file, modules }) {
      if (!file.startsWith(DOCS_DIR) || !file.endsWith('.md')) return
      const indexModule = this.environment.moduleGraph.getModuleById(RESOLVED_ID)
      if (!indexModule) return
      this.environment.moduleGraph.invalidateModule(indexModule)
      return [...modules, indexModule]
    },
  }
}
