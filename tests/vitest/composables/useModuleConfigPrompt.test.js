// @vitest-environment happy-dom
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { useModuleConfigPrompt } from '../../../src/composables/useModuleConfigPrompt.js'
import { buildInstance } from '../../../src/services/import/buildWorkflow.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

const MATH_REF = 'file:decay'
const XML = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="decay">
  <component name="decay">
    <variable name="t" units="second" interface="public_and_private"/>
    <variable name="x" units="metre" initial_value="1"/>
    <variable name="k" units="per_second" initial_value="0.5"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/>
        <apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply>
        <apply><times/><apply><minus/><ci>k</ci></apply><ci>x</ci></apply>
      </apply>
    </math>
  </component>
</model>`
const MODULE = {
  moduleRef: 'decay:base',
  mathRef: MATH_REF,
  ports: [{ label: 'p', portType: 'general_ports', variables: ['x'] }],
  variables: [{ name: 'x', value: null, units: 'metre', access: 'access', type: 'variable' }],
}

describe('useModuleConfigPrompt', () => {
  let library, prompt, nodes

  beforeAll(async () => {
    await ensureLibCellmlReady()
  })

  beforeEach(() => {
    setActivePinia(createPinia())
    library = useLibraryStore()
    library.addMath(MATH_REF, XML)
    library.addModule(structuredClone(MODULE))
    const analysis = library.getMathAnalysis(MATH_REF)
    nodes = ['a', 'b'].map((id) => buildInstance(id, id, null, structuredClone(MODULE), [], null, analysis))
    prompt = useModuleConfigPrompt()
  })

  const edit = (id, ports) => ({ node: nodes.find((node) => node.id === id), ports })

  it('asks about a port deleted from a shared module, naming the new config after the instance', async () => {
    const result = prompt.resolvePortEdits([edit('a', [])], nodes)
    await nextTick()
    expect(prompt.configPrompt.value).toMatchObject({ visible: true, moduleRef: 'decay:base', otherCount: 1, initialName: 'base_a' })
    prompt.resolveConfigPrompt({ action: 'update' })
    expect(await result).toEqual(new Map([['a', { action: 'update' }]]))
  })

  it('makes no change when cancelled', async () => {
    const result = prompt.resolvePortEdits([edit('a', [])], nodes)
    await nextTick()
    prompt.resolveConfigPrompt(null)
    expect(await result).toBeNull()
  })

  it('updates a module alone in use without asking', async () => {
    expect(await prompt.resolvePortEdits([edit('a', [])], [nodes[0]])).toEqual(new Map([['a', { action: 'update' }]]))
    expect(prompt.configPrompt.value.visible).toBe(false)
  })

  it('asks nothing for ports that keep their config', async () => {
    const ports = MODULE.ports.map((port) => ({ ...port, _uid: 'a_1' }))
    expect(await prompt.resolvePortEdits([edit('a', ports), edit('b', MODULE.ports)], nodes)).toEqual(new Map())
  })

  it('checks the other end against the module the first end updated', async () => {
    const result = prompt.resolvePortEdits([edit('a', []), edit('b', [])], nodes)
    await nextTick()
    prompt.resolveConfigPrompt({ action: 'update' })
    expect(await result).toEqual(new Map([['a', { action: 'update' }]]))
  })

  it('counts out an end that moved to a new config, and keeps its name taken', async () => {
    const relabelled = [{ ...MODULE.ports[0], label: 'q' }]
    const result = prompt.resolvePortEdits([edit('a', []), edit('b', relabelled)], nodes)
    await nextTick()
    prompt.resolveConfigPrompt({ action: 'new', moduleRef: 'decay:a_only' })
    expect(await result).toEqual(
      new Map([
        ['a', { action: 'new', moduleRef: 'decay:a_only' }],
        ['b', { action: 'update' }],
      ])
    )
  })
})
