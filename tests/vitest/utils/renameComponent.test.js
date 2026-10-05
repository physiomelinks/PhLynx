// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { renameLayoutComponent, renameModelComponent } from '../../../src/utils/cellml'

const MODEL = `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.cellml.org/cellml/2.0#" name="m">
  <component name="new_module"><variable name="x" units="dimensionless" interface="public"/></component>
  <component name="other"><variable name="x" units="dimensionless" interface="public"/></component>
  <encapsulation><component_ref component="other"><component_ref component="new_module"/></component_ref></encapsulation>
  <connection component_1="new_module" component_2="other"><map_variables variable_1="x" variable_2="x"/></connection>
</model>`

function attributes(xml, tag, attribute) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  return Array.from(doc.getElementsByTagName(tag)).map((el) => el.getAttribute(attribute))
}

describe('renameModelComponent', () => {
  it('renames the component and every reference to it, leaving other components alone', () => {
    const renamed = renameModelComponent(MODEL, 'new_module', 'my_comp')
    expect(attributes(renamed, 'component', 'name')).toEqual(['my_comp', 'other'])
    expect(attributes(renamed, 'component_ref', 'component')).toEqual(['other', 'my_comp'])
    expect(attributes(renamed, 'connection', 'component_1')).toEqual(['my_comp'])
    expect(attributes(renamed, 'connection', 'component_2')).toEqual(['other'])
  })
})

describe('renameLayoutComponent', () => {
  it('renames the component and its model block, keeping their comments', () => {
    const layout = {
      format: 'f',
      version: 1,
      model: { blocks: [{ kind: 'units', name: 'new_module' }, { kind: 'comp', name: 'new_module' }], footer: [] },
      components: [{ name: 'new_module', trailing: '// note', statements: [], footer: [] }],
    }
    const renamed = renameLayoutComponent(layout, 'new_module', 'my_comp')
    expect(renamed.components[0]).toMatchObject({ name: 'my_comp', trailing: '// note' })
    expect(renamed.model.blocks).toEqual([{ kind: 'units', name: 'new_module' }, { kind: 'comp', name: 'my_comp' }])
    expect(layout.components[0].name).toBe('new_module')
  })

  it('passes an empty layout through', () => {
    expect(renameLayoutComponent(null, 'a', 'b')).toBeNull()
  })
})
