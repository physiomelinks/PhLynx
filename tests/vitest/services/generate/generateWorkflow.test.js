import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const flow = vi.hoisted(() => ({}))
vi.mock('@vue-flow/core', async (importOriginal) => ({
  ...(await importOriginal()),
  useVueFlow: () => flow,
}))

import { useMacroGenerator } from '../../../../src/services/generate/generateWorkflow.js'
import { useWorkspaceAppearanceStore } from '../../../../src/stores/workspaceAppearanceStore.js'
import { GHOST_NODE_TYPE } from '../../../../src/utils/constants.js'

const nodes = ref([])
const edges = ref([])
Object.assign(flow, {
  nodes,
  edges,
  getNodes: nodes,
  addNodes: (added) => nodes.value.push(...added),
  addEdges: (added) => edges.value.push(...added),
})

const macroNode = (id, x) => ({ id, type: 'moduleNode', position: { x, y: 0 }, data: { name: id } })

describe('useMacroGenerator', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    nodes.value = []
    edges.value = []
  })

  it('gives the internal and chaining edges the default appearance for new connections', () => {
    useWorkspaceAppearanceStore().setConnectionDefaults({ colour: '#0000ff', arrow: 'small' })
    const ghost = { id: 'ghost', type: GHOST_NODE_TYPE, position: { x: 300, y: 0 }, data: { targetNodeId: 'a' } }
    const macro = {
      flow: {
        nodes: [macroNode('a', 0), macroNode('b', 100), ghost],
        edges: [
          { id: 'ab', source: 'a', target: 'b', type: 'smoothstep' },
          { id: 'b-ghost', source: 'b', target: 'ghost', sourceHandle: 's', targetHandle: 't' },
        ],
      },
      repeatCount: 2,
    }

    useMacroGenerator().processMacroGeneration(macro)

    // Two internal edges, and one chaining edge from the first copy into the second.
    expect(edges.value).toHaveLength(3)
    for (const edge of edges.value) expect(edge.data.appearance).toEqual({ colour: '#0000ff', arrow: 'small' })
  })

  it('leaves the appearance out while the default is the built-in one', () => {
    const macro = { flow: { nodes: [macroNode('a', 0), macroNode('b', 100)], edges: [{ id: 'ab', source: 'a', target: 'b' }] }, repeatCount: 1 }

    useMacroGenerator().processMacroGeneration(macro)

    expect(edges.value).toHaveLength(1)
    expect(edges.value[0].data).toEqual({})
  })
})
