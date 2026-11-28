import { describe, expect, it } from 'vitest'

import {
  IMAGE_MAX_DATA,
  imageFileProblem,
  imageFrameSize,
  imageIdOf,
  imageLabelOf,
  isImageEntry,
} from '../../../../src/services/bioView/images.js'
import { IMAGE_REF } from '../../../../src/services/bioView/pieces/constants.js'

const PNG = 'data:image/png;base64,iVBORw0KGgo='
const entry = (extra) => ({ type: 'image/png', data: PNG, width: 10, height: 20, ...extra })

describe('isImageEntry', () => {
  it('takes a base64 data URL of a bitmap, with its size', () => {
    expect(isImageEntry(entry())).toBe(true)
    expect(isImageEntry(entry({ type: 'image/jpeg', data: PNG.replace('png', 'jpeg') }))).toBe(true)
  })

  it('refuses anything else', () => {
    expect(isImageEntry(null)).toBe(false)
    expect(isImageEntry(entry({ type: 'image/svg+xml', data: 'data:image/svg+xml;base64,PHN2Zz4=' }))).toBe(false)
    expect(isImageEntry(entry({ type: 'image/jpeg' }))).toBe(false)
    expect(isImageEntry(entry({ data: 'data:image/png;base64,<script>' }))).toBe(false)
    expect(isImageEntry(entry({ data: 'javascript:alert(1)' }))).toBe(false)
    expect(isImageEntry(entry({ width: 0 }))).toBe(false)
    expect(isImageEntry(entry({ data: PNG + 'A'.repeat(IMAGE_MAX_DATA) }))).toBe(false)
  })
})

describe('imageIdOf', () => {
  it('gives the same picture the same id, and another another', () => {
    expect(imageIdOf(PNG)).toMatch(IMAGE_REF)
    expect(imageIdOf(PNG)).toBe(imageIdOf(PNG))
    expect(imageIdOf(PNG)).not.toBe(imageIdOf(PNG + 'A'))
  })
})

describe('imageFrameSize', () => {
  it('keeps the picture’s shape, its longest side at most 240', () => {
    expect(imageFrameSize({ width: 1200, height: 600 })).toEqual({ width: 240, height: 120 })
    expect(imageFrameSize({ width: 100, height: 50 })).toEqual({ width: 100, height: 50 })
    expect(imageFrameSize({ width: 2000, height: 10 })).toEqual({ width: 240, height: 20 })
  })
})

describe('imageLabelOf and imageFileProblem', () => {
  it('names an image for its file', () => {
    expect(imageLabelOf('Heart diagram.png')).toBe('Heart diagram')
    expect(imageLabelOf('')).toBe('Image')
  })

  it('takes bitmaps only, not too big', () => {
    expect(imageFileProblem({ name: 'a.png', type: 'image/png', size: 10 })).toBeNull()
    expect(imageFileProblem({ name: 'a.svg', type: 'image/svg+xml', size: 10 })).toMatch(/SVG/)
    expect(imageFileProblem({ name: 'a.txt', type: 'text/plain', size: 10 })).toMatch(/PNG, JPEG/)
    expect(imageFileProblem({ name: 'a.png', type: 'image/png', size: 1e9 })).toMatch(/too big/)
  })
})
