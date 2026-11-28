import { describe, expect, it } from 'vitest'

import { dropScene, previewDrop, resolveDrop } from '../../../../../src/services/bioView/pieces/drops.js'
import {
  addImage,
  removePieces,
  replaceImage,
  setImageOpacity,
  skinPiece,
} from '../../../../../src/services/bioView/pieces/edits.js'
import { layoutPieces, pieceKey } from '../../../../../src/services/bioView/pieces/layout.js'
import { validatePieces, validatePiecesTemplate } from '../../../../../src/services/bioView/pieces/model.js'
import { dragModeOf, moveFrame, resizeFrame } from '../../../../../src/services/bioView/pieces/moves.js'
import { liftedWith } from '../../../../../src/services/bioView/pieces/relocate.js'
import { topologyOf } from '../../../../../src/services/bioView/pieces/topology.js'

const PICTURE = 'img-0123456789abcdef'
const valid = (raw) => {
  const { pieces, errors } = validatePieces(raw)
  expect(errors).toEqual([])
  return pieces
}

const box = { id: 'box', kind: 'compartment', label: 'Box', frame: { x: 0, y: 0, width: 320, height: 140 } }
const other = { id: 'other', kind: 'compartment', label: 'Other', frame: { x: 600, y: 0, width: 320, height: 140 } }
const image = (frame = { x: 20, y: 400, width: 100, height: 60 }, extra = {}) => ({
  id: 'pic',
  kind: 'image',
  label: 'Pic',
  frame,
  image: PICTURE,
  ...extra,
})

describe('an image piece', () => {
  it('validates on the canvas with its frame and picture, and offers no site', () => {
    const pieces = valid([box, image()])
    expect(pieces[1]).toEqual(image())
    expect(topologyOf(pieces).sites.map((site) => site.path)).toEqual(['box'])
  })

  it('may have no picture yet, a placeholder for one', () => {
    const { image: _, ...empty } = image()
    expect(valid([empty])[0]).toEqual(empty)
  })

  it('needs a frame and, where it names one, a picture’s id, and takes no site', () => {
    const { errors } = validatePieces([{ id: 'pic', kind: 'image', label: 'Pic', image: 'cat.png', site: true }])
    expect(errors).toEqual([
      'Piece "pic": "frame" is required.',
      'Piece "pic": "image" must name its picture, as img- and 16 hexadecimal digits.',
      'Piece "pic": an image offers no site.',
    ])
  })

  it('stands in no compartment', () => {
    const { pieces, warnings } = validatePieces([box, image(undefined, { compartment: 'box' })])
    expect(warnings).toEqual(['Piece "pic": unknown key "compartment" was ignored.'])
    expect(pieces[1].compartment).toBeUndefined()
  })

  it('keeps an opacity below 1 only', () => {
    expect(valid([image(undefined, { opacity: 1 })])[0].opacity).toBeUndefined()
    expect(valid([image(undefined, { opacity: 0.5 })])[0].opacity).toBe(0.5)
    expect(validatePieces([image(undefined, { opacity: 0 })]).errors).toHaveLength(1)
  })

  it('can’t be in a template, which has no store for its picture', () => {
    const template = { schemaVersion: 4, id: 'pictured', name: 'Pictured', pieces: [box, image()] }
    expect(validatePiecesTemplate(template).errors).toEqual(['A template can’t hold images.'])
  })
})

describe('laying out an image', () => {
  it('is drawn where its frame says on the canvas, with no site', () => {
    const { places, sites } = layoutPieces(valid([box, image({ x: -300, y: -200, width: 100, height: 60 })]))
    const place = places.get(pieceKey('pic'))
    expect(place).toMatchObject({ kind: 'image', piece: 'pic', image: PICTURE, opacity: 1, site: null })
    expect(place.rect).toEqual({ x: -300, y: -200, width: 100, height: 60 })
    expect(place.resize).toMatchObject({ mode: 'frame', keepAspect: true })
    expect(place.drag).toBe('frame')
    expect(sites.map((site) => site.path)).toEqual(['box'])
  })

  it('moves and grows nothing it overlaps', () => {
    const alone = layoutPieces(valid([box])).places.get(pieceKey('box')).rect
    const over = image({ x: 100, y: 50, width: 400, height: 300 })
    expect(layoutPieces(valid([box, over])).places.get(pieceKey('box')).rect).toEqual(alone)
  })
})

describe('editing an image', () => {
  it('is added on the canvas, named or numbered', () => {
    const frame = { x: -40, y: 10, width: 80, height: 40 }
    const first = addImage(valid([box]), { image: PICTURE, frame, label: 'Heart' })
    expect(valid(first.pieces).find((piece) => piece.id === first.id)).toMatchObject({ label: 'Heart', frame })
    const second = addImage(valid(first.pieces), { image: PICTURE, frame })
    expect(second.pieces.at(-1).label).toBe('Image')
  })

  it('changes opacity, and picture keeping its width', () => {
    const pieces = valid([image()])
    expect(valid(setImageOpacity(pieces, 'pic', 0.25))[0].opacity).toBe(0.25)
    expect(valid(setImageOpacity(pieces, 'pic', 1))[0].opacity).toBeUndefined()
    const replaced = valid(replaceImage(pieces, 'pic', 'img-fedcba9876543210', { width: 400, height: 400 }))[0]
    expect(replaced).toMatchObject({ image: 'img-fedcba9876543210', frame: { width: 100, height: 100 } })
  })

  it('stays when what it overlaps goes', () => {
    const { pieces } = removePieces(valid([box, image({ x: 10, y: 10, width: 50, height: 50 })]), ['box'])
    expect(pieces.map((piece) => piece.id)).toEqual(['pic'])
  })

  it('is dragged and resized by its frame, pushing nothing and pushed by nothing', () => {
    const pieces = valid([box, image(), { ...image({ x: 140, y: 400, width: 60, height: 60 }), id: 'pic2' }])
    expect(dragModeOf(pieces, 'pic')).toBe('frame')
    const { rects } = layoutPieces(pieces)
    const moved = valid(moveFrame(pieces, 'pic', { x: -300, y: 10 }, rects))
    expect(moved[1].frame).toMatchObject({ x: -280, y: 410 })
    const grown = valid(resizeFrame(pieces, 'pic', { ...rects.get('pic'), width: 200, height: 120 }, rects))
    expect(grown[1].frame).toMatchObject({ width: 200, height: 120 })
    expect(grown[2].frame).toEqual(pieces[2].frame)
    // A compartment grown over an image leaves it where it is.
    const rectsOf = (raw) => layoutPieces(valid(raw)).rects
    const taller = resizeFrame(pieces, 'box', { ...rects.get('box'), height: 600 }, rects, { rectsOf })
    expect(valid(taller)[1].frame).toEqual(pieces[1].frame)
  })

  it('is never lifted into a compartment', () => {
    expect(liftedWith(valid([box, image()]), 'pic').error).toBe(
      'An image stays on the canvas: drag it to move it there.',
    )
  })
})

describe('dropping an image', () => {
  it('with no picture yet, places a placeholder to choose one', () => {
    const scene = dropScene(valid([box]))
    const { pieces, id, errors } = previewDrop(scene, resolveDrop('image', { x: 160, y: 500 }, scene))
    expect(errors).toEqual([])
    expect(pieces.find((piece) => piece.id === id)).toEqual({
      id: 'image',
      kind: 'image',
      label: 'Image',
      frame: { x: 40, y: 420, width: 240, height: 160 },
    })
    expect(layoutPieces(pieces).places.get(pieceKey(id)).image).toBeNull()
  })

  const picture = { id: PICTURE, width: 480, height: 240, label: 'Wide' }

  it('goes on bare canvas, centred where it is dropped, sized by its picture', () => {
    const scene = dropScene(valid([box]))
    const { pieces, id, errors } = previewDrop(scene, resolveDrop('image', { x: 160, y: 500 }, scene, { picture }))
    expect(errors).toEqual([])
    expect(pieces.find((piece) => piece.id === id)).toEqual({
      id: 'image',
      kind: 'image',
      label: 'Wide',
      image: PICTURE,
      frame: { x: 40, y: 440, width: 240, height: 120 },
    })
  })

  it('can’t go on a compartment, a cell, a tube or another image', () => {
    const membrane = { id: 'm', kind: 'membrane', label: 'M', encloses: ['other'] }
    const tube = { id: 't', kind: 'tube', label: 'T', ends: ['box', 'other'] }
    const scene = dropScene(valid([box, other, membrane, tube, image()]))
    const at = (x, y) => resolveDrop('image', { x, y }, scene, { picture }).invalid ?? null
    const { rects } = layoutPieces(scene.pieces)
    const middle = (rect) => [rect.x + rect.width / 2, rect.y + rect.height / 2]
    for (const id of ['box', 'other', 'pic'])
      expect(at(...middle(rects.get(id))), id).toBe('An image goes on bare canvas.')
    const way = layoutPieces(scene.pieces).places.get(pieceKey('t'))
    expect(at(...middle(way.zone)), 'tube').toBe('An image goes on bare canvas.')
    expect(at(160, 300)).toBeNull()
  })
})

describe('an image’s skin', () => {
  it('takes the place of its picture, and a picture the place of its skin', () => {
    const pieces = valid([image(undefined, { opacity: 0.5 })])
    const skinned = valid(skinPiece(pieces, 'pic', { ref: 'heart' }))[0]
    expect(skinned).toMatchObject({ skin: { ref: 'heart', mode: 'contain', opacity: 1 } })
    expect(skinned.image).toBeUndefined()
    expect(skinned.opacity).toBeUndefined()
    const pictured = valid(replaceImage(valid([skinned]), 'pic', PICTURE, { width: 2, height: 1 }))[0]
    expect(pictured.image).toBe(PICTURE)
    expect(pictured.skin).toBeUndefined()
  })

  it('is none without taking its picture', () => {
    const none = valid(skinPiece(valid([image()]), 'pic', { ref: 'none' }))[0]
    expect(none).toMatchObject({ image: PICTURE, skin: { ref: 'none' } })
  })

  it('is drawn with it', () => {
    const { image: _, ...empty } = image()
    const place = layoutPieces(valid([{ ...empty, skin: { ref: 'heart', mode: 'cover' } }])).places.get(pieceKey('pic'))
    expect(place.skin).toMatchObject({ ref: 'heart', mode: 'cover' })
    expect(layoutPieces(valid([image()])).places.get(pieceKey('pic')).skin).toBeUndefined()
  })
})
