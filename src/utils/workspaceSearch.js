/**
 * Parses and runs workspace search queries: plain text finds instances by name, `var:` by the variables they hold.
 */

const VAR_PREFIX = /^\s*var:\s*/i

// The modes the search box offers, in the order its picker lists them.
export const SEARCH_MODES = [
  { prefix: '', label: 'Name (default)', hint: 'Just start typing' },
  { prefix: 'var:', label: 'var:', hint: 'Instances containing a variable' },
]

const KIND_LABELS = { constant: 'parameter', global_constant: 'global', boundary_condition: 'boundary' }

/**
 * Parses a query. `var:` (any case) at the start switches to variable mode, where `inst/var` also filters by
 * instance name; any other text is a name search, so names containing ':' still match.
 *
 * @param {string} text
 * @returns {{mode: 'name'|'var', term: string, instanceTerm: string, words: string[]}} An empty term means no search.
 */
export function parseSearchQuery(text) {
  const raw = text ?? ''
  if (!VAR_PREFIX.test(raw)) {
    const term = raw.trim().toLowerCase()
    return { mode: 'name', term, instanceTerm: '', words: [] }
  }
  const term = raw.replace(VAR_PREFIX, '').trim().toLowerCase()
  const slash = term.lastIndexOf('/')
  const instanceTerm = slash < 0 ? '' : term.slice(0, slash).trim()
  const words = term
    .slice(slash + 1)
    .split(/\s+/)
    .filter(Boolean)
  return { mode: 'var', term, instanceTerm, words }
}

/**
 * Ranks a variable name against the query words: an exact name, then one starting with a word, then the rest.
 *
 * @param {string} name - Lowercased.
 * @param {string[]} words
 * @returns {number}
 */
const rankName = (name, words) => (words.some((word) => name === word) ? 0 : words.some((word) => name.startsWith(word)) ? 1 : 2)

/**
 * Finds the instances a parsed query matches, in workspace order. A variable search lists the matching
 * variables of each instance, best first; every instance using a global constant is found, not just one.
 *
 * @param {Array<Object>} nodes
 * @param {ReturnType<typeof parseSearchQuery>} parsed
 * @returns {Array<{nodeId: string, variables: Array<Object>}>} Empty for an empty term.
 */
export function findWorkspaceMatches(nodes, parsed) {
  if (!parsed.term) return []
  const matches = []
  for (const node of nodes ?? []) {
    if (parsed.mode === 'name') {
      const fields = [node.data?.moduleRef, node.data?.name, node.data?.mathRef]
      if (fields.some((field) => field?.toLowerCase().includes(parsed.term))) matches.push({ nodeId: node.id, variables: [] })
      continue
    }
    if (parsed.instanceTerm && !node.data?.name?.toLowerCase().includes(parsed.instanceTerm)) continue
    const variables = (node.data?.variables ?? [])
      .filter((row) => row?.name && parsed.words.every((word) => row.name.toLowerCase().includes(word)))
      .map((row) => ({ row, rank: rankName(row.name.toLowerCase(), parsed.words) }))
      .sort((a, b) => a.rank - b.rank || a.row.name.localeCompare(b.row.name))
      .map(({ row }) => row)
    if (variables.length) matches.push({ nodeId: node.id, variables })
  }
  return matches
}

/**
 * Gets the short kind a matched variable is listed with, as the simulation pickers name them.
 *
 * @param {Object} row - A variable row.
 * @returns {string} Empty for a plain variable.
 */
export function variableKindLabel(row) {
  if (row?.stateRole === 'state') return 'state'
  return KIND_LABELS[row?.type] ?? ''
}
