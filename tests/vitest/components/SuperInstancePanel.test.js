// @vitest-environment happy-dom
import { useVueFlow } from '@vue-flow/core'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SuperInstancePanel from '../../../src/components/SuperInstancePanel.vue'
import { useEdgeDialog } from '../../../src/composables/useEdgeDialog.js'
import { FLOW_IDS } from '../../../src/utils/constants.js'
import { exposed, exposures, module, port, superInstance, supermodule } from '../fixtures/hierarchy/graph.js'

describe('SuperInstancePanel', () => {
  const flow = useVueFlow(FLOW_IDS.MAIN)
  const { setEdgeDialogOpener } = useEdgeDialog()
  let wrapper

  beforeEach(async () => {
    setActivePinia(createPinia())
    const lv = module('dndnode_0', 'lv', { scope: 'sm_1', ports: [port('entrance_ports', 'vessel', ['v_in'])] })
    const edges = exposures('sm_1', [exposed('xp_in', 'dndnode_0', 'entrance_ports', 'vessel')])
    const inner = { nodes: [supermodule('sm_1', 'heart'), lv], edges }
    const left = superInstance(inner, 'dndnode_1', 'left', 'sm_1')
    left.data.broken = ['xp_gone']
    const pump = module('dndnode_2', 'pump')
    const coupling = { sourcePort: { exposedPortId: 'xp_gone', label: 'vessel' }, targetPort: { label: 'out' } }
    const edge = { id: 'e1', source: 'dndnode_1', target: 'dndnode_2', data: { couplings: [coupling] } }
    await flow.fromObject({ nodes: [left, pump, ...inner.nodes], edges: [...edges, edge] })
  })
  afterEach(() => {
    wrapper?.unmount()
    setEdgeDialogOpener(null)
  })

  it('opens a broken coupling’s connection from the list', async () => {
    const open = vi.fn()
    setEdgeDialogOpener(open)
    wrapper = mount(SuperInstancePanel, {
      props: { node: flow.findNode('dndnode_1') },
      global: { plugins: [PrimeVue], directives: { tooltip: {} } },
    })
    const item = wrapper.find('button.broken-coupling')
    expect(item.text()).toBe('vessel ↔ pump.out')
    await item.trigger('click')
    expect(open).toHaveBeenCalledWith('e1')
  })
})
