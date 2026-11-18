/**
 * Searches the docs index (`virtual:docs-search-index`): ranks the sections that hold every word of the query and
 * cuts a snippet of each around its matches.
 */

// Pages that mention much but are rarely what a search is after.
const PAGE_WEIGHTS = {
  '/docs/reference/change-log': 0.35,
}

/**
 * Escapes a string for a regular expression.
 *
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Splits a query into lower case words.
 *
 * @param {string} query
 * @returns {string[]} Unique words, in order.
 */
export function queryTerms(query) {
  const words = String(query ?? '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter(Boolean)
  return [...new Set(words)]
}

/**
 * A pattern matching each term at the start of a word, through to the end of that word.
 *
 * @param {string[]} terms
 * @returns {RegExp|null}
 */
function termsPattern(terms) {
  if (!terms.length) return null
  // Longest first, so the longer of two overlapping terms is the one highlighted.
  const alternatives = [...terms].sort((a, b) => b.length - a.length).map(escapeRegExp)
  return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternatives.join('|')})[\\p{L}\\p{N}_]*`, 'giu')
}

/**
 * Counts the words in a text that start with a term.
 *
 * @param {string} text
 * @param {string} term
 * @returns {number}
 */
function countWordStarts(text, term) {
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(term)}`, 'giu')
  return (text.match(pattern) || []).length
}

/**
 * Scores a section for the terms, or null unless its heading or text holds every one.
 *
 * @param {Object} section
 * @param {string[]} terms
 * @param {string} phrase - The query, lower case and trimmed.
 * @returns {number|null}
 */
function scoreSection(section, terms, phrase) {
  const heading = section.heading.toLowerCase()
  const text = section.text.toLowerCase()
  let score = 0
  let headingMatches = false

  for (const term of terms) {
    const inHeading = countWordStarts(heading, term)
    const inText = countWordStarts(text, term)
    if (!inHeading && !inText) return null

    if (inHeading) headingMatches = true
    if (inHeading) score += new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(term)}(?![\\p{L}\\p{N}_])`, 'iu').test(heading) ? 15 : 10
    // More mentions count, but less and less.
    score += Math.min(inText, 8) ** 0.5 * 2
  }

  if (terms.length > 1 && phrase) {
    if (heading.includes(phrase)) score += 20
    else if (text.includes(phrase)) score += 8
  }
  if (heading === phrase) score += 20
  if (section.page.toLowerCase().includes(phrase)) score += 3

  // A page's own section is the page as a whole, and a page named for the search is about it.
  if (section.anchor === null) score += headingMatches ? 12 : 2

  return score * (PAGE_WEIGHTS[section.path] ?? 1)
}

/**
 * Splits text into runs, flagging those that match a term.
 *
 * @param {string} text
 * @param {RegExp|null} pattern
 * @returns {Array<{text: string, match: boolean}>}
 */
function highlight(text, pattern) {
  if (!pattern) return text ? [{ text, match: false }] : []
  const segments = []
  let last = 0
  // matchAll starts where the pattern's last exec left off.
  pattern.lastIndex = 0
  for (const found of text.matchAll(pattern)) {
    if (found.index > last) segments.push({ text: text.slice(last, found.index), match: false })
    segments.push({ text: found[0], match: true })
    last = found.index + found[0].length
  }
  if (last < text.length) segments.push({ text: text.slice(last), match: false })
  return segments
}

/**
 * Cuts the part of a text around its first match, at word boundaries.
 *
 * @param {string} text
 * @param {string[]} terms
 * @param {Object} [options]
 * @param {number} [options.before=60] - About how many characters to keep before the match.
 * @param {number} [options.length=220] - About how long the snippet is.
 * @returns {Array<{text: string, match: boolean}>} The snippet as runs, with an ellipsis where it was cut.
 */
export function buildSnippet(text, terms, { before = 60, length = 220 } = {}) {
  const pattern = termsPattern(terms)
  if (!text) return []

  let matchAt = 0
  if (pattern) {
    pattern.lastIndex = 0
    const found = pattern.exec(text)
    if (found) matchAt = found.index
  }

  let start = Math.max(0, matchAt - before)
  if (start > 0) {
    const space = text.indexOf(' ', start)
    start = space !== -1 && space < matchAt ? space + 1 : start
  }
  let end = Math.min(text.length, start + length)
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end)
    end = space > matchAt ? space : end
  }

  const snippet = `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
  return highlight(snippet, pattern)
}

/**
 * Searches the index.
 *
 * @param {Array<Object>} index - The sections, from `virtual:docs-search-index`.
 * @param {string} query
 * @param {Object} [options]
 * @param {number} [options.limit=Infinity]
 * @param {Object} [options.snippet] - Passed to buildSnippet.
 * @returns {Array<{section: Object, score: number, headingSegments: Array, snippet: Array}>} Best first.
 */
export function searchDocs(index, query, { limit = Infinity, snippet } = {}) {
  const terms = queryTerms(query)
  if (!terms.length || !index?.length) return []

  const phrase = String(query).toLowerCase().trim().replace(/\s+/g, ' ')
  const scored = []
  for (const section of index) {
    const score = scoreSection(section, terms, phrase)
    if (score !== null) scored.push({ section, score })
  }
  scored.sort((a, b) => b.score - a.score)

  const pattern = termsPattern(terms)
  return scored.slice(0, limit).map(({ section, score }) => ({
    section,
    score,
    headingSegments: highlight(section.heading, pattern),
    snippet: buildSnippet(section.text, terms, snippet),
  }))
}

/**
 * The route of a result.
 *
 * @param {Object} section
 * @returns {{path: string, hash: string}}
 */
export function sectionLocation(section) {
  return { path: section.path, hash: section.anchor ? `#${section.anchor}` : '' }
}
