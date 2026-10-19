import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ onNodesInitialized: vi.fn(), addEdges: vi.fn() }))

vi.mock('@vue-flow/core', async (importOriginal) => ({
  ...(await importOriginal()),
  useVueFlow: () => ({
    onNodesInitialized: mocks.onNodesInitialized,
    addEdges: mocks.addEdges,
    updateNodeInternals: vi.fn(),
    fitView: vi.fn(),
  }),
}))
vi.mock('../../../src/stores/historyStore', () => ({ useFlowHistoryStore: () => ({ clear: vi.fn() }) }))

import { useWorkflowLayout } from '../../../src/composables/useWorkflowLayout.js'

describe('useWorkflowLayout', () => {
  it('resolves at once when no nodes are about to be added', async () => {
    const { prepareLayout } = useWorkflowLayout()

    await expect(prepareLayout([], null, 0)).resolves.toBeUndefined()
  })

  it('stays unarmed after a zero-node call, so a later nodes-initialised event lays nothing out', async () => {
    const { prepareLayout } = useWorkflowLayout()
    const onInitialized = mocks.onNodesInitialized.mock.calls.at(-1)[0]

    prepareLayout([{ id: 'e1' }], null, 0)
    await onInitialized([{ id: 'n1' }])

    expect(mocks.addEdges).not.toHaveBeenCalled()
  })
})
