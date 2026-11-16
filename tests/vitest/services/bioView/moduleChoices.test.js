import { describe, expect, it } from 'vitest'

import { moduleChoices } from '../../../../src/services/bioView/moduleChoices.js'
import { NEW_INSTANCE_MODULE_REF } from '../../../../src/utils/constants.js'

describe('module choices', () => {
  it('offers a new module first, then modules of the kind wanted, then the rest, each by reference', () => {
    const modules = [
      { moduleRef: 'b:lib', mathRef: 'f:b' },
      { moduleRef: 'lumen:lib', mathRef: 'f:lumen' },
      { moduleRef: NEW_INSTANCE_MODULE_REF, mathRef: 'template_modules.cellml:new_module' },
      { moduleRef: 'a:lib', mathRef: 'f:a' },
      { moduleRef: 'ghost:lib' },
    ]
    const kindOf = (module) => (module.moduleRef === 'lumen:lib' ? 'compartment' : null)
    expect(moduleChoices(modules, kindOf, 'compartment')).toEqual([
      { moduleRef: NEW_INSTANCE_MODULE_REF, label: NEW_INSTANCE_MODULE_REF, match: false },
      { moduleRef: 'lumen:lib', label: 'lumen:lib (compartment)', match: true },
      { moduleRef: 'a:lib', label: 'a:lib', match: false },
      { moduleRef: 'b:lib', label: 'b:lib', match: false },
    ])
  })
})
