import { describe, expect, it } from 'vitest'

import builtInLibrary from '../../../../src/assets/bio_skins/builtin.skins.json'
import {
  DEFAULT_ARROW_ROOM,
  skinLibraryFile,
  validateAreaSkin,
  validateSkin,
  validateSymbolSkin as validateGlyph,
  validateSkinLibrary as validateGlyphLibrary,
} from '../../../../src/services/bioView/skinLibrary.js'
import { BUILT_IN_SYMBOLS as BUILT_IN_GLYPHS, getSkin as getGlyph } from '../../../../src/services/bioView/skinRegistry.js'

const GLYPHS = BUILT_IN_GLYPHS.map((g) => g.id)
import { GO } from '../../../../src/services/annotations/iris.js'

const plain = (value) => JSON.parse(JSON.stringify(value))

/** A small valid symbol skin, changed by `extra`. */
const glyph = (extra = {}) => ({
  id: 'cup',
  name: 'Cup',
  appliesTo: ['protein'],
  elements: [{ type: 'rect', x: 6, y: 3, width: 52, height: 42, rx: 15, fill: 'body', stroke: 'outline' }],
  ...extra,
})

const library = (skins = [glyph()], extra = {}) => ({ schemaVersion: 1, id: 'mine', name: 'Mine', skins, ...extra })
const errorsOf = (raw) => validateGlyph(raw).errors

describe('built-in symbol skins', () => {
  it('ship valid, keeping the ids saved workspaces name', () => {
    const { library: built, errors } = validateGlyphLibrary(builtInLibrary)
    expect(errors).toEqual([])
    expect(built.skins.map((g) => g.id)).toEqual(GLYPHS)
    for (const id of ['symporter', 'antiporter', 'uniporter', 'pump', 'channel', 'generic', 'receptor', 'myofilament', 'mitochondrion']) {
      expect(getGlyph(id)?.id).toBe(id)
    }
  })

  it('draw uniporter, symporter and antiporter as one carrier body, and give only the receptor a notch', () => {
    const body = (id) => getGlyph(id).elements.find((e) => e.fill === 'body')
    expect(body('uniporter')).toEqual(body('symporter'))
    expect(body('antiporter')).toEqual(body('symporter'))
    // The notch: a V down from the top edge to the middle, in from both sides.
    const notched = BUILT_IN_GLYPHS.filter((g) => g.elements.some((e) => e.type === 'path' && /L 32 1\d/.test(e.d)))
    expect(notched.map((g) => g.id)).toEqual(['receptor'])
  })

  it('tag transporters and the receptor with SBO, and name the GO functions PhLynx annotates', () => {
    expect(['symporter', 'antiporter', 'uniporter', 'pump', 'channel'].map((id) => getGlyph(id).sbo)).toEqual(
      Array(5).fill('SBO:0000284')
    )
    expect(getGlyph('receptor').sbo).toBe('SBO:0000244')
    expect(getGlyph('symporter').terms).toContain(GO.glucoseSodiumSymporter)
    expect(getGlyph('uniporter').terms).toContain(GO.glucoseTransporter)
    expect(getGlyph('pump').terms).toContain(GO.sodiumPotassiumAtpase)
    expect(getGlyph('channel').terms).toContain(GO.inwardRectifierPotassiumChannel)
    // Each is for a protein in its membrane or a process, not both.
    expect(BUILT_IN_GLYPHS.filter((g) => g.appliesTo.includes('process')).map((g) => g.id)).toEqual([
      'myofilament',
      'mitochondrion',
      'process',
    ])
  })
})

describe('validateGlyph', () => {
  it('fills in the canvas, arrow room and stroke width', () => {
    const { skin: clean } = validateGlyph(glyph())
    expect(clean.viewBox).toBe('0 0 64 48')
    expect(clean.arrowRoom).toEqual(DEFAULT_ARROW_ROOM)
    expect(clean.elements[0].strokeWidth).toBe(2)
    expect(Object.isFrozen(clean.elements[0])).toBe(true)
  })

  it('rejects path data that is not just commands and numbers', () => {
    const path = (d) => glyph({ elements: [{ type: 'path', d }] })
    expect(errorsOf(path('M 0 0 L 10 10 Z'))).toEqual([])
    expect(errorsOf(path('M 0 0 <script>alert(1)</script>'))).toHaveLength(1)
    expect(errorsOf(path('url(#x)'))).toHaveLength(1)
    expect(errorsOf(path('L 0 0'))).toHaveLength(1)
    expect(errorsOf(path(`M ${'1 '.repeat(1001)}`))).toHaveLength(1)
  })

  it('rejects raw SVG, links, styles, handlers and unknown shapes', () => {
    const rect = (extra) => glyph({ elements: [{ type: 'rect', x: 0, y: 0, width: 4, height: 4, ...extra }] })
    for (const key of ['href', 'xlink:href', 'style', 'onclick', 'class', 'transform']) {
      expect(errorsOf(rect({ [key]: 'x' }))).toEqual([`Skin "cup" element 1: a rect cannot have "${key}".`])
    }
    expect(errorsOf(glyph({ elements: [{ type: 'image', href: 'x.png' }] }))).toHaveLength(1)
    expect(errorsOf(glyph({ elements: [{ type: 'foreignObject' }] }))).toHaveLength(1)
    expect(errorsOf(glyph({ svg: '<svg/>' }))).toEqual([])
    expect(validateGlyph(glyph({ svg: '<svg/>' })).warnings).toEqual(['Skin "cup": unknown key "svg" was ignored.'])
    expect(validateGlyph(glyph({ svg: '<svg/>' })).skin).not.toHaveProperty('svg')
  })

  it('takes colours only as slots, and palette colours only as hex', () => {
    const fill = (value) => glyph({ elements: [{ type: 'circle', cx: 1, cy: 1, r: 1, fill: value }] })
    expect(errorsOf(fill('accent'))).toEqual([])
    expect(errorsOf(fill('none'))).toEqual([])
    expect(errorsOf(fill('#f00'))).toHaveLength(1)
    expect(errorsOf(fill('red'))).toHaveLength(1)
    const palette = (value) => glyph({ palette: value })
    expect(validateGlyph(palette({ light: { body: '#ABC' }, dark: { body: '#123456' } })).skin.palette).toEqual({
      light: { body: '#aabbcc' },
      dark: { body: '#123456' },
    })
    expect(errorsOf(palette({ light: { body: 'url(javascript:x)' } }))).toHaveLength(1)
    expect(validateGlyph(palette({ light: { glow: '#fff' } })).warnings).toHaveLength(1)
  })

  it('holds a symbol to the 64×48 canvas, its limits and its upright points', () => {
    expect(errorsOf(glyph({ viewBox: '0 0 100 100' }))).toEqual(['Skin "cup": "viewBox" must be "0 0 64 48".'])
    expect(errorsOf(glyph({ viewBox: '0 0  64 48' }))).toEqual([])
    expect(errorsOf(glyph({ elements: Array(33).fill(glyph().elements[0]) }))).toHaveLength(1)
    expect(errorsOf(glyph({ elements: [] }))).toHaveLength(1)
    expect(errorsOf(glyph({ id: 'Bad Id' }))).toHaveLength(1)
    expect(errorsOf(glyph({ sbo: 'SBO:12' }))).toHaveLength(1)
    expect(errorsOf(glyph({ terms: ['not a term'] }))).toHaveLength(1)
    expect(errorsOf(glyph({ appliesTo: [] }))).toHaveLength(1)
    expect(errorsOf(glyph({ appliesTo: ['cytosol'] }))).toHaveLength(1)
    expect(errorsOf(glyph({ appliesTo: undefined }))).toHaveLength(1)
    expect(errorsOf(glyph({ faces: { outside: { x: 99, y: 0 } } }))).toHaveLength(1)
    expect(errorsOf(glyph({ arrowRoom: { left: 40, right: 20, top: 0, bottom: 40 } }))).toHaveLength(1)
    expect(errorsOf(glyph({ elements: [{ type: 'path', d: 'M 0 0', upright: true }] }))).toHaveLength(1)
    const text = validateGlyph(glyph({ elements: [{ type: 'text', x: 5, y: 6, text: 'ATP', upright: true }] })).skin
    // About the middle of its letters, a little above the baseline
    expect(text.elements[0]).toMatchObject({ upright: { x: 5, y: 3.9 }, fill: 'accentText', size: 6 })
  })
})

describe('validateGlyphLibrary', () => {
  it('rejects a library with any bad skin, or skins sharing an id', () => {
    expect(validateGlyphLibrary(library()).errors).toEqual([])
    expect(validateGlyphLibrary(library([glyph(), glyph({ name: 'Other' })])).errors).toEqual([
      'Id "cup" is used by more than one skin.',
    ])
    expect(validateGlyphLibrary(library([glyph({ elements: [{ type: 'path', d: 'javascript:' }] })])).library).toBeNull()
    expect(validateGlyphLibrary(library([], {})).library).toBeNull()
    expect(validateGlyphLibrary(library(undefined, { schemaVersion: 2 })).library).toBeNull()
    expect(validateGlyphLibrary('[]').library).toBeNull()
  })

  it('accepts local ids only when asked to', () => {
    const local = library([glyph({ id: 'local:cup' })], { id: 'local:mine' })
    expect(validateGlyphLibrary(local).library).toBeNull()
    expect(validateGlyphLibrary(local, { allowLocalId: true }).library.skins[0].id).toBe('local:cup')
  })

  it('writes a library as a file with its own ids, which loads back the same', () => {
    const { library: local } = validateGlyphLibrary(library([glyph({ id: 'local:cup' })], { id: 'local:mine' }), {
      allowLocalId: true,
    })
    const { filename, text } = skinLibraryFile(local)
    expect(filename).toBe('mine.skins.json')
    const { library: back, errors } = validateGlyphLibrary(JSON.parse(text))
    expect(errors).toEqual([])
    expect(plain(back)).toEqual({ ...plain(local), id: 'mine', skins: [{ ...plain(local.skins[0]), id: 'cup' }] })
  })
})

describe('area skins', () => {
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" onclick="x()"/></svg>'
  const area = (extra = {}) => ({ id: 'villus', name: 'Villus', appliesTo: ['cytosol'], svg: SVG, ...extra })

  it('are told from symbols by their SVG, which is cleaned as it is read', () => {
    const { skin, errors } = validateSkin(area({ terms: ['GO:0005902'] }))
    expect(errors).toEqual([])
    expect(skin).toMatchObject({ id: 'villus', appliesTo: ['cytosol'], terms: ['GO:0005902'] })
    expect(skin.svg).not.toContain('onclick')
    expect(validateSkin(glyph()).skin).toHaveProperty('elements')
  })

  it('fill only areas, and must be drawings', () => {
    expect(validateAreaSkin(area({ appliesTo: ['protein'] })).errors).toEqual([
      'Skin "villus": "appliesTo" must list one or more of cytosol, organelle, subcompartment, extracellular.',
    ])
    expect(validateAreaSkin(area({ svg: '<p>no</p>' })).skin).toBeNull()
    expect(validateGlyph(glyph({ appliesTo: ['cytosol'] })).skin).toBeNull()
    // A symbol can draw a tube's joint, too.
    expect(validateGlyph(glyph({ appliesTo: ['gapJunction', 'protein'] })).skin.appliesTo).toEqual(['protein', 'gapJunction'])
  })

  it('share a library with symbols', () => {
    const { library: both, errors } = validateGlyphLibrary(library([glyph(), area()]))
    expect(errors).toEqual([])
    expect(both.skins.map((skin) => skin.id)).toEqual(['cup', 'villus'])
  })
})
