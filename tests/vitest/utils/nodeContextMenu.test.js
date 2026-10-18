import { describe, expect, it, vi } from 'vitest'

import { MAIN_NODE_TYPE, SUPER_INSTANCE_NODE_TYPE, SUPERMODULE_INTERFACE_NODE_TYPE } from '../../../src/utils/constants.js'
import { nodeContextMenuItems } from '../../../src/utils/nodeContextMenu.js'

describe('nodeContextMenuItems', () => {
  const superInstanceNode = { id: 'dndnode_1', type: SUPER_INSTANCE_NODE_TYPE, data: { smId: 'sm_1' } }
  const moduleNode = { id: 'dndnode_0', type: MAIN_NODE_TYPE, data: {} }
  const actions = () => ({
    open: vi.fn(),
    editSupermodule: vi.fn(),
    makeUnique: vi.fn(),
    unnest: vi.fn(),
    nest: vi.fn(),
    remove: vi.fn(),
    replace: vi.fn(),
    simulate: vi.fn(),
    goUp: vi.fn(),
    fitView: vi.fn(),
  })
  const build = (node, isEditingSupermodule = false, own = actions(), options = {}) =>
    nodeContextMenuItems({ node, isEditingSupermodule, simulateLabel: 'Simulate Instance', actions: own, ...options })
  const labels = (items) => items.map((item) => item.label)

  it('gives a super instance Open, Edit Super-module, Make Unique, Un-nest, Simulate and Delete, each acting on it', () => {
    const own = actions()
    const items = build(superInstanceNode, false, own, { canMakeUnique: true })
    expect(labels(items)).toEqual(['Open', 'Edit Super-module', 'Make Unique', 'Un-nest', 'Simulate Instance', 'Delete'])
    expect(items.some((item) => item.disabled)).toBe(false)
    items.forEach((item) => item.action())
    for (const name of ['open', 'editSupermodule', 'makeUnique', 'unnest', 'simulate', 'remove']) expect(own[name]).toHaveBeenCalledWith(superInstanceNode)
    expect(own.replace).not.toHaveBeenCalled()
  })

  it('gives an interface node Go Up a Level and Fit View, without Nest or Simulate', () => {
    const own = actions()
    const node = { id: 'sm_1', type: SUPERMODULE_INTERFACE_NODE_TYPE, data: {} }
    const items = build(node, false, own, { nestLabel: 'Nest in Super-module' })
    expect(labels(items)).toEqual(['Go Up a Level', 'Fit View'])
    items.forEach((item) => item.action())
    expect(own.goUp).toHaveBeenCalledWith(node)
    expect(own.fitView).toHaveBeenCalledWith(node)
  })

  it('disables Make Unique when the super-module has no other copy', () => {
    const item = build(superInstanceNode).find((entry) => entry.label === 'Make Unique')
    expect(item.disabled).toBe(true)
    expect(item.title).toMatch(/no other copy/)
  })

  it('offers Nest when given what it nests, on modules and super instances alike', () => {
    const own = actions()
    expect(labels(build(moduleNode, false, own, { nestLabel: 'Nest Selection (2)' }))).toEqual(['Replace Module', 'Nest Selection (2)', 'Simulate Instance'])
    const items = build(superInstanceNode, false, own, { nestLabel: 'Nest in Super-module' })
    items.find((item) => item.label === 'Nest in Super-module').action()
    expect(own.nest).toHaveBeenCalledWith(superInstanceNode)
  })

  it('gives a module Replace Module and Simulate', () => {
    const own = actions()
    const items = build(moduleNode, false, own)
    expect(labels(items)).toEqual(['Replace Module', 'Simulate Instance'])
    items[0].action()
    expect(own.replace).toHaveBeenCalledWith(moduleNode)
  })

  it('has no Simulate while a super-module is edited on its own', () => {
    expect(labels(build(superInstanceNode, true))).toEqual(['Open', 'Edit Super-module', 'Make Unique', 'Un-nest', 'Delete'])
    expect(labels(build(moduleNode, true))).toEqual(['Replace Module'])
  })
})
