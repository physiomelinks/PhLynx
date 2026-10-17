import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildSuperInstance, buildSupermoduleInterface } from '../../../src/services/import/buildWorkflow.js'
import { MAIN_NODE_TYPE } from '../../../src/utils/constants.js'

const nodes = ref([])
vi.mock('@vue-flow/core', async (importOriginal) => ({
  ...(await importOriginal()),
  useVueFlow: () => ({ nodes, findNode: (id) => nodes.value.find((node) => node.id === id) }),
}))

const { prefixedNamingMessage, usePreservedNaming } = await import('../../../src/composables/usePreservedNaming.js')

/** A super-module imported from CellML encapsulation: its own names, one super instance. */
function preserved() {
  return [
    buildSupermoduleInterface('sm_0', { name: 'channel', submoduleOrder: ['self', 'dndnode_0'], naming: 'preserve' }),
    { id: 'sm_0~self', type: MAIN_NODE_TYPE, data: { scope: 'sm_0', localId: 'self', name: 'self', originalName: 'channel', role: 'self', variables: [] } },
    { id: 'sm_0~dndnode_0', type: MAIN_NODE_TYPE, data: { scope: 'sm_0', localId: 'dndnode_0', name: 'gate', originalName: 'gate', variables: [] } },
    buildSuperInstance('dndnode_0', 'channel', 'sm_0'),
  ]
}

describe('usePreservedNaming', () => {
  const history = { executeAndAddCommand: vi.fn(async (command) => command.redo()) }
  const naming = () => nodes.value[0].data.supermodule.naming

  beforeEach(() => {
    nodes.value = preserved()
    history.executeAndAddCommand.mockClear()
  })

  it('lets a change through that gives no preserved super-module a second occurrence, without asking', async () => {
    const confirm = vi.fn()
    const guard = usePreservedNaming({ confirm, history })

    expect(guard.asks(nodes.value)).toBe(false)
    expect(await guard.allow(nodes.value)).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('asks before another super instance, listing the flat names that change, and switches to prefixed names as one step', async () => {
    const confirm = vi.fn(async () => true)
    const guard = usePreservedNaming({ confirm, history })
    const after = guard.withSuperInstance('sm_0', null)

    expect(guard.asks(after)).toBe(true)
    expect(await guard.allow(after)).toBe(true)
    expect(confirm.mock.calls[0][0].message).toContain(':\ngate → channel__gate')
    expect(naming()).toBe('prefixed')
    const [[command]] = history.executeAndAddCommand.mock.calls
    command.undo()
    expect(naming()).toBe('preserve')
  })

  it('leaves the names, and refuses the change, when declined or with no one to ask', async () => {
    const after = usePreservedNaming({ history }).withSuperInstance('sm_0', null)
    expect(await usePreservedNaming({ confirm: async () => false, history }).allow(after)).toBe(false)
    expect(await usePreservedNaming({ history }).allow(after)).toBe(false)
    expect(naming()).toBe('preserve')
    expect(history.executeAndAddCommand).not.toHaveBeenCalled()
  })

  it('lists at most eight flat names', () => {
    const changes = Array.from({ length: 10 }, (_, i) => ({ from: `c${i}`, to: `p__c${i}` }))
    const message = prefixedNamingMessage(['channel'], changes)
    expect(message).toContain('c7 → p__c7\nand 2 more')
    expect(message).not.toContain('c8 →')
  })
})
