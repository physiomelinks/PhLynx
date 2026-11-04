import { describe, expect, it } from 'vitest'

import { matchSidecarFiles } from '../../../../src/services/annotations/importSidecars.js'

const library = new Set(['pool.cellml:pool', 'porter.cellml:porter'])
const hasMath = (mathRef) => library.has(mathRef)

describe('matchSidecarFiles', () => {
  it('matches each file to the module its component names', () => {
    const { matched, unmatched } = matchSidecarFiles(
      [
        { name: 'pool.ttl', text: 'p', mathRef: 'pool.cellml:pool' },
        { name: 'renamed.ttl', text: 'q', mathRef: 'porter.cellml:porter' },
      ],
      hasMath
    )
    expect(matched.map(({ name, mathRef }) => [name, mathRef])).toEqual([
      ['pool.ttl', 'pool.cellml:pool'],
      ['renamed.ttl', 'porter.cellml:porter'],
    ])
    expect(unmatched).toEqual([])
  })

  it('never matches by file name, and reports modules that are missing or annotated twice', () => {
    const { matched, unmatched } = matchSidecarFiles(
      [
        { name: 'pool.ttl', text: 'p', mathRef: 'other.cellml:pool' },
        { name: 'porter.ttl', text: 'a', mathRef: 'porter.cellml:porter' },
        { name: 'porter-2.ttl', text: 'b', mathRef: 'porter.cellml:porter' },
        { name: 'blank.ttl', text: '', mathRef: null },
      ],
      hasMath
    )
    expect(matched.map(({ name }) => name)).toEqual(['porter.ttl'])
    expect(unmatched).toEqual([
      { name: 'pool.ttl', reason: 'annotates other.cellml:pool, which is not in the library' },
      { name: 'porter-2.ttl', reason: 'annotates porter.cellml:porter, as an earlier file does' },
      { name: 'blank.ttl', reason: 'names no single module component' },
    ])
  })
})
