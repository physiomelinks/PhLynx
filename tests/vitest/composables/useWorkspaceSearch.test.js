import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import { useWorkspaceSearch } from '../../../src/composables/useWorkspaceSearch.js'

/** Builds an instance node. */
const makeNode = (id, data = {}) => ({ id, position: { x: 0, y: 0 }, data: { name: id, ...data } })

/** Builds the search over a fresh set of nodes. */
function setup(initial) {
  const nodes = ref(initial)
  const zoomToNode = vi.fn()
  const findNode = (id) => nodes.value.find((node) => node.id === id)
  const search = useWorkspaceSearch({ nodes, findNode, zoomToNode })
  /** Types a query, as the input does. */
  const type = (text) => {
    search.searchQuery.value = text
    search.runSearch()
  }
  return { nodes, zoomToNode, search, type }
}

describe('useWorkspaceSearch', () => {
  it('matches name, module and maths file case-insensitively, in workspace order', () => {
    const { search, type } = setup([
      makeNode('heart', { moduleRef: 'Pump' }),
      makeNode('Na_channel'),
      makeNode('vessel', { mathRef: 'na_maths.cellml' }),
      makeNode('other'),
    ])
    type('NA')
    expect(search.matchingNodesList.value.map(({ node }) => node.id)).toEqual(['Na_channel', 'vessel'])
    expect(search.matchCount.value).toBe(2)
    type('pump')
    expect([...search.matchingNodeIds.value]).toEqual(['heart'])
  })

  it('ignores spaces around the query', () => {
    const { search, type } = setup([makeNode('heart')])
    type('  heart ')
    expect(search.matchCount.value).toBe(1)
  })

  it('is inactive for a blank query: no count, nothing dimmed', () => {
    const { search, type } = setup([makeNode('heart')])
    type('   ')
    expect(search.isActive.value).toBe(false)
    expect(search.matchCount.value).toBeNull()
    expect(search.highlightCss.value).toBe('')
  })

  it('highlights matches and dims the rest', () => {
    const { search, type } = setup([makeNode('heart'), makeNode('lung')])
    type('heart')
    expect(search.highlightCss.value).toContain('.vue-flow__node > .instance-node { opacity: 0.25')
    expect(search.highlightCss.value).toContain('.vue-flow__node[data-id="heart"] > .instance-node')
    expect(search.highlightCss.value).not.toContain('data-id="lung"')
  })

  it('steps through matches from the first, wrapping round, and zooms to each', () => {
    const { search, zoomToNode, type } = setup([makeNode('a1'), makeNode('a2'), makeNode('a3')])
    type('a')
    expect(search.currentMatchIndex.value).toBe(-1)
    search.cycleToNextMatch()
    search.cycleToNextMatch()
    search.cycleToNextMatch()
    search.cycleToNextMatch()
    expect(zoomToNode.mock.calls.map(([id]) => id)).toEqual(['a1', 'a2', 'a3', 'a1'])
    search.cycleToPreviousMatch()
    expect(zoomToNode).toHaveBeenLastCalledWith('a3')
    expect(search.currentMatchIndex.value).toBe(2)
  })

  it('steps back from the last match when none is current yet', () => {
    const { search, zoomToNode, type } = setup([makeNode('a1'), makeNode('a2')])
    type('a')
    search.cycleToPreviousMatch()
    expect(zoomToNode).toHaveBeenLastCalledWith('a2')
  })

  it('zooms to a single match again rather than stepping past it', () => {
    const { search, zoomToNode, type } = setup([makeNode('heart'), makeNode('lung')])
    type('heart')
    search.cycleToNextMatch()
    search.cycleToNextMatch()
    search.cycleToPreviousMatch()
    expect(zoomToNode.mock.calls).toEqual([['heart'], ['heart'], ['heart']])
  })

  it('clears the query and its matches', () => {
    const { search, type } = setup([makeNode('heart')])
    type('heart')
    search.clearSearch()
    expect(search.searchQuery.value).toBe('')
    expect(search.matchingNodesList.value).toEqual([])
  })

  it('re-runs when a node is renamed, keeping the current match', async () => {
    const { nodes, search, type } = setup([makeNode('a1'), makeNode('a2'), makeNode('b')])
    type('a')
    search.selectMatch(1)
    nodes.value[2].data.name = 'a3'
    await nextTick()
    expect(search.matchingNodesList.value.map(({ node }) => node.id)).toEqual(['a1', 'a2', 'b'])
    expect(search.currentMatchIndex.value).toBe(1)
  })

  it('has no current match once the current one stops matching', async () => {
    const { nodes, search, type } = setup([makeNode('a1'), makeNode('a2')])
    type('a')
    search.selectMatch(1)
    nodes.value[1].data.name = 'z'
    await nextTick()
    expect(search.matchCount.value).toBe(1)
    expect(search.currentMatchIndex.value).toBe(-1)
  })

  it('does not re-run when a node only moves', async () => {
    const { nodes, search, type } = setup([makeNode('a1')])
    type('a')
    await nextTick()
    const before = search.matchingNodeIds.value
    nodes.value[0].position.x = 50
    await nextTick()
    expect(search.matchingNodeIds.value).toBe(before)
  })

  it('lists the variables each instance matched in a variable search', () => {
    const { search, type } = setup([makeNode('a', { variables: [{ name: 'R', type: 'global_constant' }] }), makeNode('b')])
    type('var:r')
    expect(search.matchingNodesList.value.map(({ node, variables }) => [node.id, variables.map((row) => row.name)])).toEqual([
      ['a', ['R']],
    ])
  })

  it('is inactive for a bare var: prefix', () => {
    const { search, type } = setup([makeNode('a', { variables: [{ name: 'x' }] })])
    type('var:')
    expect(search.matchCount.value).toBeNull()
    expect(search.highlightCss.value).toBe('')
  })

  it('re-runs a variable search when a variable is renamed', async () => {
    const { nodes, search, type } = setup([makeNode('a', { variables: [{ name: 'x' }] })])
    type('var:y')
    await nextTick()
    nodes.value[0].data.variables[0].name = 'y'
    await nextTick()
    expect(search.matchCount.value).toBe(1)
  })

  it('re-runs a variable search when a matched variable changes kind', async () => {
    const { nodes, search, type } = setup([makeNode('a', { variables: [{ name: 'R', type: 'constant' }] })])
    type('var:r')
    await nextTick()
    nodes.value[0].data.variables = [{ name: 'R', type: 'global_constant' }]
    await nextTick()
    expect(search.matchingNodesList.value[0].variables[0].type).toBe('global_constant')
  })

  it('does not re-run a name search when a variable is renamed', async () => {
    const { nodes, search, type } = setup([makeNode('a', { variables: [{ name: 'x' }] })])
    type('a')
    await nextTick()
    const before = search.matchingNodeIds.value
    nodes.value[0].data.variables[0].name = 'y'
    await nextTick()
    expect(search.matchingNodeIds.value).toBe(before)
  })

  describe('mode picker', () => {
    /** Presses a key in the search box. */
    const press = (search, key, init = {}) => {
      const event = new KeyboardEvent('keydown', { key, cancelable: true, ...init })
      search.onSearchKeydown(event)
      return event
    }

    it('shows while the box is focused and empty, and goes once text is typed', () => {
      const { search, type } = setup([])
      expect(search.showModePicker.value).toBe(false)
      search.onSearchFocus()
      expect(search.showModePicker.value).toBe(true)
      type('a')
      expect(search.showModePicker.value).toBe(false)
    })

    it('moves between modes with the arrow keys, wrapping round', () => {
      const { search } = setup([])
      search.onSearchFocus()
      expect(press(search, 'ArrowDown').defaultPrevented).toBe(true)
      expect(search.pickerIndex.value).toBe(1)
      press(search, 'ArrowDown')
      expect(search.pickerIndex.value).toBe(0)
      press(search, 'ArrowUp')
      expect(search.pickerIndex.value).toBe(1)
    })

    it('starts a variable search with Enter or Tab', () => {
      for (const key of ['Enter', 'Tab']) {
        const { search } = setup([])
        search.onSearchFocus()
        press(search, 'ArrowDown')
        expect(press(search, key).defaultPrevented).toBe(true)
        expect(search.searchQuery.value).toBe('var:')
        expect(search.showModePicker.value).toBe(false)
      }
    })

    it('lets Tab leave the box while the name search is highlighted', () => {
      const { search } = setup([])
      search.onSearchFocus()
      expect(press(search, 'Tab').defaultPrevented).toBe(false)
      expect(search.searchQuery.value).toBe('')
    })

    it('closes for a name search and leaves the box empty', () => {
      const { search } = setup([])
      search.onSearchFocus()
      press(search, 'Enter')
      expect(search.searchQuery.value).toBe('')
      expect(search.showModePicker.value).toBe(false)
    })

    it('shows again on the next focus, starting from the name search', () => {
      const { search } = setup([])
      search.onSearchFocus()
      press(search, 'ArrowDown')
      search.pickMode(0)
      search.onSearchBlur()
      search.onSearchFocus()
      expect(search.showModePicker.value).toBe(true)
      expect(search.pickerIndex.value).toBe(0)
    })

    it('shows again once the box is emptied', () => {
      const { search, type } = setup([])
      search.onSearchFocus()
      search.pickMode(1)
      type('var:x')
      search.clearSearch()
      expect(search.showModePicker.value).toBe(true)
      expect(search.pickerIndex.value).toBe(0)
    })

    it('leaves Enter to step through matches once a query is typed', () => {
      const { search, zoomToNode, type } = setup([makeNode('a1'), makeNode('a2')])
      search.onSearchFocus()
      type('a')
      press(search, 'Enter')
      expect(zoomToNode).toHaveBeenCalledWith('a1')
    })

    it('steps through matches with the arrow keys once a query is typed', () => {
      const { search, zoomToNode, type } = setup([makeNode('a1'), makeNode('a2'), makeNode('a3')])
      search.onSearchFocus()
      type('a')
      expect(press(search, 'ArrowDown').defaultPrevented).toBe(true)
      press(search, 'ArrowDown')
      press(search, 'ArrowUp')
      expect(zoomToNode.mock.calls.map(([id]) => id)).toEqual(['a1', 'a2', 'a1'])
    })

    it('leaves the arrow keys to the text when nothing matches', () => {
      const { search, zoomToNode, type } = setup([makeNode('a1')])
      search.onSearchFocus()
      type('zz')
      expect(press(search, 'ArrowDown').defaultPrevented).toBe(false)
      expect(zoomToNode).not.toHaveBeenCalled()
    })
  })
})
