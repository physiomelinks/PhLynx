import { existsSync, readFileSync, readdirSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

import { CHEBI, GO, OPB } from '../../../../src/services/annotations/iris.js'
import { parseSidecar } from '../../../../src/services/annotations/sidecar.js'
import { flowDirection, speciesLabel, transportedSpecies } from '../../../../src/services/bioView/transport.js'

const TOY = resolve(__dirname, '../../fixtures/annotations/toy')
const readToy = (name) => readFileSync(resolve(TOY, name), 'utf8')

const flow = (variable, species, location) => ({ variable, property: OPB.molarFlowRate, species: [species], location })

describe('what a protein carries across its membrane', () => {
  it('reads the species with a flow on both sides of the membrane', () => {
    const sidecar = {
      variables: [
        flow('v_Na_i', CHEBI.sodium, GO.cytoplasm),
        { variable: 'c_Na_i', property: OPB.concentration, species: [CHEBI.sodium], location: GO.cytoplasm },
        flow('v_Na_o', CHEBI.sodium, GO.extracellularRegion),
        // Used inside only, so not carried across.
        flow('v_Glc', CHEBI.glucose, GO.cytoplasm),
        flow('v_K_o', CHEBI.potassium, GO.extracellularRegion),
        flow('v_K_i', CHEBI.potassium, GO.cytoplasm),
      ],
    }
    expect(transportedSpecies(sidecar)).toEqual([
      { species: CHEBI.sodium, label: 'Na⁺', inside: 'v_Na_i', outside: 'v_Na_o' },
      { species: CHEBI.potassium, label: 'K⁺', inside: 'v_K_i', outside: 'v_K_o' },
    ])
    expect(transportedSpecies(null)).toEqual([])
  })

  it('reads the toy porter, whose inside flow is a named entity', async () => {
    const sidecar = await parseSidecar(readToy('porter.ttl'), { mathRef: 'porter.cellml:porter', cellml: readToy('porter.cellml') })
    expect(transportedSpecies(sidecar).map((entry) => entry.label)).toEqual(['Na⁺'])
  })

  it('names the species it knows, and gives the CURIE of others', () => {
    expect(speciesLabel(CHEBI.glucose)).toBe('Glc')
    expect(speciesLabel('CHEBI:1')).toBe('CHEBI:1')
  })

  it('tells the way a species went from its flow into the cell at the end of a run', () => {
    expect(flowDirection(Float64Array.from([0, -1, 2]))).toBe('in')
    expect(flowDirection(Float64Array.from([3, -0.5]))).toBe('out')
    expect(flowDirection(Float64Array.from([1, 0]))).toBeNull()
    expect(flowDirection(null)).toBeNull()
    expect(flowDirection([Number.NaN])).toBeNull()
  })
})

// Unpublished fixtures, gitignored: read generically, naming nothing of the model.
const PRIVATE = resolve(__dirname, '../../fixtures/annotations/private')

describe.skipIf(!existsSync(resolve(PRIVATE, 'expected.json')))('what the private transporters carry', () => {
  it('finds at least one species each transporter carries, with flows the math has', async () => {
    const names = readdirSync(resolve(PRIVATE, 'sidecars')).map((file) => file.replace(/\.ttl$/, ''))
    let transporters = 0
    for (const name of names) {
      const cellml = readFileSync(resolve(PRIVATE, 'maths', `${name}.cellml`), 'utf8')
      const sidecar = await parseSidecar(readFileSync(resolve(PRIVATE, 'sidecars', `${name}.ttl`), 'utf8'), { mathRef: `${name}.cellml:${name}`, cellml })
      if (sidecar.component?.kind !== 'transporter') continue
      transporters++
      const carried = transportedSpecies(sidecar)
      expect(carried.length, name).toBeGreaterThan(0)
      for (const { inside, outside } of carried) {
        expect(cellml, name).toContain(`name="${inside}"`)
        expect(cellml, name).toContain(`name="${outside}"`)
      }
    }
    expect(transporters).toBeGreaterThan(0)
  })
})
