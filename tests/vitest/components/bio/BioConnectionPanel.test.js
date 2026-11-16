// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import BioConnectionPanel from '../../../../src/components/bio/BioConnectionPanel.vue'
import { connectionsMenu, connectionsOf, portSummary } from '../../../../src/services/bioView/connections'

const port = (label, variables, extra = {}) => ({ portType: 'general_ports', label, variables, ...extra })
const annotated = (variable, species, property) =>
  port('', [variable], {
    annotation: { subject: `http://x#${variable}`, species: [species], property, location: 'self', role: 'reader' },
  })
const node = (id, name) => ({ id, data: { name } })

const nodes = [node('nka', 'NKA'), node('cell', 'epithelial'), node('blood', 'capillary'), node('lone', 'Kir')]
const edges = [
  {
    id: 'cell--nka',
    source: 'cell',
    target: 'nka',
    data: {
      couplings: [
        {
          sourcePort: annotated('c_Na', 'CHEBI:29101', 'OPB:00340'),
          targetPort: annotated('c_Na_i', 'CHEBI:29101', 'OPB:00340'),
        },
      ],
      // Kept manual couplings never count.
      manualCouplings: [{ sourcePort: port('old', ['x']), targetPort: port('old', ['y']) }],
    },
  },
  {
    id: 'nka--blood',
    source: 'nka',
    target: 'blood',
    data: { couplings: [{ sourcePort: port('c_K_o', ['c_K_o']), targetPort: port('c_K_o', ['c_K']) }] },
  },
  { id: 'nka--gone', source: 'nka', target: 'gone', data: { couplings: [] } },
]

describe('connectionsOf', () => {
  it('lists the coupled instances by name, from this instance’s side, ignoring manual couplings', () => {
    const connections = connectionsOf('nka', nodes, edges)
    expect(connections.map((connection) => connection.name)).toEqual(['capillary', 'epithelial'])
    const [blood, cell] = connections
    expect(blood.couplings).toEqual([
      { outgoing: true, mine: { name: 'c_K_o', annotation: null }, theirs: { name: 'c_K_o', annotation: null } },
    ])
    expect(cell.couplings).toHaveLength(1)
    expect(cell.couplings[0]).toMatchObject({ outgoing: false, mine: { name: 'c_Na_i' }, theirs: { name: 'c_Na' } })
  })

  it('has none for an uncoupled instance', () => {
    expect(connectionsOf('lone', nodes, edges)).toEqual([])
  })
})

describe('portSummary', () => {
  it('gives an annotated port its variable and its species and property, not its place', () => {
    const summary = portSummary(annotated('c_Na', 'CHEBI:29101', 'OPB:00340'))
    expect(summary.name).toBe('c_Na')
    expect(summary.annotation).toContain(' · ')
    expect(summary.annotation).not.toContain('self')
  })
})

describe('connectionsMenu', () => {
  it('opens each coupled instance onto a panel of its couplings, both opening their connection', () => {
    const open = vi.fn()
    const menu = connectionsMenu('nka', nodes, edges, open)
    expect(menu.label).toBe('Connections')
    expect(menu.items.map((item) => item.label)).toEqual(['capillary (1)', 'epithelial (1)'])
    const [panel] = menu.items[1].items
    expect(panel.connection).toMatchObject({ ownName: 'NKA', id: 'cell', name: 'epithelial' })
    expect(panel.connection.couplings.map((coupling) => coupling.mine.name)).toEqual(['c_Na_i'])
    panel.command()
    menu.items[1].command()
    expect(open.mock.calls).toEqual([['cell--nka'], ['cell--nka']])
  })

  it('says when there are no connections', () => {
    expect(connectionsMenu('lone', nodes, edges).items).toEqual([{ label: 'No connections', disabled: true }])
  })
})

describe('BioConnectionPanel', () => {
  it('draws the couplings in the edge dialog’s side chips, this instance’s on the left', () => {
    const [, connection] = connectionsMenu('nka', nodes, edges).items
    const wrapper = mount(BioConnectionPanel, { props: { connection: connection.items[0].connection } })
    const chips = wrapper.findAll('.node-side-chip')
    expect(chips.map((chip) => chip.text())).toEqual(['NKA', 'epithelial', 'c_Na_i', 'c_Na'])
    expect(chips.map((chip) => chip.classes().includes('node-side-chip--source'))).toEqual([true, false, true, false])
    expect(wrapper.find('.bio-connection-panel__arrow[title="Into this instance"]').text()).toBe('←')
    expect(wrapper.findAll('.bio-connection-panel__annotation')).toHaveLength(2)
  })
})
