// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import EdgeConnectionDialog from '../../../src/components/EdgeConnectionDialog.vue'
import PortRow from '../../../src/components/PortRow.vue'
import { PROBLEM_DELAY_MS } from '../../../src/composables/useEdgeCouplings.js'
import { module, port } from '../fixtures/hierarchy/graph.js'

// Shows as soon as it mounts, as PrimeVue's Dialog does once open.
const DialogStub = { emits: ['show'], mounted() { this.$emit('show') }, template: '<div><slot /><slot name="footer" /></div>' }
// Draws each port row through the dialog's node slots, and lets a test emit the canvas's connect events.
const VueFlowStub = {
  name: 'VueFlow',
  props: ['nodes', 'edges'],
  emits: ['connect', 'edge-update'],
  template: '<div><template v-for="node in nodes" :key="node.id"><slot :name="`node-${node.type}`" :data="node.data" /></template></div>',
}
const tooltips = new Map()
const tooltip = {
  mounted: (el, { value }) => tooltips.set(el, value),
  updated: (el, { value }) => tooltips.set(el, value),
}

/** Opens the dialog on the edge x → y, with these ports and the edge's stored couplings, once its canvas is ready. */
async function open(sourcePorts, targetPorts, couplings = []) {
  const x = module('x', 'x', { ports: sourcePorts })
  const y = module('y', 'y', { ports: targetPorts })
  const edge = { id: 'x--y', type: 'smoothstep', source: 'x', target: 'y', data: { couplings } }
  const wrapper = mount(EdgeConnectionDialog, {
    props: { modelValue: true, sourceNode: x, targetNode: y, activeEdge: edge, subgraph: new Map([[edge.id, edge]]) },
    global: { plugins: [PrimeVue], directives: { tooltip }, stubs: { Dialog: DialogStub, VueFlow: VueFlowStub, MultiportKey: true, Handle: true } },
  })
  await new Promise((resolve) => setTimeout(resolve, 450))
  await flushPromises()
  return wrapper
}

const flow = (wrapper) => wrapper.findComponent({ name: 'VueFlow' })
const rows = (wrapper, side) => wrapper.findAllComponents(PortRow).filter((row) => row.props('side') === side)
const uid = (wrapper, side, index) => rows(wrapper, side)[index].props('port')._uid
const done = (wrapper) => wrapper.findAll('button').find((button) => button.text() === 'Done')
const problemTexts = (wrapper) => wrapper.findAll('.coupling-problem').map((message) => message.text())
const refusalText = (wrapper) => wrapper.find('.pairing-refusal').text()
const drag = async (wrapper, srcIndex, tgtIndex) => {
  flow(wrapper).vm.$emit('connect', { source: `src-${uid(wrapper, 'source', srcIndex)}`, target: `tgt-${uid(wrapper, 'target', tgtIndex)}` })
  await flushPromises()
}
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, PROBLEM_DELAY_MS + 30))
  await flushPromises()
}

describe('EdgeConnectionDialog as CA pairs', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => tooltips.clear())

  it('confirms couplings CA reproduces', async () => {
    const wrapper = await open([port('exit_ports', 'vessel_port', ['v'])], [port('entrance_ports', 'vessel_port', ['v'])])
    expect(problemTexts(wrapper)).toEqual([])
    expect(done(wrapper).attributes('disabled')).toBeUndefined()
    await done(wrapper).trigger('click')
    expect(wrapper.emitted('confirm')[0][0].couplings).toHaveLength(1)
  })

  it('names a shared label left uncoupled on its rows and in the list, and keeps Done off with why', async () => {
    // q's ports have different numbers of variables, so it isn't coupled.
    const wrapper = await open(
      [port('exit_ports', 'vessel_port', ['v']), port('general_ports', 'q', ['a', 'b'])],
      [port('entrance_ports', 'vessel_port', ['v']), port('general_ports', 'q', ['a'])]
    )
    const [problem] = problemTexts(wrapper)
    expect(problem).toMatch(/"q", left uncoupled/)
    expect(problem).toMatch(/Couple it, or change the module's ports in the instance editor/)
    expect(rows(wrapper, 'source')[1].props('problems')).toEqual([expect.stringMatching(/"q"/)])
    expect(rows(wrapper, 'target')[1].props('problems')).toEqual([expect.stringMatching(/"q"/)])
    expect(rows(wrapper, 'source')[0].props('problems')).toEqual([])
    expect(done(wrapper).attributes('disabled')).toBeDefined()
    expect(tooltips.get(wrapper.find('.confirm-wrap').element)).toMatch(/CA can't reproduce these couplings: .*"q"/)

    await done(wrapper).trigger('click')
    expect(wrapper.emitted('confirm')).toBeUndefined()
  })

  it('lets Done back on once the problem is fixed here', async () => {
    const wrapper = await open(
      [port('exit_ports', 'vessel_port', ['v']), port('general_ports', 'q', ['a', 'b'])],
      [port('entrance_ports', 'vessel_port', ['v']), port('general_ports', 'q', ['a'])]
    )
    expect(done(wrapper).attributes('disabled')).toBeDefined()
    rows(wrapper, 'target')[1].vm.$emit('delete')
    await settle()
    expect(problemTexts(wrapper)).toEqual([])
    expect(done(wrapper).attributes('disabled')).toBeUndefined()
  })

  it('refuses a drag between ports of different numbers of variables, and says why', async () => {
    const wrapper = await open(
      [port('exit_ports', 'vessel_port', ['v']), port('general_ports', 'q', ['a', 'b'])],
      [port('entrance_ports', 'vessel_port', ['v']), port('general_ports', 'q', ['a'])]
    )
    await drag(wrapper, 1, 1)
    expect(refusalText(wrapper)).toMatch(/source port has 2 and the target port 1/)
    expect(flow(wrapper).props('edges')).toHaveLength(1)
  })

  it('refuses a drag from an entrance port, and says why', async () => {
    const wrapper = await open(
      [port('exit_ports', 'vessel_port', ['v']), port('entrance_ports', 'r', ['a'])],
      [port('entrance_ports', 'vessel_port', ['v']), port('entrance_ports', 'r', ['a'])]
    )
    await drag(wrapper, 1, 1)
    expect(refusalText(wrapper)).toMatch(/from an entrance port/)
    expect(flow(wrapper).props('edges')).toHaveLength(1)
  })

  it('refuses a second vessel_port pair on the connection, and says why', async () => {
    const vessel = (portType, variable) => port(portType, 'vessel_port', [variable])
    const wrapper = await open([vessel('exit_ports', 'a'), vessel('exit_ports', 'b')], [vessel('entrance_ports', 'c'), vessel('entrance_ports', 'd')])
    expect(flow(wrapper).props('edges')).toHaveLength(1)
    await drag(wrapper, 1, 1)
    expect(refusalText(wrapper)).toMatch(/one vessel_port slot with one slot on each connection/)
    expect(flow(wrapper).props('edges')).toHaveLength(1)
  })

  it('refuses a second target slot for a label, and says why', async () => {
    const wrapper = await open(
      [port('exit_ports', 'p', ['a']), port('general_ports', 'p', ['b'])],
      [port('entrance_ports', 'p', ['c'], 'True'), port('general_ports', 'p', ['d'])]
    )
    expect(flow(wrapper).props('edges')).toHaveLength(2)
    await drag(wrapper, 1, 1)
    expect(refusalText(wrapper)).toMatch(/into one slot of the target/)
  })

  it('gives an order problem on the coupling and its ports, saying what CA would pair instead', async () => {
    const sourcePorts = [port('exit_ports', 'vessel_port', ['a']), port('general_ports', 'vessel_port', ['b'])]
    const targetPorts = [port('entrance_ports', 'vessel_port', ['c'])]
    const stored = [{ sourcePort: sourcePorts[1], targetPort: targetPorts[0], sourceSlot: 0, targetSlot: 0 }]
    const wrapper = await open(sourcePorts, targetPorts, stored)

    expect(problemTexts(wrapper)).toEqual([expect.stringMatching(/would pair "x"'s exit vessel_port with "y"'s entrance vessel_port instead of "x"'s general/)])
    expect(rows(wrapper, 'source')[1].props('problems')).toHaveLength(1)
    expect(rows(wrapper, 'target')[0].props('problems')).toHaveLength(1)
    expect(rows(wrapper, 'source')[0].props('problems')).toEqual([])
    expect(flow(wrapper).props('edges')[0].class).toBe('coupling--problem')
    expect(done(wrapper).attributes('disabled')).toBeDefined()
  })

  it('checks a port edit a moment later, not on each keystroke', async () => {
    const wrapper = await open(
      [port('exit_ports', 'vessel_port', ['v']), port('exit_ports', 'q', ['a', 'b'])],
      [port('entrance_ports', 'vessel_port', ['v']), port('entrance_ports', 'z', ['a'])]
    )
    expect(problemTexts(wrapper)).toEqual([])
    const target = rows(wrapper, 'target')[1]
    target.props('port').label = 'q'
    target.vm.$emit('change')
    await flushPromises()
    expect(problemTexts(wrapper)).toEqual([])

    await settle()
    expect(problemTexts(wrapper)).toEqual([expect.stringMatching(/"q", left uncoupled/)])
    expect(done(wrapper).attributes('disabled')).toBeDefined()
  })
})
