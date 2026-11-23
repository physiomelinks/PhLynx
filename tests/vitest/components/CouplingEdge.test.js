// @vitest-environment happy-dom
import { nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { getSmoothStepPath } from '@vue-flow/core'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useEdgeDragOffsets } from '../../../src/composables/useEdgeDragOffsets.js'
import { setEdgeRoute } from '../../../src/composables/useEdgeRouteEditing.js'
import { useFlowHistoryStore } from '../../../src/stores/historyStore.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { ARROW_SIZES, EDGE_WIDTHS } from '../../../src/utils/constants.js'

const nodes = ref([])
const edges = ref([])
const selectedEdges = ref([])

vi.mock('@vue-flow/core', async (importOriginal) => ({
  ...(await importOriginal()),
  BaseEdge: { name: 'BaseEdge', props: ['path', 'markerEnd', 'style'], template: '<path class="base-edge" />' },
  EdgeLabelRenderer: { name: 'EdgeLabelRenderer', template: '<div><slot /></div>' },
  // Screen and flow coordinates are the same here.
  useVueFlow: () => ({
    findNode: (id) => nodes.value.find((node) => node.id === id),
    findEdge: (id) => edges.value.find((edge) => edge.id === id),
    getSelectedEdges: selectedEdges,
    screenToFlowCoordinate: ({ x, y }) => ({ x, y }),
    viewport: ref({ x: 0, y: 0, zoom: 1 }),
  }),
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
      mount(CouplingEdge, { props: { id: 'e', source: 'a', target: 'b', ...geometry, data }, global: { directives: { tooltip: {}, hint: {} } } })
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

    describe('editing', () => {
      // Mounted from the edge in `edges`, as vue-flow passes its data, and kept in step with it.
      const mountSelected = async (data = { couplings: [] }) => {
        edges.value = [{ id: 'e', source: 'a', target: 'b', data }]
        selectedEdges.value = [edges.value[0]]
        const wrapper = mount(CouplingEdge, {
          props: { id: 'e', source: 'a', target: 'b', ...geometry, data, selected: true },
          global: { directives: { tooltip: {}, hint: {} } },
        })
        return wrapper
      }
      const drag = async (wrapper, index, from, to, options = {}) => {
        const handle = wrapper.find(`[data-testid="edge-route-handle-${index}"]`)
        await handle.trigger('pointerdown', { button: 0, pointerId: 1, clientX: from.x, clientY: from.y })
        window.dispatchEvent(new PointerEvent('pointermove', { clientX: to.x, clientY: to.y, ...options }))
        await nextTick()
        return handle
      }
      const release = async () => {
        window.dispatchEvent(new PointerEvent('pointerup', {}))
        await nextTick()
      }

      it('shows a handle on each segment between the stubs only while it is the one selected edge', async () => {
        const wrapper = await mountSelected()
        // smoothstep: S, S', (150,0), (150,120), T', T
        expect(wrapper.findAll('.edge-route-handle').map((h) => h.attributes('data-testid'))).toEqual([
          'edge-route-handle-1',
          'edge-route-handle-2',
          'edge-route-handle-3',
        ])
        selectedEdges.value = [edges.value[0], { id: 'other' }]
        await nextTick()
        expect(wrapper.findAll('.edge-route-handle')).toHaveLength(0)
      })

      it('moves a segment, stores the route, and undoes and redoes it as one step', async () => {
        const wrapper = await mountSelected()
        await drag(wrapper, 2, { x: 150, y: 60 }, { x: 220, y: 60 })
        expect(drawnPath(wrapper)).toContain('220')
        expect(edges.value[0].data.waypoints).toBeUndefined()

        await release()
        expect(edges.value[0].data.waypoints).toEqual([
          { x: 220, y: 0 },
          { x: 220, y: 120 },
        ])

        await new Promise((resolve) => setTimeout(resolve, 40))
        const history = useFlowHistoryStore()
        await history.undo()
        expect(edges.value[0].data.waypoints).toBeUndefined()
        await history.redo()
        expect(edges.value[0].data.waypoints).toHaveLength(2)
      })

      it('snaps a segment into line with another, unless Alt is held', async () => {
        const wrapper = await mountSelected()
        // Segment 1 runs along y = 0; moving segment 3 (y = 120) near 0 lines it up.
        await drag(wrapper, 3, { x: 200, y: 120 }, { x: 200, y: 4 })
        await release()
        expect(edges.value[0].data.waypoints).toEqual([{ x: 280, y: 0 }])

        edges.value[0].data = { couplings: [] }
        const fresh = await mountSelected()
        await drag(fresh, 3, { x: 200, y: 120 }, { x: 200, y: 4 }, { altKey: true })
        await release()
        expect(edges.value[0].data.waypoints).toEqual([
          { x: 150, y: 0 },
          { x: 150, y: 4 },
          { x: 280, y: 4 },
        ])
      })

      it('keeps dragging the segment next to a stub after it splits off and its handle is re-keyed', async () => {
        const wrapper = await mountSelected()
        await drag(wrapper, 1, { x: 80, y: 0 }, { x: 80, y: -30 })
        window.dispatchEvent(new PointerEvent('pointermove', { clientX: 80, clientY: -60 }))
        await release()
        expect(edges.value[0].data.waypoints).toEqual([
          { x: 20, y: -60 },
          { x: 150, y: -60 },
          { x: 150, y: 120 },
        ])
      })

      it('hides its handles while its two nodes are dragged together', async () => {
        const wrapper = await mountSelected()
        const { edgeDragOffsets } = useEdgeDragOffsets()
        edgeDragOffsets.value = new Map([['e', { x: 5, y: 5 }]])
        await nextTick()
        expect(wrapper.findAll('.edge-route-handle')).toHaveLength(0)
        edgeDragOffsets.value = new Map()
      })

      it('cancels a drag on Escape', async () => {
        const wrapper = await mountSelected()
        await drag(wrapper, 2, { x: 150, y: 60 }, { x: 220, y: 60 })
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        await nextTick()
        expect(drawnPath(wrapper)).toBe(getSmoothStepPath(geometry)[0])
        expect(edges.value[0].data.waypoints).toBeUndefined()
      })
    })

    it('refuses to store a route longer than an edge can keep', () => {
      edges.value = [{ id: 'e', data: {} }]
      const history = { addCommand: vi.fn() }
      const tooMany = Array.from({ length: 65 }, (_, i) => ({ x: i, y: i % 2 }))
      expect(setEdgeRoute({ findEdge: (id) => edges.value.find((e) => e.id === id), history }, 'e', tooMany)).toBe(false)
      expect(edges.value[0].data.waypoints).toBeUndefined()
      expect(history.addCommand).not.toHaveBeenCalled()
    })

    it('ignores waypoints that are not points', () => {
      expect(drawnPath(mountRoute({ couplings: [], waypoints: [{ x: 'a', y: 1 }] }))).toBe(getSmoothStepPath(geometry)[0])
    })
  })

  describe('appearance', () => {
    const geometry = { sourceX: 0, sourceY: 0, targetX: 300, targetY: 120, sourcePosition: 'right', targetPosition: 'left' }
    const mountStyled = (props = {}) =>
      mount(CouplingEdge, {
        props: { id: 'e', source: 'a', target: 'b', ...geometry, data: { couplings: [] }, ...props },
        global: { directives: { tooltip: {}, hint: {} } },
      })
    const baseEdge = (wrapper) => wrapper.findComponent({ name: 'BaseEdge' })
    const waypoints = [{ x: 150, y: -80 }, { x: 250, y: -80 }]

    it('draws the built-in line and arrow when it has no appearance', () => {
      const wrapper = mountStyled()
      expect(baseEdge(wrapper).props('style').strokeWidth).toBe(EDGE_WIDTHS.normal)
      expect(baseEdge(wrapper).props('markerEnd')).toBe('url(#coupling-edge-arrow-e)')
      expect(wrapper.find('marker').attributes()).toMatchObject({
        markerwidth: String(ARROW_SIZES.medium),
        markerunits: 'userSpaceOnUse',
      })
    })

    it('squares the corners of a step edge, with or without waypoints', () => {
      const step = (extra = {}) => ({ data: { couplings: [], appearance: { path: 'step' }, ...extra } })
      expect(baseEdge(mountStyled(step())).props('path')).toBe(getSmoothStepPath({ ...geometry, borderRadius: 0 })[0])
      const rounded = baseEdge(mountStyled({ data: { couplings: [], waypoints } })).props('path')
      const square = baseEdge(mountStyled(step({ waypoints }))).props('path')
      expect(rounded).toContain('Q')
      expect(square).not.toBe(rounded)
    })

    it('widens the line by its width, and by 2 more when selected', () => {
      const thick = { data: { couplings: [], appearance: { width: 'thick' } } }
      expect(baseEdge(mountStyled(thick)).props('style').strokeWidth).toBe(EDGE_WIDTHS.thick)
      expect(baseEdge(mountStyled({ ...thick, selected: true })).props('style').strokeWidth).toBe(EDGE_WIDTHS.thick + 2)
    })

    it('overrides the stroke width older edges were saved with', () => {
      const wrapper = mountStyled({ style: { strokeWidth: 5, opacity: 0.4 }, data: { couplings: [], appearance: { width: 'thin' } } })
      expect(baseEdge(wrapper).props('style')).toMatchObject({ strokeWidth: EDGE_WIDTHS.thin, opacity: 0.4 })
    })

    it('leaves the line colour to CSS, so it can show conflicts and uncoupled edges', () => {
      // A colour from an older build is ignored.
      const wrapper = mountStyled({ data: { couplings: [], appearance: { colour: '#ff0000' } } })
      expect(baseEdge(wrapper).props('style').stroke).toBeUndefined()
      expect(wrapper.find('marker polyline').attributes('style')).toBeUndefined()
    })

    it('sizes the arrow by its option, the same whether selected or not', () => {
      for (const [size, width] of Object.entries(ARROW_SIZES)) {
        for (const selected of [false, true]) {
          const marker = mountStyled({ data: { couplings: [], appearance: { arrow: size } }, selected }).find('marker')
          expect(marker.attributes('markerwidth')).toBe(String(width))
        }
      }
    })

    it('draws no arrow for none', () => {
      const wrapper = mountStyled({ data: { couplings: [], appearance: { arrow: 'none' } } })
      expect(wrapper.find('marker').exists()).toBe(false)
      expect(baseEdge(wrapper).props('markerEnd')).toBeUndefined()
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
