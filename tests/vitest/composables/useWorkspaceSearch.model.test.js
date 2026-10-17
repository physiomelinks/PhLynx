import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import { useWorkspaceSearch } from '../../../src/composables/useWorkspaceSearch.js'

/** The model of root a beside heart, a super instance holding ra and lv. */
const MODEL = [
  { id: 'a', data: { name: 'a', variables: [{ name: 'R', type: 'constant' }] } },
  { id: 'heart/ra', data: { name: 'heart__ra', variables: [{ name: 'E', type: 'constant' }] } },
  { id: 'heart/lv', data: { name: 'heart__lv', variables: [{ name: 'E', type: 'constant' }] } },
]
const ROOT = { a: 'a', 'heart/ra': 'heart', 'heart/lv': 'heart' }

/** Builds the search over the model, as the workspace does. */
function setup(options = {}) {
  const nodes = ref(MODEL)
  const zoomToNode = vi.fn()
  const findNode = (id) => nodes.value.find((node) => node.id === id)
  const search = useWorkspaceSearch({ nodes, findNode, zoomToNode, canvasIdOf: (id) => ROOT[id], ...options })
  /** Types a query, as the input does. */
  const type = (text) => {
    search.searchQuery.value = text
    search.runSearch()
  }
  return { search, zoomToNode, type }
}

describe('useWorkspaceSearch over the model', () => {
  it('finds modules inside super instances, by their model ids', () => {
    const { search, type } = setup()
    type('var:E')
    expect(search.matchingNodesList.value.map(({ node }) => node.data.name)).toEqual(['heart__ra', 'heart__lv'])
  })

  it('highlights the canvas node holding a match, and dims the rest', () => {
    const { search, type } = setup()
    type('lv')
    expect(search.highlightCss.value).toContain('.vue-flow__node[data-id="heart"] > .instance-node')
    expect(search.highlightCss.value).not.toContain('data-id="a"')
    expect(search.highlightCss.value).toContain('opacity: 0.25')
  })

  it('zooms to the canvas node holding a match, unless told how to reveal it', () => {
    const { search, zoomToNode, type } = setup()
    type('heart')
    search.cycleToNextMatch()
    expect(zoomToNode).toHaveBeenLastCalledWith('heart')

    const reveal = vi.fn()
    const revealing = setup({ reveal })
    revealing.type('lv')
    revealing.search.cycleToNextMatch()
    expect(reveal).toHaveBeenCalledWith('heart/lv')
    expect(revealing.zoomToNode).not.toHaveBeenCalled()
  })
})
