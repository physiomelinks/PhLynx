// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/utils/multiport', () => ({
  couplingConflicts: (sourcePort) => (sourcePort.conflict ? ['Conflicting multiport types.'] : []),
}))
vi.mock('@vue-flow/core', async (importOriginal) => ({
  ...(await importOriginal()),
  EdgeLabelRenderer: { template: '<div class="label-renderer"><slot /></div>' },
}))

import { getBezierPath, getSmoothStepPath, getStraightPath } from '@vue-flow/core'
import CouplingEdge from '../../../src/components/CouplingEdge.vue'
import { ARROW_SIZES, EDGE_WIDTHS } from '../../../src/utils/constants'

const POSITIONS = {
  sourceX: 0,
  sourceY: 0,
  targetX: 200,
  targetY: 100,
  sourcePosition: 'bottom',
  targetPosition: 'top',
}

/**
 * Mounts an edge from a to b inside an svg.
 *
 * @param {Object} [props]
 * @returns {import('@vue/test-utils').VueWrapper}
 */
function mountEdge(props = {}) {
  return mount(CouplingEdge, {
    props: { id: 'e1', source: 'a', target: 'b', ...POSITIONS, ...props },
    global: { directives: { tooltip: {} } },
    attachTo: document.body,
  })
}

const edgePath = (wrapper) => wrapper.find('path.vue-flow__edge-path')
const arrow = (wrapper) => wrapper.find('marker polyline')
const conflicting = { couplings: [{ sourcePort: { conflict: true }, targetPort: {} }] }

describe('CouplingEdge', () => {
  it('draws the built-in smoothstep path, line and arrow when it has no appearance', () => {
    const wrapper = mountEdge()
    const path = edgePath(wrapper)

    expect(path.attributes('d')).toBe(getSmoothStepPath(POSITIONS)[0])
    expect(path.element.style.strokeWidth).toBe(String(EDGE_WIDTHS.normal))
    expect(path.element.style.stroke).toBe('')
    expect(path.attributes('marker-end')).toBe('url(#coupling-edge-arrow-e1)')
    expect(wrapper.find('marker').attributes()).toMatchObject({
      markerwidth: String(ARROW_SIZES.medium),
      markerunits: 'userSpaceOnUse',
    })
  })

  it.each([
    ['smoothstep', () => getSmoothStepPath(POSITIONS)],
    ['bezier', () => getBezierPath(POSITIONS)],
    ['straight', () => getStraightPath(POSITIONS)],
    ['step', () => getSmoothStepPath({ ...POSITIONS, borderRadius: 0 })],
  ])('draws a %s path', (path, expected) => {
    expect(edgePath(mountEdge({ data: { appearance: { path } } })).attributes('d')).toBe(expected()[0])
  })

  it('widens the line by its width, and by 2 more when selected', () => {
    const thick = { data: { appearance: { width: 'thick' } } }
    expect(edgePath(mountEdge(thick)).element.style.strokeWidth).toBe(String(EDGE_WIDTHS.thick))
    expect(edgePath(mountEdge({ ...thick, selected: true })).element.style.strokeWidth).toBe(String(EDGE_WIDTHS.thick + 2))
  })

  it('overrides the stroke width older edges were saved with', () => {
    const wrapper = mountEdge({ style: { strokeWidth: 5, opacity: 0.4 }, data: { appearance: { width: 'thin' } } })
    expect(edgePath(wrapper).element.style.strokeWidth).toBe(String(EDGE_WIDTHS.thin))
    expect(edgePath(wrapper).element.style.opacity).toBe('0.4')
  })

  it('colours the line and arrow unless it is selected or conflicting, which CSS colours', () => {
    const red = { appearance: { colour: '#ff0000' } }
    const plain = mountEdge({ data: red })
    expect(edgePath(plain).element.style.stroke).toBe('#ff0000')
    expect(arrow(plain).element.style.fill).toBe('#ff0000')

    const selected = mountEdge({ data: red, selected: true })
    expect(edgePath(selected).element.style.stroke).toBe('')
    expect(arrow(selected).element.style.fill).toBe('')
    expect(arrow(selected).classes()).toContain('coupling-edge-arrow--selected')

    const conflict = mountEdge({ data: { ...red, ...conflicting } })
    expect(edgePath(conflict).element.style.stroke).toBe('')
    expect(edgePath(conflict).classes()).toContain('coupling-edge--conflict')
    expect(arrow(conflict).classes()).toContain('coupling-edge-arrow--conflict')
  })

  it('sizes the arrow by its option, the same whether selected or not', () => {
    for (const [size, width] of Object.entries(ARROW_SIZES)) {
      for (const selected of [false, true]) {
        const marker = mountEdge({ data: { appearance: { arrow: size } }, selected }).find('marker')
        expect(marker.attributes('markerwidth')).toBe(String(width))
      }
    }
  })

  it('draws no arrow for none', () => {
    const wrapper = mountEdge({ data: { appearance: { arrow: 'none' } } })
    expect(wrapper.find('marker').exists()).toBe(false)
    expect(edgePath(wrapper).attributes('marker-end')).toBeUndefined()
  })
})
