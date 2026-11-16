import { describe, expect, it } from 'vitest'
import { rdfFormatOf, readSidecarComponent } from '../../../../src/services/annotations/sidecarFiles.js'
import { readToy } from './toyModel.js'

describe('sidecarFiles', () => {
  it('reads the annotated component of a sidecar, ignoring entities with bqbiol:is', async () => {
    // Every toy sidecar also has local:entity_self, with the module's kind term, and named local entities.
    expect(await readSidecarComponent(readToy('porter.ttl'))).toEqual({
      file: 'porter.cellml',
      componentName: 'porter',
      mathRef: 'porter.cellml:porter',
      kind: 'transporter',
      is: ['uniprot:Q0TOY1'],
    })
    expect((await readSidecarComponent(readToy('wall.ttl'))).kind).toBe('membrane')
    expect(await readSidecarComponent(readToy('pool.ttl'))).toMatchObject({ mathRef: 'pool.cellml:pool', kind: 'compartment' })
    // A described entity in the math's own namespace is no component either.
    const entity = `${readToy('pool.ttl')}m:v2f17r92n bqbiol:isPropertyOf m:place .\nm:place bqbiol:is sbo:0000290 .\n`
    expect((await readSidecarComponent(entity))?.componentName).toBe('pool')
    expect(await readSidecarComponent('@prefix m: <./x.cellml#> . m:x m:y m:z .')).toBeNull()
    await expect(readSidecarComponent('not turtle')).rejects.toThrow()
  })

  it('reads RDF/XML for .rdf files, else Turtle', () => {
    expect(rdfFormatOf('module.rdf')).toBe('rdfxml')
    expect(rdfFormatOf('module.TTL')).toBe('turtle')
    expect(rdfFormatOf(undefined)).toBe('turtle')
  })
})
