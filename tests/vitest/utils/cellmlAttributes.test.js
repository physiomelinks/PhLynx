import { describe, expect, it } from 'vitest'

import { getCellmlAttributeNode } from '../../../src/utils/cellml.js'
import { CELLML_NS, MATHML_NS } from '../../../src/utils/constants.js'

const cnsOf = (xml) => [...new DOMParser().parseFromString(xml, 'application/xml').getElementsByTagNameNS(MATHML_NS, 'cn')]

describe('getCellmlAttributeNode', () => {
  it('reads a <cn> number’s units from its parsed cellml:units, which happy-dom leaves un-namespaced', () => {
    const [cn] = cnsOf(`<math xmlns="${MATHML_NS}" xmlns:cellml="${CELLML_NS}"><cn cellml:units="per_millivolt">1</cn></math>`)
    expect(getCellmlAttributeNode(cn, 'units')?.value).toBe('per_millivolt')
  })

  it('reads a namespaced attribute, as a browser parses one', () => {
    const [cn] = cnsOf(`<math xmlns="${MATHML_NS}"><cn>1</cn></math>`)
    cn.setAttributeNS(CELLML_NS, 'c:units', 'millivolt')
    expect(getCellmlAttributeNode(cn, 'units')?.value).toBe('millivolt')
  })

  it('sets the value in place, without adding a second attribute', () => {
    const [cn] = cnsOf(`<math xmlns="${MATHML_NS}" xmlns:cellml="${CELLML_NS}"><cn cellml:units="celsius">1</cn></math>`)
    getCellmlAttributeNode(cn, 'units').value = 'dimensionless'
    const text = new XMLSerializer().serializeToString(cn)
    expect(text.match(/units="[^"]*"/g)).toEqual(['units="dimensionless"'])
  })

  it('finds nothing for a number without units, or with only an unprefixed units attribute', () => {
    const cns = cnsOf(`<math xmlns="${MATHML_NS}"><cn>1</cn><cn units="second">2</cn></math>`)
    expect(cns.map((cn) => getCellmlAttributeNode(cn, 'units'))).toEqual([null, null])
  })
})
