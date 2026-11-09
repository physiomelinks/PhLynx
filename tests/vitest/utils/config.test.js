import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { normaliseConfig } from '../../../src/utils/config.js'

const nkaConfig = () => JSON.parse(readFileSync('tests/resources/parameters/NKA_NKA_modules_config.json', 'utf8'))[0]

describe('normaliseConfig', () => {
  it("keeps the config's default parameterisation", () => {
    expect(normaliseConfig(nkaConfig())).toMatchObject({ moduleRef: 'NKA:NKA', defaultParameterisation: 'NKA' })
  })

  it('adds no default parameterisation when the config names none', () => {
    const { default_parameterisation: _, ...config } = nkaConfig()
    expect(normaliseConfig(config)).not.toHaveProperty('defaultParameterisation')
  })
})
