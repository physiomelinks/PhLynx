import { Position } from '@vue-flow/core'
import { describe, expect, it } from 'vitest'

import {
  CELL_INSET,
  FACET_LABEL_OFFSET,
  DEPENDENCE_END,
  TOKEN,
  arrangeRow,
  arrowHead,
  ARROW_SPACING,
  legArrows,
  arrowOffset,
  cellHintAt,
  chipOrder,
  driftSpecies,
  cellNameBox,
  facetLabelBoxes,
  proteinBoxes,
  layoutSpecies,
  obstaclesOf,
  placeSpeciesTokens,
  placeTokens,
  spreadAlong,
  tokenWidth,
} from '../../../../src/services/bioView/speciesLayout.js'
import { BUILT_IN_TEMPLATES } from '../../../../src/services/bioView/builtInTemplates.js'
import { layoutPhysiology } from '../../../../src/services/bioView/layout.js'

// A cell with a lumen above it and a protein in its top membrane, carrying Na⁺ from the lumen into the cell.
const layout = new Map([
  ['cell', { kind: 'cell', rect: { x: 0, y: 200, width: 600, height: 400 } }],
  ['lumen', { kind: 'region', rect: { x: -100, y: 60, width: 800, height: 140 } }],
  ['porter', { kind: 'protein', cell: 'cell', x: 300, y: 200, outward: Position.Top }],
])
const token = (species, label) => ({ species, label })
const network = {
  compartments: new Map([
    ['lumen', [token('Na', 'Na⁺')]],
    ['cell', [token('Na', 'Na⁺'), token('K', 'K⁺')]],
  ]),
  links: [
    { protein: 'porter', compartment: 'lumen', species: 'Na', side: 'outside' },
    { protein: 'porter', compartment: 'cell', species: 'Na', side: 'inside' },
  ],
  paths: [{ protein: 'porter', species: 'Na', label: 'Na⁺', outside: 'lumen', inside: 'cell' }],
}

describe('spreading tokens along a line', () => {
  it('keeps them where they want to be when they don’t overlap', () => {
    expect(spreadAlong([{ want: 0, size: 10 }, { want: 100, size: 10 }], 8, [-1000, 1000])).toEqual([0, 100])
  })

  it('pushes overlapping ones apart, about where they wanted to be', () => {
    const [a, b] = spreadAlong([{ want: 50, size: 40 }, { want: 50, size: 40 }], 8, [-1000, 1000])
    expect(b - a).toBe(48)
    expect((a + b) / 2).toBe(50)
  })

  it('keeps a run within its bounds when it fits', () => {
    const centres = spreadAlong([{ want: 0, size: 40 }, { want: 0, size: 40 }], 8, [0, 200])
    expect(Math.min(...centres) - 20).toBeGreaterThanOrEqual(0)
  })
})

describe('where species mode draws its network', () => {
  it('puts a region’s tokens towards its edge away from the cell, under the protein they are coupled to', () => {
    const { tokens } = layoutSpecies(network, layout)
    const lumen = tokens.find((t) => t.nodeId === 'lumen')
    expect(lumen).toMatchObject({ key: 'lumen::Na', label: 'Na⁺', x: 300, height: TOKEN.height })
    expect(lumen.width).toBe(tokenWidth('Na⁺'))
    expect(lumen.y).toBeLessThan(60 + 70)
  })

  it('puts a cell’s tokens in a row across it, apart', () => {
    const { tokens } = layoutSpecies(network, layout)
    const [na, k] = ['Na', 'K'].map((species) => tokens.find((t) => t.nodeId === 'cell' && t.species === species))
    expect(na.y).toBe(k.y)
    expect(na.y).toBeGreaterThan(200)
    expect(Math.abs(na.x - k.x)).toBeGreaterThanOrEqual((na.width + k.width) / 2)
  })

  it('centres a cell’s row vertically in it while nothing is in the way', () => {
    const { tokens } = layoutSpecies(network, layout)
    for (const t of tokens.filter((t) => t.nodeId === 'cell')) expect(t.y).toBe(400)
  })

  it('runs a path from the outside token to the protein’s outer face, and from its inner face to the inside token', () => {
    const { paths } = layoutSpecies(network, layout)
    expect(paths).toHaveLength(1)
    const [path] = paths
    expect(path.direction).toBeNull()
    // The cartoon is 48 high, so its outer face is at y 176 and its inner one at 224.
    expect(path.legs.outside).toMatch(/176$/)
    expect(path.legs.inside).toMatch(/^M300,224 /)
  })

  it('points the legs the way the species went, and widens the largest flow', () => {
    const paths = layoutSpecies(network, layout, { flowOf: () => ({ direction: 'out', size: 2 }) }).paths
    expect(paths[0].direction).toBe('out')
    expect(paths[0].width).toBe(5)
    // Going out: from the inner face's token to the face, and from the outer face to its token.
    expect(paths[0].legs.inside).toMatch(/^M\S+ C/)
    expect(paths[0].legs.outside).toMatch(/^M300,176 /)
  })

  it('sizes the arrowheads to the width, and runs each leg right to its end', () => {
    const placed = layoutSpecies(network, layout, { flowOf: () => ({ direction: 'out', size: 2 }) })
    const [moving] = placed.paths
    expect(moving.head).toBe(arrowHead(5))
    expect(arrowHead(5)).toBeGreaterThan(arrowHead(1.5))
    expect(arrowHead(1.5)).toBeGreaterThan(2 * 1.5)
    // The inside leg comes up to the inner face at y 224, heading straight on.
    const end = (d) => d.match(/(-?[\d.]+),(-?[\d.]+)$/).slice(1).map(Number)
    const control = (d) => d.match(/ (-?[\d.]+),(-?[\d.]+) -?[\d.]+,-?[\d.]+$/).slice(1).map(Number)
    expect(end(moving.legs.inside)).toEqual([300, 224])
    expect(control(moving.legs.inside)[0]).toBe(300)
    expect(control(moving.legs.inside)[1]).toBeGreaterThan(224)
    // The outside leg reaches the lumen's token.
    const lumen = placed.tokens.find((t) => t.nodeId === 'lumen')
    const [x, y] = end(moving.legs.outside)
    expect(x).toBe(lumen.x)
    expect(y).toBeCloseTo(lumen.y + lumen.height / 2, 1)
    // Without a direction there is no head, and the legs reach the faces.
    const [still] = layoutSpecies(network, layout).paths
    expect(still.head).toBe(0)
    expect(end(still.legs.outside)).toEqual([300, 176])
  })

  it('spaces the arrowheads along a leg evenly, about ARROW_SPACING apart', () => {
    expect(legArrows('M0,0 C0,50 0,100 0,150')).toEqual({ count: 2, gap: 75 })
    expect(legArrows('M0,0 C0,10 0,20 0,30')).toEqual({ count: 1, gap: 30 })
    expect(legArrows('M0,0 C0,0 0,0 0,0').count).toBe(0)
    expect(legArrows('nonsense').count).toBe(0)
    expect(legArrows('M0,0 C0,100 0,200 0,320').count).toBe(320 / ARROW_SPACING)
  })

  it('attaches each species’ path under its own arrow on the cartoon, in the order the arrows show', () => {
    const both = {
      ...network,
      compartments: new Map([
        ['lumen', [token('Na', 'Na⁺'), token('Glc', 'glucose')]],
        ['cell', [token('Na', 'Na⁺'), token('Glc', 'glucose')]],
      ]),
      paths: ['Na', 'Glc'].map((species) => ({ protein: 'porter', species, label: species, outside: 'lumen', inside: 'cell' })),
    }
    const arrows = { species: ['Glc', 'Na'], room: { left: 18, right: 46 } }
    const start = (d) => d.match(/^M(-?[\d.]+),(-?[\d.]+)/).slice(1).map(Number)
    const end = (d) => d.match(/(-?[\d.]+),(-?[\d.]+)$/).slice(1).map(Number)
    const legsOf = (place) => {
      const { paths } = layoutSpecies(both, new Map([...layout, ['porter', { ...layout.get('porter'), ...place }]]), {
        arrowsOf: (id) => (id === 'porter' ? arrows : undefined),
      })
      return Object.fromEntries(paths.map((path) => [path.species, path.legs]))
    }
    // Upright: glucose under the left arrow, 14 left of the middle, Na⁺ under the right one, on both faces.
    const upright = legsOf({})
    expect(end(upright.Glc.outside)).toEqual([286, 176])
    expect(end(upright.Na.outside)).toEqual([314, 176])
    expect(start(upright.Glc.inside)).toEqual([286, 224])
    expect(start(upright.Na.inside)).toEqual([314, 224])
    // Upside down in a bottom membrane, the cartoon shows them the other way round, and so do the paths.
    const turned = legsOf({ y: 600, outward: Position.Bottom })
    expect(end(turned.Glc.outside)[0]).toBe(314)
    expect(end(turned.Na.outside)[0]).toBe(286)
  })

  it('attaches a species with no arrow, or a protein’s only one, at the middle of its face', () => {
    expect(arrowOffset(undefined, 'Na')).toBe(0)
    expect(arrowOffset({ species: ['K'] }, 'Na')).toBe(0)
    expect(arrowOffset({ species: ['Na'], room: { left: 18, right: 46 } }, 'Na')).toBe(0)
    expect(arrowOffset({ species: ['Na', 'K', 'Cl'], room: { left: 18, right: 46 } }, 'Cl')).toBe(14)
  })

  it('draws a dependence from its token to the protein’s face on its side, ending in an open circle there', () => {
    const reads = {
      ...network,
      compartments: new Map([
        ['lumen', [token('Na', 'Na⁺')]],
        ['cell', [token('ATP', 'ATP'), token('ADP', 'ADP')]],
      ]),
      paths: [],
      dependences: [
        { protein: 'porter', compartment: 'lumen', species: 'Na', side: 'outside' },
        { protein: 'porter', compartment: 'cell', species: 'ATP', side: 'inside' },
        { protein: 'porter', compartment: 'cell', species: 'ADP', side: null },
        { protein: 'porter', compartment: 'nowhere', species: 'Na', side: 'outside' },
      ],
    }
    const { dependences, tokens } = layoutSpecies(reads, layout)
    expect(dependences.map((d) => d.key)).toEqual(['porter::Na::lumen', 'porter::ATP::cell', 'porter::ADP::cell'])
    const [na, atp, adp] = dependences
    // The lumen's: from its token down to the outer face at y 176, stopping at the circle just outside it.
    const lumen = tokens.find((t) => t.nodeId === 'lumen')
    expect(na.d).toMatch(new RegExp(`^M${lumen.x},${lumen.y + lumen.height / 2} `))
    expect(na.d).toMatch(new RegExp(`300,${176 - 2 * DEPENDENCE_END}$`))
    expect(na.end).toEqual({ x: 300, y: 176 - DEPENDENCE_END, r: DEPENDENCE_END })
    // The cell's two go to the inner face, spread across it in the order of their tokens, apart.
    for (const d of [atp, adp]) expect(d.end.y).toBe(224 + DEPENDENCE_END)
    const [atpToken, adpToken] = ['ATP', 'ADP'].map((s) => tokens.find((t) => t.species === s))
    expect(Math.sign(atp.end.x - adp.end.x)).toBe(Math.sign(atpToken.x - adpToken.x))
    expect(Math.abs(atp.end.x - adp.end.x)).toBe(28)
  })

  it('ends a dependence under its species’ arrow where the cartoon has one', () => {
    const reads = { ...network, paths: [], dependences: [{ protein: 'porter', compartment: 'lumen', species: 'Na', side: 'outside' }] }
    const arrowsOf = () => ({ species: ['K', 'Na'], room: { left: 18, right: 46 } })
    expect(layoutSpecies(reads, layout, { arrowsOf }).dependences[0].end.x).toBe(314)
  })

  it('draws no path for a protein not in a membrane', () => {
    const tray = new Map([...layout, ['porter', { kind: 'tray', x: 0, y: 0 }]])
    expect(layoutSpecies(network, tray).paths).toEqual([])
  })
})

// An epithelial cell: GLUT2 and SGLT1 in its apical (top) membrane, GLUT2, Kir and NKA in its basolateral (bottom) one,
// and seven species, four of them coupled to no protein.
const protein = (x, y, outward) => ({ kind: 'protein', cell: 'cell', x, y, outward })
const epithelialCell = (width = 440) =>
  new Map([
    ['cell', { kind: 'cell', rect: { x: 0, y: 0, width, height: 240 } }],
    ['glut2api', protein(width * 0.36, 0, Position.Top)],
    ['sglt1', protein(width * 0.56, 0, Position.Top)],
    ['glut2bas', protein(width * 0.26, 240, Position.Bottom)],
    ['kir', protein(width * 0.46, 240, Position.Bottom)],
    ['nka', protein(width * 0.66, 240, Position.Bottom)],
  ])
const species = [
  ['Glc', 'D-glucose', ['glut2api', 'glut2bas']],
  ['K', 'K⁺', ['kir', 'nka']],
  ['Na', 'Na⁺', ['sglt1', 'nka']],
  ['ATP', 'ATP', []],
  ['ADP', 'ADP', []],
  ['Pi', 'Pi', []],
  ['H', 'H⁺', []],
]
const cellNetwork = (order = species) => ({
  compartments: new Map([['cell', order.map(([id, label]) => token(id, label))]]),
  links: [
    ...order.flatMap(([id, , proteins]) => proteins.map((p) => ({ protein: p, compartment: 'cell', species: id }))),
    // ATP and ADP are coupled to the pump, but no path is drawn for them.
    ...['ATP', 'ADP'].map((id) => ({ protein: 'nka', compartment: 'cell', species: id })),
  ],
  paths: order.flatMap(([id, , proteins]) =>
    proteins.map((p) => ({ protein: p, species: id, outside: 'outside', inside: 'cell' }))
  ),
})
const labelOf = (id) => ({ name: id === 'cell' ? 'epithelial' : id, detail: id === 'cell' ? '' : 'D-glucose · Na⁺' })
const boxOf = (t) => ({ x: t.x - t.width / 2, y: t.y - t.height / 2, width: t.width, height: t.height })
const hits = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

describe('placing a cell’s name', () => {
  it('puts it in the upper-left corner, inside the membrane and clear of the proteins', () => {
    const cell = epithelialCell(600)
    const name = cellNameBox('cell', cell, labelOf)
    expect(name.x).toBeLessThan(600 * 0.3)
    expect(name.y).toBeLessThan(240 * 0.3)
    expect(name.x).toBeGreaterThanOrEqual(CELL_INSET)
    expect(name.y).toBeGreaterThanOrEqual(CELL_INSET)
    const proteins = obstaclesOf('cell', cell, labelOf).filter((o) => o !== name && !hits(o, name))
    expect(obstaclesOf('cell', cell, labelOf).length - proteins.length).toBe(1)
  })

  it('falls back to the lower-left when an apical protein’s name takes the upper-left', () => {
    const cell = epithelialCell(600)
    cell.set('corner', protein(70, 0, Position.Top))
    const name = cellNameBox('cell', cell, labelOf)
    expect(name.y + name.height).toBeGreaterThan(240 * 0.7)
    expect(name.x).toBeLessThan(600 * 0.3)
  })
})

describe('placing an empty cell’s hint', () => {
  const emptyCell = (extra = []) =>
    new Map([
      ['tpl:t/cell', { kind: 'cell', rect: { x: 100, y: 50, width: 320, height: 240 }, hintAt: { x: 160, y: 140 }, zones: [] }],
      ...extra,
    ])
  const named = (id) => ({ name: id === 'tpl:t/cell' ? 'Cell' : 'Sodium_glucose_cotransporter', detail: 'D-glucose · Na⁺' })
  const hintBox = (at) => ({ x: 100 + at.x - 49, y: 50 + at.y - 18, width: 98, height: 36 })

  it('keeps it where the layout put it while nothing is in the way', () => {
    expect(cellHintAt('tpl:t/cell', emptyCell(), named)).toEqual({ x: 160, y: 140 })
    expect(cellHintAt('nope', emptyCell(), named)).toBeNull()
  })

  it('moves it clear of a protein’s name, staying inside, past the facets’ bands', () => {
    const side = { kind: 'protein', cell: 'tpl:t/cell', x: 100, y: 190, outward: Position.Left }
    const layout = emptyCell([['p', side]])
    const label = proteinBoxes(side, named('p'))[1]
    expect(hits(hintBox({ x: 160, y: 140 }), label)).toBe(true)
    const at = cellHintAt('tpl:t/cell', layout, named)
    expect(hits(hintBox(at), label)).toBe(false)
    expect(at.x - 49).toBeGreaterThanOrEqual(40)
    expect(at.x + 49).toBeLessThanOrEqual(320 - 40)
    expect(at.y + 18).toBeLessThanOrEqual(240 - 40)
  })

  it('finds room below the process area of an epithelial cell with a two-line name on each membrane', () => {
    const porter = (id, site) => ({ id, data: { name: id, bioView: { role: 'membraneProtein', site } } })
    const nodes = [porter('porter', 'bt-1/cell.apical'), porter('porter_1', 'bt-1/cell.basolateral')]
    const { places } = layoutPhysiology(nodes, new Map(nodes.map((n) => [n.id, { role: 'membraneProtein' }])), {
      instances: [{ id: 'bt-1', template: 'epithelial-cell', at: { x: 0, y: 0 } }],
      definitions: new Map(BUILT_IN_TEMPLATES.map((template) => [template.id, template])),
    })
    const labelOf = (id) => (places.get(id)?.kind === 'protein' ? { name: id, detail: 'Na⁺' } : { name: 'Epithelial cell' })
    const id = 'tpl:bt-1/cell'
    const { rect, zones } = places.get(id)
    const at = cellHintAt(id, places, labelOf)
    const hint = { x: rect.x + at.x - 71, y: rect.y + at.y - 18, width: 142, height: 36 }
    const names = nodes.map((n) => proteinBoxes(places.get(n.id), labelOf(n.id))[1])
    expect(names.some((name) => hits(hint, name))).toBe(false)
    expect(hint.y).toBeGreaterThanOrEqual(zones[0].rect.y + zones[0].rect.height - 4)
  })
})

describe('placing a cell’s tokens around what else is in it', () => {
  it('sits the row evenly in the cell, inside the membrane, clear of names and of each other', () => {
    const cell = epithelialCell()
    const { tokens } = layoutSpecies(cellNetwork(), cell, { labelOf })
    const boxes = tokens.map(boxOf)
    const left = Math.min(...boxes.map((b) => b.x))
    const right = 440 - Math.max(...boxes.map((b) => b.x + b.width))
    expect(Math.abs(left - right)).toBeLessThanOrEqual(24)
    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(CELL_INSET)
      expect(b.y).toBeGreaterThanOrEqual(CELL_INSET)
      expect(b.x + b.width).toBeLessThanOrEqual(440 - CELL_INSET)
      expect(b.y + b.height).toBeLessThanOrEqual(240 - CELL_INSET)
    }
    boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => expect(hits(a, b)).toBe(false)))
    const obstacles = obstaclesOf('cell', cell, labelOf)
    expect(obstacles.length).toBe(11)
    for (const b of boxes) for (const o of obstacles) expect(hits(b, o)).toBe(false)
  })

  it('keeps coupled tokens in the order of their proteins, and the rest in label order', () => {
    const { tokens } = layoutSpecies(cellNetwork(), epithelialCell(), { labelOf })
    const order = [...tokens].sort((a, b) => a.x - b.x).map((t) => t.species)
    expect(order.filter((id) => ['Glc', 'K', 'Na'].includes(id))).toEqual(['Glc', 'K', 'Na'])
    expect(order.filter((id) => ['ADP', 'ATP', 'H', 'Pi'].includes(id))).toEqual(['ADP', 'ATP', 'H', 'Pi'])
  })

  it('lines a token up with a protein only when a path is drawn to it', () => {
    const { tokens } = layoutSpecies(cellNetwork(), epithelialCell(260), { labelOf })
    const rows = [...new Set(tokens.map((t) => t.y))]
    for (const row of rows) {
      const boxes = tokens.filter((t) => t.y === row).map(boxOf)
      const left = Math.min(...boxes.map((b) => b.x))
      const right = 260 - Math.max(...boxes.map((b) => b.x + b.width))
      if (boxes.length > 1) expect(Math.abs(left - right)).toBeLessThanOrEqual(40)
    }
  })

  it('places the same however the species are listed', () => {
    const at = (order) =>
      Object.fromEntries(
        layoutSpecies(cellNetwork(order), epithelialCell(), { labelOf }).tokens.map((t) => [t.key, [t.x, t.y]])
      )
    expect(at([...species].reverse())).toEqual(at(species))
    expect(at(species)).toEqual(at(species))
  })

  it('places tokens that want the same spot the same way round however they are listed', () => {
    const pumped = [
      ['Na', 'Na⁺', ['nka']],
      ['K', 'K⁺', ['nka']],
    ]
    const at = (order) =>
      Object.fromEntries(
        layoutSpecies(cellNetwork(order), epithelialCell(), { labelOf }).tokens.map((t) => [t.key, [t.x, t.y]])
      )
    expect(at([...pumped].reverse())).toEqual(at(pumped))
  })

  it('wraps onto more rows in a cell too narrow for one, still clear of the membrane and of each other', () => {
    const cell = epithelialCell(260)
    const { tokens } = layoutSpecies(cellNetwork(), cell, { labelOf })
    const rows = [...new Set(tokens.map((t) => t.y))].sort((a, b) => a - b)
    expect(rows.length).toBeGreaterThan(1)
    expect(rows[1] - rows[0]).toBeGreaterThanOrEqual(TOKEN.height + TOKEN.gap)
    const boxes = tokens.map(boxOf)
    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(CELL_INSET)
      expect(b.x + b.width).toBeLessThanOrEqual(260 - CELL_INSET)
    }
    boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => expect(hits(a, b)).toBe(false)))
  })

  it('moves the row off its usual line when something is drawn there', () => {
    const item = { index: 0, label: 'Na⁺', size: 40, cross: TOKEN.height, want: 100, crossAt: null }
    const inner = { x: 0, y: 0, width: 200, height: 200 }
    const free = placeTokens([item], { inner, across: true, line: 100 })
    expect(free[0]).toEqual({ x: 100, y: 100 })
    const obstacles = [{ x: 0, y: 90, width: 200, height: 20 }]
    const [moved] = placeTokens([item], { inner, across: true, line: 100, obstacles })
    expect(moved.x).toBe(100)
    expect(Math.abs(moved.y - 100)).toBeGreaterThanOrEqual(10 + TOKEN.height / 2)
    expect(Math.abs(moved.y - 100)).toBeLessThanOrEqual(10 + TOKEN.height / 2 + 8 + 2)
  })

  it('splits uncoupled tokens between the ends of a row to even out the space either side', () => {
    const items = [
      { index: 0, label: 'X', size: 40, want: 50 },
      { index: 1, label: 'A', size: 40, want: null },
      { index: 2, label: 'B', size: 40, want: null },
    ]
    const centres = arrangeRow(items, [0, 400], 8)
    expect(centres[0]).toBe(50)
    expect(centres[1]).toBeGreaterThan(50)
    expect(centres[2] - centres[1]).toBe(48)
  })

  it('keeps a region’s coupled token under its protein, along its far edge, with others beside it', () => {
    const lumen = [token('Na', 'Na⁺'), token('K', 'K⁺'), token('Cl', 'Cl⁻')]
    const crowded = { ...network, compartments: new Map([['lumen', lumen]]) }
    const { tokens } = layoutSpecies(crowded, layout)
    const na = tokens.find((t) => t.species === 'Na')
    expect(na.x).toBe(300)
    expect(new Set(tokens.map((t) => t.y)).size).toBe(1)
    expect(na.y).toBeLessThan(60 + 70)
  })

  it('runs a side region’s tokens down it, along its far edge', () => {
    const side = new Map([
      ['cell', { kind: 'cell', rect: { x: 200, y: 0, width: 400, height: 400 } }],
      ['space', { kind: 'region', rect: { x: 40, y: 0, width: 140, height: 400 } }],
      ['porter', { kind: 'protein', cell: 'cell', x: 200, y: 150, outward: Position.Left }],
    ])
    const net = {
      compartments: new Map([['space', [token('Na', 'Na⁺'), token('K', 'K⁺'), token('Cl', 'Cl⁻')]]]),
      links: [{ protein: 'porter', compartment: 'space', species: 'Na' }],
      paths: [{ protein: 'porter', species: 'Na', outside: 'space', inside: 'cell' }],
    }
    const { tokens } = layoutSpecies(net, side)
    expect(new Set(tokens.map((t) => t.x)).size).toBe(1)
    expect(tokens[0].x).toBeLessThan(40 + 70)
    expect(tokens.find((t) => t.species === 'Na').y).toBe(150)
  })
})

describe('a compartment’s own order of its tokens', () => {
  const readingOrder = (tokens) =>
    [...tokens].sort((a, b) => Math.round(a.y) - Math.round(b.y) || a.x - b.x).map((t) => t.species)

  it('fills the places worked out for its tokens in the order given, the rest after by label', () => {
    const cell = epithelialCell()
    const auto = layoutSpecies(cellNetwork(), cell, { labelOf }).tokens
    const order = ['Pi', 'Na', 'ATP']
    const { tokens } = layoutSpecies(cellNetwork(), cell, { labelOf, orderOf: (id) => id === 'cell' && order })
    expect(readingOrder(tokens)).toEqual(['Pi', 'Na', 'ATP', 'ADP', 'Glc', 'H', 'K'])
    // About where the automatic layout had them, on the same row, apart and inside the membrane.
    expect(new Set(tokens.map((t) => t.y))).toEqual(new Set(auto.map((t) => t.y)))
    const boxes = tokens.map(boxOf)
    boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => expect(hits(a, b)).toBe(false)))
    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(CELL_INSET)
      expect(b.x + b.width).toBeLessThanOrEqual(440 - CELL_INSET)
    }
  })

  it('keeps each row as many tokens as before when they wrap', () => {
    const cell = epithelialCell(260)
    const auto = layoutSpecies(cellNetwork(), cell, { labelOf }).tokens
    const reversed = readingOrder(auto).reverse()
    const { tokens } = layoutSpecies(cellNetwork(), cell, { labelOf, orderOf: () => reversed })
    expect(readingOrder(tokens)).toEqual(reversed)
    const perRow = (list) =>
      [...new Set(list.map((t) => t.y))].sort((a, b) => a - b).map((y) => list.filter((t) => t.y === y).length)
    expect(perRow(tokens)).toEqual(perRow(auto))
  })

  it('places only the compartment asked for, as it would among the rest', () => {
    const cell = epithelialCell()
    const order = ['Pi', 'Na', 'ATP']
    const orderOf = (id) => id === 'cell' && order
    const all = placeSpeciesTokens(cellNetwork(), cell, { labelOf, orderOf })
    const only = placeSpeciesTokens(cellNetwork(), cell, { labelOf, orderOf, only: 'cell' })
    expect(only).toEqual(all.filter((t) => t.nodeId === 'cell'))
    expect(placeSpeciesTokens(cellNetwork(), cell, { labelOf, only: 'nowhere' })).toEqual([])
  })

  it('places as worked out without an order', () => {
    const at = (orderOf) =>
      layoutSpecies(cellNetwork(), epithelialCell(), { labelOf, orderOf }).tokens.map((t) => [t.key, t.x, t.y])
    expect(at(() => [])).toEqual(at(undefined))
  })

  it('gives each token the row it can be dragged along, inside its compartment', () => {
    const tokens = placeSpeciesTokens(network, layout)
    const cellToken = tokens.find((t) => t.nodeId === 'cell')
    expect(cellToken.row).toEqual({ axis: 'x', low: CELL_INSET, high: 600 - CELL_INSET })
  })

  it('reads the order a token dragged along its row leaves', () => {
    const { tokens } = layoutSpecies(cellNetwork(), epithelialCell(), { labelOf })
    const before = readingOrder(tokens)
    const [first, second] = before.map((id) => tokens.find((t) => t.species === id))
    expect(chipOrder(tokens, first.key)).toEqual(before)
    expect(chipOrder(tokens, first.key, second.x + 1)).toEqual([second.species, first.species, ...before.slice(2)])
    expect(chipOrder(tokens, 'nowhere::X', 0)).toBeNull()
    // Only its own compartment's tokens.
    const lumen = placeSpeciesTokens(network, layout)
    expect(chipOrder(lumen, 'lumen::Na', 0)).toEqual(['Na'])
  })

  it('moves the dependences’ attachment points along a protein’s face with the order of their tokens', () => {
    const reads = {
      ...network,
      compartments: new Map([['cell', [token('ATP', 'ATP'), token('ADP', 'ADP')]]]),
      paths: [],
      dependences: [
        { protein: 'porter', compartment: 'cell', species: 'ATP', side: 'inside' },
        { protein: 'porter', compartment: 'cell', species: 'ADP', side: 'inside' },
      ],
    }
    const ends = (order) => {
      const { dependences, tokens } = layoutSpecies(reads, layout, { orderOf: () => order })
      const along = dependences.map((d) => [d.species, d.end.x]).sort((a, b) => a[1] - b[1])
      return { tokens: readingOrder(tokens), ends: along }
    }
    const one = ends(['ATP', 'ADP'])
    const other = ends(['ADP', 'ATP'])
    expect(one.tokens).toEqual(['ATP', 'ADP'])
    expect(other.tokens).toEqual(['ADP', 'ATP'])
    expect(one.ends.map(([id]) => id)).toEqual(['ATP', 'ADP'])
    expect(other.ends.map(([id]) => id)).toEqual(['ADP', 'ATP'])
  })
})

describe('placing a template cell’s facet names', () => {
  const porter = (id, site) => ({ id, data: { name: id, bioView: { role: 'membraneProtein', site } } })
  const draw = (nodes) =>
    layoutPhysiology(nodes, new Map(nodes.map((n) => [n.id, { role: 'membraneProtein' }])), {
      instances: [{ id: 'bt-1', template: 'epithelial-cell', at: { x: 0, y: 0 } }],
      definitions: new Map(BUILT_IN_TEMPLATES.map((template) => [template.id, template])),
    }).places
  const named = (places) => (id) =>
    places.get(id)?.kind === 'protein' ? { name: id, detail: 'Na⁺' } : { name: places.get(id)?.label ?? id }
  const id = 'tpl:bt-1/cell'
  const onCanvas = (rect, label) => ({ ...label, x: rect.x + label.x, y: rect.y + label.y })

  it('puts each name just outside its edge, clear of the proteins’ cartoons and names', () => {
    const nodes = [porter('porter', 'bt-1/cell.apical'), porter('porter_1', 'bt-1/cell.basolateral')]
    const places = draw(nodes)
    const labelOf = named(places)
    const { rect } = places.get(id)
    const labels = facetLabelBoxes(id, places, labelOf).map((label) => onCanvas(rect, label))
    expect(labels.map((label) => label.edge)).toEqual(['top', 'bottom', 'left', 'right'])
    const proteins = nodes.flatMap((n) => proteinBoxes(places.get(n.id), labelOf(n.id)))
    for (const label of labels) expect(proteins.some((p) => hits(label, p)), label.label).toBe(false)
    const [top, bottom, left, right] = labels
    expect(rect.y - (top.y + top.height)).toBe(FACET_LABEL_OFFSET)
    expect(bottom.y - (rect.y + rect.height)).toBe(FACET_LABEL_OFFSET)
    expect(rect.x - (left.x + left.width)).toBe(FACET_LABEL_OFFSET)
    expect(right.x - (rect.x + rect.width)).toBe(FACET_LABEL_OFFSET)
    // Moved along its edge beside the protein, past a corner at most.
    for (const label of [top, bottom]) {
      expect(label.x).toBeGreaterThanOrEqual(rect.x - 40)
      expect(label.x + label.width).toBeLessThanOrEqual(rect.x + rect.width + 40)
    }
    // Nothing drawn inside the cell is in the way: its name, and the inside's cards and tokens.
    const name = cellNameBox(id, places, labelOf)
    for (const label of labels) expect(hits(label, name)).toBe(false)
  })

  it('stays in the middle of its edge while nothing is there, and keeps clear of each other', () => {
    const places = draw([])
    const { rect } = places.get(id)
    const labels = facetLabelBoxes(id, places, named(places))
    expect(labels[0].x + labels[0].width / 2).toBeCloseTo(rect.width / 2, 0)
    expect(labels[2].y + labels[2].height / 2).toBeCloseTo(rect.height / 2, 0)
    labels.forEach((a, i) => labels.slice(i + 1).forEach((b) => expect(hits(a, b)).toBe(false)))
  })

  it('is kept clear of by the tokens of the regions it lies in', () => {
    const places = draw([])
    const { rect } = places.get(id)
    const [top] = facetLabelBoxes(id, places, named(places))
    const obstacles = obstaclesOf('tpl:bt-1/apical-fluid', places, named(places))
    expect(obstacles).toContainEqual({ x: rect.x + top.x, y: rect.y + top.y, width: top.width, height: top.height })
  })

  it('has nothing to place on a cell with no facet names', () => {
    expect(facetLabelBoxes('cell', layout)).toEqual([])
    expect(facetLabelBoxes('nope', layout)).toEqual([])
  })
})

describe('species drawn while something is dragged', () => {
  const reads = {
    ...network,
    dependences: [{ protein: 'porter', compartment: 'lumen', species: 'Na', side: 'outside' }],
  }
  const relaid = (moved) =>
    new Map(
      [...layout].map(([id, place]) => {
        const shift = moved[id] ?? moved[place.cell]
        if (!shift) return [id, place]
        if (place.rect) return [id, { ...place, rect: { ...place.rect, x: place.rect.x + shift.x, y: place.rect.y + shift.y } }]
        return [id, { ...place, x: place.x + shift.x, y: place.y + shift.y }]
      })
    )

  it('gives back what was laid out while nothing moved', () => {
    const species = layoutSpecies(reads, layout)
    expect(driftSpecies(species, layout)).toBe(species)
    expect(driftSpecies(species, layout, { moved: new Map() })).toBe(species)
    expect(driftSpecies(null, layout, { moved: new Map([['cell', { x: 1, y: 1 }]]) })).toBeNull()
  })

  it('moves a cell’s tokens and the legs to its proteins with it, keeping what stayed', () => {
    const species = layoutSpecies(reads, layout)
    const shift = { x: 40, y: 30 }
    const drawn = driftSpecies(species, layout, { moved: new Map([['cell', shift]]) })
    const cellToken = drawn.tokens.find((t) => t.key === 'cell::Na')
    expect(cellToken.offset).toEqual(shift)
    // Laid out where it was; only translated.
    expect(cellToken.x).toBe(species.tokens.find((t) => t.key === 'cell::Na').x)
    const lumenToken = drawn.tokens.find((t) => t.key === 'lumen::Na')
    expect(lumenToken).toBe(species.tokens.find((t) => t.key === 'lumen::Na'))
    // Both legs end at the protein, which moved with its cell: each is what a layout with the cell there draws.
    const after = layoutSpecies(reads, relaid({ cell: shift }), { orderOf: () => undefined })
    expect(drawn.paths[0].legs.inside).toBe(after.paths[0].legs.inside)
    expect(drawn.dependences[0].end).toEqual(after.dependences[0].end)
  })

  it('moves the legs whole when the compartments at both ends move together', () => {
    const species = layoutSpecies(reads, layout)
    const shift = { x: -25, y: 10 }
    const drawn = driftSpecies(species, layout, { moved: new Map([['cell', shift], ['lumen', shift]]) })
    const after = layoutSpecies(reads, relaid({ cell: shift, lumen: shift }))
    expect(drawn.paths[0].legs).toEqual(after.paths[0].legs)
    expect(drawn.dependences[0].d).toBe(after.dependences[0].d)
  })

  it('draws a token put somewhere of its own there, and only its legs again', () => {
    const species = layoutSpecies(reads, layout)
    const lumen = species.tokens.find((t) => t.key === 'lumen::Na')
    const drawn = driftSpecies(species, layout, { placed: new Map([['lumen::Na', { x: lumen.x + 60, y: lumen.y }]]) })
    expect(drawn.tokens.find((t) => t.key === 'lumen::Na').offset).toEqual({ x: 60, y: 0 })
    expect(drawn.paths[0].legs.inside).toBe(species.paths[0].legs.inside)
    expect(drawn.paths[0].legs.outside).not.toBe(species.paths[0].legs.outside)
    expect(drawn.paths[0].legs.outside.startsWith(`M${lumen.x + 60},`)).toBe(true)
    // Its dependence's circle stays at the protein.
    expect(drawn.dependences[0].end).toEqual(species.dependences[0].end)
  })
})
