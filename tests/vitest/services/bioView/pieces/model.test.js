import { describe, expect, it } from 'vitest'

import { validatePieces, validatePiecesTemplate } from '../../../../../src/services/bioView/pieces/model.js'
import { topologyOf } from '../../../../../src/services/bioView/pieces/topology.js'
import { CARDIOMYOCYTE, ROD } from '../../../fixtures/pieces.js'

const cell = (extra = {}) => [
  { id: 'cell', kind: 'compartment', label: 'Cell' },
  {
    id: 'membrane-1',
    kind: 'membrane',
    label: 'Plasma membrane',
    encloses: ['cell'],
    ...extra,
  },
]

/** The errors validating some pieces gives. */
const errorsOf = (raw) => validatePieces(raw).errors

describe('validatePieces', () => {
  it('reads the built-in templates written as pieces', () => {
    for (const raw of [CARDIOMYOCYTE, ROD]) expect(validatePieces(raw)).toMatchObject({ errors: [], warnings: [] })
  })

  it('fills in what pieces leave out', () => {
    const { pieces } = validatePieces([
      ...cell(),
      {
        id: 'fluid',
        kind: 'compartment',
        label: 'Fluid',
        docks: [{ on: 'membrane-1', side: 'top', face: 'outside' }],
      },
      {
        id: 'fold',
        kind: 'fold',
        label: 'Fold',
        membrane: 'membrane-1',
        side: 'top',
      },
      { id: 'other', kind: 'compartment', label: 'Other' },
      { id: 'tube', kind: 'tube', label: 'Tube', ends: ['fluid', 'other'] },
    ])
    const [compartment, membrane, fluid, fold, , tube] = pieces
    expect(compartment.tone).toBe('sky')
    // A side it doesn't list is one span, named for the side.
    expect(membrane.sides.top).toEqual([{ id: 'top', label: 'Plasma membrane (top)', from: 0, to: 1 }])
    expect(Object.keys(membrane.sides)).toEqual(['top', 'right', 'bottom', 'left'])
    expect(fluid.docks).toEqual([{ on: 'membrane-1', side: 'top', face: 'outside', from: 0, to: 1 }])
    expect(fold.at).toBe(0.75)
    expect(tube.flux).toBe('flow')
  })

  it('gives each span the stretch from where the one before it ends', () => {
    const { pieces } = validatePieces(ROD)
    const membrane = pieces.find((piece) => piece.id === 'rod-membrane')
    expect(membrane.sides.top.map(({ id, from, to }) => [id, from, to])).toEqual([
      ['os-upper', 0, 0.5],
      ['is-upper', 0.5, 1],
    ])
  })

  it('freezes what it gives, so its topology is worked out once', () => {
    const { pieces } = validatePieces(CARDIOMYOCYTE)
    expect(Object.isFrozen(pieces)).toBe(true)
    expect(Object.isFrozen(pieces[1].sides.top[0])).toBe(true)
    expect(topologyOf(pieces)).toBe(topologyOf(pieces))
  })

  it('warns about keys it doesn’t know, and drops them', () => {
    const { pieces, warnings } = validatePieces([{ id: 'a', kind: 'compartment', label: 'A', colour: 'red' }])
    expect(warnings).toEqual(['Piece "a": unknown key "colour" was ignored.'])
    expect(pieces[0]).not.toHaveProperty('colour')
  })

  it('checks each piece’s own fields', () => {
    expect(errorsOf('nope')).toEqual(['"pieces" must be a list.'])
    expect(errorsOf([{ id: 'a', kind: 'cell', label: 'A' }])).toEqual([
      'Piece "a": "kind" must be one of compartment, membrane, tube, fold, zone, image.',
    ])
    expect(errorsOf([{ id: 'A', kind: 'compartment', label: 'A' }])[0]).toMatch(/"id" must start with a letter/)
    expect(errorsOf([{ id: 'a', kind: 'compartment' }])).toEqual(['Piece "a": "label" is required.'])
    expect(errorsOf([{ id: 'a', kind: 'compartment', label: 'A', tone: 'red' }])[0]).toMatch(/"tone" must be one of/)
    expect(errorsOf([{ id: 'a', kind: 'compartment', label: 'A', term: 'cytoplasm' }])[0]).toMatch(/"term" must be/)
    expect(
      errorsOf([
        {
          id: 'a',
          kind: 'compartment',
          label: 'A',
          frame: { x: 0, y: 0, width: 5, height: 50 },
        },
      ]),
    ).toEqual(['Piece "a": "frame.width" must be a number from 20 to 4000.'])
    expect(errorsOf([{ id: 'a', kind: 'compartment', label: 'A', site: 'no' }])).toEqual([
      'Piece "a": "site" must be true or false.',
    ])
    // A compartment, membrane or tube is its module, so always offers its site; a span, fold or zone may not.
    expect(errorsOf([{ id: 'a', kind: 'compartment', label: 'A', site: false }])).toEqual([
      'Piece "a": a compartment always offers its site.',
    ])
    expect(errorsOf([...cell(), { id: 'z', kind: 'zone', label: 'Z', compartment: 'cell', site: false }])).toEqual([])
    expect(errorsOf([{ id: 't', kind: 'tube', label: 'T', ends: ['a', 'a'] }])[0]).toMatch(
      /"ends" must name the two different/,
    )
    expect(
      errorsOf([
        ...cell(),
        {
          id: 'f',
          kind: 'fold',
          label: 'F',
          membrane: 'membrane-1',
          side: 'up',
          at: 2,
        },
      ]),
    ).toEqual([
      'Piece "f": "side" must be the side it dips in from: one of top, right, bottom, left.',
      'Piece "f": "at" must be a number from 0 to 1 along its side.',
    ])
  })

  it('checks a dock’s face and stretch', () => {
    const dock = (fields) => [
      ...cell(),
      {
        id: 'x',
        kind: 'compartment',
        label: 'X',
        docks: [{ on: 'membrane-1', side: 'top', ...fields }],
      },
    ]
    expect(errorsOf(dock({ face: 'over' }))).toEqual(['Piece "x", dock 1: "face" must be one of inside, outside.'])
    expect(errorsOf(dock({ face: 'outside', from: 0.6, to: 0.4 }))).toEqual([
      'Piece "x", dock 1: "from" and "to" must be numbers from 0 to 1, "from" before "to".',
    ])
  })

  it('checks that spans run along their side in order, the last to its end', () => {
    expect(
      errorsOf(
        cell({
          sides: {
            top: [
              { id: 'a', label: 'A', to: 0.5 },
              { id: 'b', label: 'B', to: 0.4 },
            ],
          },
        }),
      )[0],
    ).toMatch(/top span 2: "to" must be where it ends/)
    expect(
      errorsOf(
        cell({
          sides: {
            top: [
              { id: 'a', label: 'A' },
              { id: 'b', label: 'B' },
            ],
          },
        }),
      )[0],
    ).toMatch(/top span 1: "to"/)
    expect(errorsOf(cell({ sides: { top: [{ id: 'a', label: 'A', to: 0.5 }] } }))[0]).toMatch(/top span 1: "to"/)
    expect(errorsOf(cell({ sides: { top: [{ id: 'left', label: 'A' }] } }))).toEqual([
      'Piece "membrane-1": span "left" is named twice.',
    ])
    expect(errorsOf(cell({ sides: { top: [] } }))).toEqual([
      'Piece "membrane-1": "sides.top" must be a list of 1 to 8 spans.',
    ])
  })

  it('checks that what each piece names is there and of the right kind', () => {
    expect(
      errorsOf([
        { id: 'a', kind: 'compartment', label: 'A' },
        { id: 'a', kind: 'compartment', label: 'A again' },
      ]),
    ).toEqual(['Piece "a" is named twice.'])
    expect(errorsOf([{ id: 'z', kind: 'zone', label: 'Z', compartment: 'nowhere' }])).toEqual([
      'Piece "z": its compartment "nowhere" is not a compartment.',
    ])
    expect(
      errorsOf([
        ...cell(),
        {
          id: 'x',
          kind: 'compartment',
          label: 'X',
          docks: [{ on: 'membrane-1', face: 'outside' }],
        },
      ]),
    ).toEqual(['Piece "x": a dock to membrane "membrane-1" must say which "side".'])
    expect(
      errorsOf([
        { id: 'a', kind: 'compartment', label: 'A', parent: 'b' },
        { id: 'b', kind: 'compartment', label: 'B', parent: 'a' },
      ]),
    ).toEqual([
      'Compartment "a" stands, through others, in itself.',
      'Compartment "b" stands, through others, in itself.',
    ])
  })

  it('checks that a membrane encloses each compartment alone, and only compartments standing where it does', () => {
    expect(
      errorsOf([
        ...cell(),
        {
          id: 'membrane-2',
          kind: 'membrane',
          label: 'Another',
          encloses: ['cell'],
        },
      ]),
    ).toEqual(['Compartment "cell" is enclosed by both "membrane-1" and "membrane-2".'])
    expect(
      errorsOf([
        { id: 'host', kind: 'compartment', label: 'Host' },
        { id: 'lumen', kind: 'compartment', label: 'Lumen' },
        {
          id: 'membrane-1',
          kind: 'membrane',
          label: 'Membrane',
          parent: 'host',
          encloses: ['lumen'],
        },
      ]),
    ).toEqual([
      'Membrane "membrane-1" encloses "lumen", which stands somewhere else: what a membrane encloses stands where it does.',
    ])
  })

  it('docks a compartment only to a face it can reach', () => {
    // Not within the membrane, so it can't meet its inside.
    expect(
      errorsOf([
        ...cell(),
        {
          id: 'x',
          kind: 'compartment',
          label: 'X',
          docks: [{ on: 'membrane-1', side: 'top', face: 'inside' }],
        },
      ]),
    ).toEqual(['Compartment "x" docks to the inside of membrane "membrane-1" but is not within it.'])
    // Inside the cell, so it can't meet the membrane's outside.
    expect(
      errorsOf([
        ...cell(),
        {
          id: 'x',
          kind: 'compartment',
          label: 'X',
          parent: 'cell',
          docks: [{ on: 'membrane-1', side: 'top', face: 'outside' }],
        },
      ]),
    ).toEqual(['Compartment "x" docks to the outside of membrane "membrane-1" but does not stand beside it.'])
    // Within it through the cell it stands in: a microdomain.
    expect(
      errorsOf([
        ...cell(),
        {
          id: 'x',
          kind: 'compartment',
          label: 'X',
          parent: 'cell',
          docks: [{ on: 'membrane-1', side: 'top', face: 'inside' }],
        },
      ]),
    ).toEqual([])
  })

  it('lets only one compartment meet each face of a stretch', () => {
    const fluid = (id, from, to) => ({
      id,
      kind: 'compartment',
      label: id,
      docks: [{ on: 'membrane-1', side: 'top', face: 'outside', from, to }],
    })
    expect(errorsOf([...cell(), fluid('x', 0, 0.6), fluid('y', 0.5, 1)])).toEqual([
      'Compartments "x" and "y" both dock to the outside of the top side of membrane "membrane-1".',
    ])
    expect(errorsOf([...cell(), fluid('x', 0, 0.5), fluid('y', 0.5, 1)])).toEqual([])
  })

  it('needs every stretch of membrane to meet a compartment inside', () => {
    // Two compartments fill the membrane with neither docked: which meets which stretch is not said.
    expect(
      errorsOf([
        { id: 'a', kind: 'compartment', label: 'A' },
        { id: 'b', kind: 'compartment', label: 'B' },
        { id: 'm', kind: 'membrane', label: 'M', encloses: ['a', 'b'] },
      ])[0],
    ).toMatch(/^Membrane "m" encloses "a", "b", none docked to its sides/)
    // The rod with its inner segment docked nowhere: it is then the bulk, which meets every stretch left undocked.
    const loose = ROD.map((piece) => (piece.id === 'inner-segment' ? { ...piece, docks: undefined } : piece))
    expect(errorsOf(loose)).toEqual([])
    // With both docked and a side left bare, that side meets nothing.
    const bare = ROD.map((piece) =>
      piece.id === 'outer-segment'
        ? {
            ...piece,
            docks: piece.docks.filter((dock) => dock.side !== 'left'),
          }
        : piece,
    )
    expect(errorsOf(bare)).toEqual([
      'The left side of membrane "rod-membrane" meets no compartment inside at "os-tip": dock one there, or leave it a bulk.',
    ])
  })
})

describe('validatePiecesTemplate', () => {
  const template = {
    schemaVersion: 4,
    id: 'cell',
    name: 'Cell',
    description: 'A plain cell.',
    pieces: cell(),
  }

  it('reads a template written as pieces', () => {
    const { template: read, errors } = validatePiecesTemplate(template)
    expect(errors).toEqual([])
    expect(read).toMatchObject({
      schemaVersion: 4,
      id: 'cell',
      name: 'Cell',
      description: 'A plain cell.',
    })
    expect(read.pieces).toHaveLength(2)
  })

  it('needs schema 4, an id and a name', () => {
    expect(validatePiecesTemplate({ ...template, schemaVersion: 3 }).errors).toEqual(['"schemaVersion" must be 4.'])
    expect(validatePiecesTemplate({ ...template, id: 'Cell!' }).errors[0]).toMatch(/"id" must start with a letter/)
    expect(validatePiecesTemplate({ ...template, name: '' }).errors).toEqual(['Template: "name" is required.'])
  })

  it('takes a local id only when asked to', () => {
    expect(validatePiecesTemplate({ ...template, id: 'local:cell' }).errors).toHaveLength(1)
    expect(validatePiecesTemplate({ ...template, id: 'local:cell' }, { allowLocalId: true }).errors).toEqual([])
  })

  it('passes on its pieces’ errors', () => {
    expect(
      validatePiecesTemplate({
        ...template,
        pieces: [{ id: 'a', kind: 'zone', label: 'A', compartment: 'b' }],
      }).errors,
    ).toEqual(['Piece "a": its compartment "b" is not a compartment.'])
  })
})
