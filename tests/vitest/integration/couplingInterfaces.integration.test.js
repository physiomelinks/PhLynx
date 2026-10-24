import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildInstance } from '../../../src/services/import/buildWorkflow.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { generateFlattenedModel, processCellMLData } from '../../../src/utils/cellml.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

// Math with no interfaces, as bg2cellml writes it and some imported CellML has it: a connection between two instances
// must make both ends public, or libcellml finds "Variable ... has no interface type set".
const MATH_FILE = 'no_interfaces.cellml'
const MATH = `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.cellml.org/cellml/2.0#" name="no_interfaces">
  <units name="celsius"><unit units="kelvin"/></units>
  <component name="decay">
    <variable name="t" units="second"/>
    <variable name="x" units="dimensionless" initial_value="1"/>
    <variable name="tau" units="second" initial_value="2"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/>
        <apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply>
        <apply><minus/><apply><divide/><ci>x</ci><ci>tau</ci></apply></apply>
      </apply>
    </math>
  </component>
  <component name="readout">
    <variable name="y" units="dimensionless"/>
    <variable name="z" units="dimensionless"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML" xmlns:cellml="http://www.cellml.org/cellml/2.0#">
      <apply><eq/><ci>z</ci><apply><times/><cn cellml:units="dimensionless">2</cn><ci>y</ci></apply></apply>
    </math>
  </component>
  <component name="celsius_source">
    <variable name="T0" units="celsius" initial_value="37"/>
    <variable name="T" units="celsius"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/><ci>T</ci><ci>T0</ci></apply>
    </math>
  </component>
  <component name="celsius_readout">
    <variable name="y" units="celsius"/>
    <variable name="z" units="celsius"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/><ci>z</ci><ci>y</ci></apply>
    </math>
  </component>
  <component name="kelvin_source">
    <variable name="T0" units="kelvin" initial_value="310"/>
    <variable name="T" units="kelvin"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/><ci>T</ci><ci>T0</ci></apply>
    </math>
  </component>
</model>
`

const port = (variable, multiportType, multiplyFactor) => ({
  portType: 'general_ports',
  label: 'link',
  variables: [variable],
  multiportType,
  ...(multiplyFactor == null ? {} : { multiplyFactor }),
})

describe('connections between math with no interfaces', () => {
  let store

  beforeAll(async () => {
    await ensureLibCellmlReady()
  }, 120000)

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    const result = processCellMLData(MATH)
    expect(result.type).toBe('success')
    store.addMathFile(MATH_FILE, result.components)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** An instance of one of the file's components, with the given ports; a port's input is a boundary condition. */
  function makeNode(id, componentName, ports) {
    const mathRef = `${MATH_FILE}:${componentName}`
    const module = { ...[...store.availableModules.values()].find((m) => m.mathRef === mathRef), ports }
    const node = buildInstance(id, id, 'instanceNode', module, [], null, store.getMathAnalysis(mathRef), store.getMathDefaults(mathRef))
    for (const row of node.data.variables) if (row.name === 'y') row.type = 'boundary_condition'
    return node
  }

  const edge = (source, target) => ({
    id: `${source.id}--${target.id}`,
    source: source.id,
    target: target.id,
    data: { couplings: [{ sourcePort: source.data.ports[0], targetPort: target.data.ports[0] }] },
  })

  /** Flattens with libcellml's validator and analyser, which throw on any issue, and returns the CellML. */
  const flatten = async (nodes, edges) => generateFlattenedModel(nodes, edges, store, [], { check: true }).text()

  it('connects a plain link', async () => {
    const source = makeNode('source', 'decay', [port('x', 'None')])
    const target = makeNode('target', 'readout', [port('y', 'None')])
    await expect(flatten([source, target], [edge(source, target)])).resolves.toContain('<component name="target">')
  })

  it('connects through a Sum', async () => {
    const a = makeNode('a', 'decay', [port('x', 'True')])
    const b = makeNode('b', 'decay', [port('x', 'True')])
    const total = makeNode('total', 'readout', [port('y', 'Sum')])
    await expect(flatten([a, b, total], [edge(a, total), edge(b, total)])).resolves.toContain('generated_summations')
  })

  it('connects through a Multiply', async () => {
    const source = makeNode('source', 'decay', [port('x', 'Multiply', 2)])
    const target = makeNode('target', 'readout', [port('y', 'None')])
    await expect(flatten([source, target], [edge(source, target)])).resolves.toContain('generated_multiplications')
  })

  it('connects through an affine conversion', async () => {
    const source = makeNode('source', 'kelvin_source', [port('T', 'None')])
    const target = makeNode('target', 'celsius_readout', [port('y', 'None')])
    await expect(flatten([source, target], [edge(source, target)])).resolves.toContain('<component name="target">')
  })

  it('connects one affine unit to itself', async () => {
    const source = makeNode('source', 'celsius_source', [port('T', 'None')])
    const target = makeNode('target', 'celsius_readout', [port('y', 'None')])
    await expect(flatten([source, target], [edge(source, target)])).resolves.toContain('<component name="target">')
  })
})
