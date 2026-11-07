// @vitest-environment happy-dom
import { nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { getSmoothStepPath } from '@vue-flow/core'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useLibraryStore } from '../../../src/stores/libraryStore.js'

const nodes = ref([])

vi.mock('@vue-flow/core', async (importOriginal) => ({
  ...(await importOriginal()),
  BaseEdge: { name: 'BaseEdge', props: ['path', 'markerEnd', 'style'], template: '<path class="base-edge" />' },
  EdgeLabelRenderer: { name: 'EdgeLabelRenderer', template: '<div><slot /></div>' },
  useVueFlow: () => ({ findNode: (id) => nodes.value.find((node) => node.id === id) }),
}))

const { default: CouplingEdge } = await import('../../../src/components/CouplingEdge.vue')

const UNITS = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="units">
  <units name="mm"><unit prefix="milli" units="metre"/></units>
</model>`

const port = (portType, multiportType = 'None') => ({ portType, label: 'p', variables: ['x'], multiportType })
const node = (id, units) => ({ id, data: { name: id, variables: [{ name: 'x', units }] } })

/** Keeps the tooltip's text on its element, to read back. */
const showTip = (el, { value }) => (el.dataset.tooltip = value)

/** Mounts an edge coupling a's x, in sourceUnits, to b's x, in metre. */
function mountEdge(sourceUnits, multiportType) {
  nodes.value = [node('a', sourceUnits), node('b', 'metre')]
  return mount(CouplingEdge, {
    props: {
      id: 'e',
      source: 'a',
      target: 'b',
      sourceX: 0,
      sourceY: 0,
      targetX: 100,
      targetY: 0,
      sourcePosition: 'right',
      targetPosition: 'left',
      data: { couplings: [{ sourcePort: port('exit_ports', multiportType), targetPort: port('entrance_ports', multiportType) }] },
    },
    global: { directives: { tooltip: { mounted: showTip, updated: showTip } } },
  })
}

describe('CouplingEdge', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useLibraryStore().addUnitsFile({ componentFile: 'units.cellml', model: UNITS })
  })

  describe('route', () => {
    const geometry = { sourceX: 0, sourceY: 0, targetX: 300, targetY: 120, sourcePosition: 'right', targetPosition: 'left' }
    const mountRoute = (data) =>
      mount(CouplingEdge, { props: { id: 'e', source: 'a', target: 'b', ...geometry, data }, global: { directives: { tooltip: {} } } })
    const drawnPath = (wrapper) => wrapper.findComponent({ name: 'BaseEdge' }).props('path')

    it('draws an edge without waypoints exactly as smoothstep does', () => {
      expect(drawnPath(mountRoute({ couplings: [] }))).toBe(getSmoothStepPath(geometry)[0])
    })

    it('draws through the waypoints', () => {
      const path = drawnPath(mountRoute({ couplings: [], waypoints: [{ x: 150, y: -80 }, { x: 250, y: -80 }] }))
      expect(path).not.toBe(getSmoothStepPath(geometry)[0])
      expect(path).toContain('-80')
      expect(path.startsWith('M0 0')).toBe(true)
      expect(path.endsWith('L300 120')).toBe(true)
    })

    it('ignores waypoints that are not points', () => {
      expect(drawnPath(mountRoute({ couplings: [], waypoints: [{ x: 'a', y: 1 }] }))).toBe(getSmoothStepPath(geometry)[0])
    })
  })

  it('warns about variables whose units have different dimensions', () => {
    const wrapper = mountEdge('second')
    expect(wrapper.find('.coupling-edge-warning').exists()).toBe(true)
    expect(wrapper.find('.base-edge').classes()).toContain('coupling-edge--conflict')
  })

  it('leaves units that differ only in scale alone', () => {
    const wrapper = mountEdge('mm')
    expect(wrapper.find('.coupling-edge-warning').exists()).toBe(false)
    expect(wrapper.find('.base-edge').classes()).not.toContain('coupling-edge--conflict')
  })

  it('updates when a row\'s units change', async () => {
    const wrapper = mountEdge('mm')
    nodes.value[0].data.variables[0].units = 'second'
    await nextTick()
    expect(wrapper.find('.coupling-edge-warning').exists()).toBe(true)
  })

  it('updates when the library defines units it couldn\'t resolve', async () => {
    const wrapper = mountEdge('beat')
    expect(wrapper.find('.coupling-edge-warning').exists()).toBe(false)
    useLibraryStore().addUnitsFile({
      componentFile: 'beats.cellml',
      model: '<model xmlns="http://www.cellml.org/cellml/2.0#" name="beats"><units name="beat" base_units="yes"/></model>',
    })
    await nextTick()
    expect(wrapper.find('.coupling-edge-warning').exists()).toBe(true)
  })

  it('reports a pair the ports already reject once, not for its units too', () => {
    const wrapper = mountEdge('second', 'Sum')
    expect(wrapper.find('.coupling-edge-warning i').attributes('data-tooltip')).toBe('"x" and "x" are both Sum variables.')
  })
})
