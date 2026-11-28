import { afterEach, describe, expect, it } from 'vitest'

import { contextOfModule } from '../../../../src/services/bioView/skinContext.js'
import {
  NO_SKIN,
  allowsNoSkin,
  getSkin,
  resolveSkin,
  setLoadedSkins,
  skinsFor,
} from '../../../../src/services/bioView/skinRegistry.js'

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>'
const area = (id, appliesTo, terms) => ({ id, name: id, appliesTo, ...(terms && { terms }), svg: SVG })
const protein = (terms = []) => contextOfModule('membraneProtein', terms)
const process = (terms = []) => contextOfModule('cytosolic', terms)
const segment = (terms = []) => ({ family: 'area', target: 'subcompartment', terms })

afterEach(() => setLoadedSkins([]))

describe('the skins a thing is offered', () => {
  it('are only those for what it is', () => {
    const ids = (context) => skinsFor(context).map((skin) => skin.id)
    expect(ids(protein())).toEqual(['symporter', 'antiporter', 'uniporter', 'pump', 'channel', 'receptor', 'generic'])
    expect(ids(process())).toEqual(['myofilament', 'mitochondrion', 'process'])
    expect(ids({ family: 'membrane', target: 'plasmaMembrane', terms: [] })).toEqual(['bilayer', 'wall'])
    expect(ids({ family: 'membrane', target: 'organelleMembrane', terms: [] })).toEqual([
      'bilayer',
      'double-membrane',
      'wall',
    ])
    expect(skinsFor(null)).toEqual([])
  })

  it('put those whose terms meet its own first, and leave none of the rest out', () => {
    const ids = skinsFor(protein(['GO:0005242'])).map((skin) => skin.id)
    expect(ids[0]).toBe('channel')
    expect(ids).toHaveLength(7)
  })

  it('come built in before loaded, and say how they are drawn', () => {
    setLoadedSkins([area('local:mine', ['subcompartment'])])
    expect(skinsFor(segment()).map((skin) => skin.id)).toEqual(['rod-inner-segment', 'rod-outer-segment', 'local:mine'])
    expect(getSkin('local:mine')).toMatchObject({ renderer: 'area', isBuiltIn: false })
    expect(getSkin('generic')).toMatchObject({ renderer: 'symbol', isBuiltIn: true })
    expect(getSkin('bilayer')).toMatchObject({ renderer: 'line' })
  })
})

describe('the skin a thing is drawn with', () => {
  it('is the one chosen, where it applies', () => {
    expect(resolveSkin(protein(), 'pump').id).toBe('pump')
    // Chosen for a process, it does not draw a protein: the protein's default does.
    expect(resolveSkin(protein(), 'mitochondrion').id).toBe('generic')
    expect(resolveSkin(process(), 'mitochondrion').id).toBe('mitochondrion')
  })

  it('else the first whose terms meet its own, else its target’s default', () => {
    expect(resolveSkin(protein(['GO:0005391'])).id).toBe('pump')
    expect(resolveSkin(process(['GO:0005739'])).id).toBe('mitochondrion')
    // A process's term never puts a protein skin on it.
    expect(resolveSkin(process(['GO:0005391'])).id).toBe('process')
    expect(resolveSkin(protein()).id).toBe('generic')
    expect(resolveSkin({ family: 'membrane', target: 'organelleMembrane', terms: [] }).id).toBe('bilayer')
    expect(resolveSkin({ family: 'area', target: 'cytosol', terms: [] })).toBeNull()
  })

  it('matches an area by its term, and is none where none is chosen', () => {
    setLoadedSkins([area('local:outer', ['subcompartment'], ['GO:0001750'])])
    // A built-in matches first, then a loaded one.
    expect(resolveSkin(segment(['GO:0001750'])).id).toBe('rod-outer-segment')
    expect(resolveSkin(segment(['GO:0000000']))).toBeNull()
    expect(resolveSkin(segment(['GO:0001750']), { ref: NO_SKIN })).toBeNull()
    expect(resolveSkin(segment(), { ref: 'local:outer' }).id).toBe('local:outer')
  })

  it('is the one chosen for another kind of area or membrane, once the thing becomes this kind, and is offered', () => {
    setLoadedSkins([area('local:art', ['extracellular'])])
    const cytosol = { family: 'area', target: 'cytosol', terms: [] }
    expect(resolveSkin(cytosol, { ref: 'local:art' }).id).toBe('local:art')
    expect(skinsFor(cytosol, { ref: 'local:art' }).map((skin) => skin.id)).toContain('local:art')
    const plasma = { family: 'membrane', target: 'plasmaMembrane', terms: [] }
    expect(resolveSkin(plasma, { ref: 'double-membrane' }).id).toBe('double-membrane')
    expect(skinsFor(plasma, { ref: 'double-membrane' }).map((skin) => skin.id)).toEqual([
      'bilayer',
      'wall',
      'double-membrane',
    ])
    // Not across families, nor for a tube or module.
    expect(resolveSkin(cytosol, { ref: 'bilayer' })).toBeNull()
    expect(skinsFor(plasma)).toHaveLength(2)
  })

  it('is none for a process only where chosen, and never for a protein', () => {
    expect(resolveSkin(process(), NO_SKIN)).toBeNull()
    expect(resolveSkin(protein(), NO_SKIN).id).toBe('generic')
  })

  it('ranks a loaded symbol by its terms after the built-ins', () => {
    const cup = {
      id: 'local:cup',
      name: 'Cup',
      appliesTo: ['protein'],
      terms: ['GO:0099999', 'GO:0005242'],
      elements: [],
    }
    setLoadedSkins([cup])
    expect(resolveSkin(protein(['GO:0099999'])).id).toBe('local:cup')
    expect(resolveSkin(protein(['GO:0005242'])).id).toBe('channel')
    expect(skinsFor(protein(['GO:0099999']))[0].id).toBe('local:cup')
  })
})

describe('a tube’s joint', () => {
  const tube = (target) => ({ family: 'tube', target, terms: [] })

  it('is drawn as today for its flux unless chosen, and offered only what suits it', () => {
    expect(['conduit', 'gapJunction', 'bridge', 'diffusion'].map((t) => resolveSkin(tube(t)).id)).toEqual([
      'narrowing',
      'connexon-pair',
      'open-way',
      'dashed-way',
    ])
    expect(resolveSkin(tube('bridge'), { ref: 'dashed-way' }).id).toBe('dashed-way')
    expect(resolveSkin(tube('gapJunction'), { ref: 'dashed-way' }).id).toBe('connexon-pair')
    expect(skinsFor(tube('diffusion')).map((skin) => skin.id)).toEqual(['open-way', 'dashed-way'])
  })

  it('can be a loaded symbol for it', () => {
    setLoadedSkins([{ id: 'local:valve', name: 'Valve', appliesTo: ['conduit'], elements: [] }])
    expect(skinsFor(tube('conduit')).map((skin) => skin.id)).toEqual(['narrowing', 'local:valve'])
    expect(resolveSkin(tube('conduit'), { ref: 'local:valve' }).renderer).toBe('symbol')
  })
})

describe('image skins', () => {
  const image = { family: 'image', target: 'image', terms: [] }

  it('are offered to images alone, the built-ins valid', () => {
    expect(skinsFor(image).map((skin) => skin.id)).toEqual(['blood-vessel', 'heart', 'neuron', 'red-blood-cell'])
    expect(skinsFor(image).every((skin) => skin.renderer === 'area')).toBe(true)
    expect(skinsFor({ family: 'area', target: 'cytosol', terms: [] }).map((skin) => skin.id)).not.toContain('heart')
  })

  it('draw an image with none unless one is chosen', () => {
    expect(allowsNoSkin('image')).toBe(true)
    expect(resolveSkin(image)).toBeNull()
    expect(resolveSkin(image, { ref: 'heart' }).id).toBe('heart')
    expect(resolveSkin(image, { ref: 'rod-outer-segment' })).toBeNull()
  })
})
