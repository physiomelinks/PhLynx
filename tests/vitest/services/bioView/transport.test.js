import { readFileSync } from 'fs'
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

  it('reads the density flow rates of older side-cars as it does molar flow rates', () => {
    const density = (...args) => ({ ...flow(...args), property: OPB.amountDensityFlowRate })
    const inside = density('v_Na_i', CHEBI.sodium, GO.cytoplasm)
    const sidecar = { variables: [inside, density('v_Na_o', CHEBI.sodium, GO.extracellularRegion)] }
    const carried = [{ species: CHEBI.sodium, label: 'Na⁺', inside: 'v_Na_i', outside: 'v_Na_o' }]
    expect(transportedSpecies(sidecar)).toEqual(carried)
  })

  it('reads the toy porter, whose inside flow is a named entity', async () => {
    const sidecar = await parseSidecar(readToy('porter.ttl'), { mathRef: 'porter.cellml:porter', cellml: readToy('porter.cellml') })
    expect(transportedSpecies(sidecar).map((entry) => entry.label)).toEqual(['Na⁺'])
  })

  it('names species as the annotation chips do, and gives the CURIE of others', () => {
    expect(speciesLabel(CHEBI.glucose)).toBe('D-glucose')
    expect(speciesLabel('http://purl.obolibrary.org/obo/CHEBI_29101')).toBe('Na⁺')
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
