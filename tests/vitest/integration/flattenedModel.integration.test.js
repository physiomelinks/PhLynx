// @vitest-environment happy-dom
import fs from 'node:fs'
import path from 'node:path'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { analyzeMathXml } from '../../../src/services/math/analyzeMath.js'
import { reconcileRows } from '../../../src/services/math/reconcileRows.js'
import { migrateWorkspace } from '../../../src/services/workspaceMigrator.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { resolvePortCouplings } from '../../../src/utils/edges.js'
import { generateFlattenedModel } from '../../../src/utils/cellml.js'
import { interpretUnitExpression } from '../../../src/utils/unitExpression.js'
import { resolveBoundaryValues } from '../../../src/services/export/boundaryValues.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

const MATH_REF = 'file:decay'
// dx/dt = g - k * x. The initialiser is private, as math saved before variables were always public may have.
const XML = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="decay">
  <component name="decay">
    <variable name="t" units="second" interface="public"/>
    <variable name="x" units="dimensionless" initial_value="x_init" interface="public"/>
    <variable name="x_init" units="dimensionless" initial_value="2" interface="private"/>
    <variable name="k" units="per_second" initial_value="0.5"/>
    <variable name="g" units="per_second"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/>
        <apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply>
        <apply><minus/><ci>g</ci><apply><times/><ci>k</ci><ci>x</ci></apply></apply>
      </apply>
    </math>
  </component>
</model>`
const UNITS = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="units">
  <units name="per_second"><unit units="second" exponent="-1"/></units>
</model>`

describe('generateFlattenedModel with values only in the rows', () => {
  let store

  beforeAll(async () => {
    await ensureLibCellmlReady()
  }, 120000)

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    store.addUnitsFile({ componentFile: 'units.cellml', model: UNITS })
    store.addMath(MATH_REF, XML)
    store.assignGlobalConstant('g', '0.1', 'per_second')
  })

  /** A node whose rows are built from the stored math, as a new instance's are. */
  function buildNode(changes = {}) {
    const rows = reconcileRows(analyzeMathXml(store.availableMath.get(MATH_REF)), [{ name: 'g', type: 'global_constant' }], {
      defaults: store.getMathDefaults(MATH_REF),
    }).map((row) => (row.name in changes ? { ...row, value: changes[row.name] } : row))
    return { id: 'n1', type: 'instanceNode', data: { name: 'decay_1', mathRef: MATH_REF, variables: rows, ports: [] } }
  }

  it('initialises the state and constants from the rows, and the result analyses cleanly', async () => {
    const node = buildNode()
    expect(Object.fromEntries(node.data.variables.map((row) => [row.name, row.value]))).toMatchObject({ x_init: '2', k: '0.5' })

    const text = await (await generateFlattenedModel([node], [], store)).text()
    expect(text).toMatch(/<variable name="x" units="dimensionless" initial_value="x_init"/)
    expect(text).toMatch(/<variable name="x_init"[^>]*initial_value="2"/)
    expect(text).toMatch(/<variable name="x_init" units="dimensionless" interface="public"\/>/)
    expect(text).toMatch(/<variable name="k"[^>]*initial_value="0\.5"/)
    expect(text).toMatch(/<variable name="g"[^>]*initial_value="0\.1"/)
  })

  it('names the parameters left without a value', () => {
    expect(() => generateFlattenedModel([buildNode({ k: '' })], [], store)).toThrow(/Missing parameter values: decay_1\.k/)
  })
})

describe('generateFlattenedModel with units made from expressions', () => {
  const FLOW_REF = 'file:flow'
  // dV/dt = Q, in units only the generated units file defines.
  const FLOW_XML = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="flow">
  <component name="flow">
    <variable name="t" units="second" interface="public"/>
    <variable name="V" units="uL" initial_value="1" interface="public"/>
    <variable name="Q" units="uL_per_s" initial_value="2"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>V</ci></apply><ci>Q</ci></apply>
    </math>
  </component>
</model>`

  beforeAll(async () => {
    await ensureLibCellmlReady()
  }, 120000)

  it('imports the generated units, and the result analyses cleanly', async () => {
    setActivePinia(createPinia())
    const store = useLibraryStore()
    const library = { names: store.availableUnitNames, definitions: store.unitDefinitions, expansions: store.unitExpansions }
    for (const text of ['uL', 'uL/s']) store.addGeneratedUnits(interpretUnitExpression(text, library))
    store.addMath(FLOW_REF, FLOW_XML)

    const rows = reconcileRows(analyzeMathXml(store.availableMath.get(FLOW_REF)), [], { defaults: store.getMathDefaults(FLOW_REF) })
    const node = { id: 'n1', type: 'instanceNode', data: { name: 'flow_1', mathRef: FLOW_REF, variables: rows, ports: [] } }

    const text = await (await generateFlattenedModel([node], [], store)).text()
    expect(text).toMatch(/<units name="uL_per_s">/)
    expect(text).toMatch(/<unit (?=[^>]*units="litre")(?=[^>]*prefix="micro")[^>]*\/>/)
  })
})

describe('boundary values in a migrated workspace', () => {
  beforeAll(async () => {
    await ensureLibCellmlReady()
  }, 120000)

  // The full export of this workspace also fails on main ("The model is not fully defined"), so this
  // checks the boundary conditions it hands to generateFlattenedModel instead.
  it('sets each boundary condition group once, from the module that supplies it', () => {
    setActivePinia(createPinia())
    const file = path.resolve(process.cwd(), 'tests/resources/migration-versioning/legacy/tran_hund_coupled.json')
    const migrated = migrateWorkspace(JSON.parse(fs.readFileSync(file, 'utf8')))

    // Legacy edges have no couplings yet; the workspace resolves them on load, in this order.
    const { nodes, edges } = migrated.flow
    const nodeById = new Map(nodes.map((node) => [node.id, node]))
    const outCount = new Map()
    const inCount = new Map()
    for (const edge of edges) {
      const sourceIndex = outCount.get(edge.source) ?? 0
      const targetIndex = inCount.get(edge.target) ?? 0
      const couplings = resolvePortCouplings(
        nodeById.get(edge.source).data.ports ?? [],
        nodeById.get(edge.target).data.ports ?? [],
        sourceIndex,
        targetIndex
      )
      edge.data = { ...edge.data, couplings }
      outCount.set(edge.source, sourceIndex + 1)
      inCount.set(edge.target, targetIndex + 1)
    }

    const { supplied, missing, conflicts } = resolveBoundaryValues(nodes, edges)
    const environment = nodes.find((node) => node.data.name === 'Environment')
    expect(conflicts).toEqual([])
    expect(missing.size).toBe(0)
    expect([...supplied.get(environment.id)]).toEqual(expect.arrayContaining(['Na_o', 'Cl_o']))
    const suppliedNa = [...supplied.values()].filter((names) => names.has('Na_o'))
    expect(suppliedNa).toHaveLength(1)
  })
})

// A hub whose q drains through v_sum into leaves, each passing on a flow v = k * u of the hub's u.
const HUB_XML = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="hub">
  <component name="hub">
    <variable name="t" units="second" interface="public"/>
    <variable name="q" units="dimensionless" initial_value="q_init" interface="public"/>
    <variable name="q_init" units="dimensionless" initial_value="1" interface="public"/>
    <variable name="v_sum" units="per_second" interface="public"/>
    <variable name="u" units="dimensionless" interface="public"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/>
        <apply><diff/><bvar><ci>t</ci></bvar><ci>q</ci></apply>
        <apply><minus/><ci>v_sum</ci></apply>
      </apply>
      <apply><eq/><ci>u</ci><ci>q</ci></apply>
    </math>
  </component>
</model>`
const LEAF_XML = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="leaf">
  <component name="leaf">
    <variable name="u" units="dimensionless" interface="public"/>
    <variable name="v" units="per_second" interface="public"/>
    <variable name="k" units="per_second" initial_value="0.5" interface="public"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/><ci>v</ci><apply><times/><ci>k</ci><ci>u</ci></apply></apply>
    </math>
  </component>
</model>`

describe('generateFlattenedModel multiport couplings', () => {
  let store

  beforeAll(async () => {
    await ensureLibCellmlReady()
  }, 120000)

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    store.addUnitsFile({ componentFile: 'units.cellml', model: UNITS })
    store.addMath('file:hub', HUB_XML)
    store.addMath('file:leaf', LEAF_XML)
  })

  /** A node built from the stored math, its port inputs typed as boundary conditions. */
  function buildNode(id, mathRef, ports, values = {}) {
    const portVariables = new Set(ports.flatMap((port) => port.variables))
    const rows = reconcileRows(analyzeMathXml(store.availableMath.get(mathRef)), [], {
      defaults: store.getMathDefaults(mathRef),
    }).map((row) => ({
      ...row,
      type: row.type === 'constant' && portVariables.has(row.name) ? 'boundary_condition' : row.type,
      ...(row.name in values && { value: values[row.name] }),
    }))
    return { id, type: 'instanceNode', data: { name: id, mathRef, variables: rows, ports } }
  }

  /** An edge between two nodes, coupling their first ports of each label. */
  function connect(source, target, id = `${source.id}_${target.id}`) {
    return { id, source: source.id, target: target.id, data: { couplings: resolvePortCouplings(source.data.ports, target.data.ports) } }
  }

  const leafPorts = () => [
    { portType: 'entrance_ports', label: 'flow', variables: ['v'], multiportType: 'None' },
    { portType: 'entrance_ports', label: 'pressure', variables: ['u'], multiportType: 'None' },
  ]

  const vesselPort = (portType, variables, multiportType, multiplyFactor) => ({
    portType,
    label: 'vessel',
    variables,
    multiportType,
    ...(multiplyFactor !== undefined && { multiplyFactor }),
  })

  const flatten = async (nodes, edges) => (await generateFlattenedModel(nodes, edges, store)).text()

  /** The MathML of a generated component. */
  const componentOf = (text, name) => text.match(new RegExp(`<component name="${name}">[\\s\\S]*?</component>`))?.[0] ?? ''

  /** The MathML of the generated summation component. */
  const summationMath = async (nodes, edges) => componentOf(await flatten(nodes, edges), 'generated_summations')

  afterEach(() => vi.restoreAllMocks())

  it('adds every term of a Sum port on the source side of its edges', async () => {
    const hub = buildNode('hub', 'file:hub', [
      { portType: 'exit_ports', label: 'flow', variables: ['v_sum'], multiportType: 'Sum' },
      { portType: 'exit_ports', label: 'pressure', variables: ['u'], multiportType: 'True' },
    ])
    const leaves = ['leaf_1', 'leaf_2'].map((id) => buildNode(id, 'file:leaf', leafPorts()))

    const math = await summationMath([hub, ...leaves], leaves.map((leaf) => connect(hub, leaf)))
    expect(math).toMatch(/<plus\/>/)
    expect(math).not.toMatch(/<minus\/>/)
    expect(math.match(/<ci>op_v[^<]*<\/ci>/g)).toHaveLength(2)
  })

  it('sums one variable of a per-variable port and shares the other', async () => {
    const hub = buildNode('hub', 'file:hub', [vesselPort('exit_ports', ['v_sum', 'u'], ['sum', 'True'])])
    const leaves = ['leaf_1', 'leaf_2'].map((id) => buildNode(id, 'file:leaf', [vesselPort('entrance_ports', ['v', 'u'], 'None')]))

    const math = await summationMath([hub, ...leaves], leaves.map((leaf) => connect(hub, leaf)))
    expect(math).toMatch(/<plus\/>/)
    expect(math).not.toMatch(/<minus\/>/)
    expect(math.match(/<ci>op_v[^<]*<\/ci>/g)).toHaveLength(2)
  })

  it.each([
    ['per-variable', [vesselPort('exit_ports', ['v_sum', 'u'], ['sum', 'True'])]],
    ['whole-port', [{ portType: 'exit_ports', label: 'flow', variables: ['v_sum'], multiportType: 'Sum' }]],
  ])('sets a blank %s Sum variable nothing is connected to to 0, with a warning', async (_, ports) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const math = await summationMath([buildNode('hub', 'file:hub', ports)], [])
    expect(math).toMatch(/<cn cellml:units="per_second">0<\/cn>/)
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/"hub" variable "v_sum" sums over its connections/))
  })

  it('uses the value of a Sum variable nothing is connected to', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const hub = buildNode('hub', 'file:hub', [vesselPort('exit_ports', ['v_sum', 'u'], ['sum', 'True'])], { v_sum: '0.25' })
    const text = await flatten([hub], [])
    expect(componentOf(text, 'generated_summations')).toBe('')
    expect(text).toMatch(/<variable name="v_sum"[^>]*initial_value="0\.25"/)
    expect(warn).not.toHaveBeenCalled()
  })

  it('multiplies a variable on either end of the edge by its own factor', async () => {
    const hub = buildNode('hub', 'file:hub', [vesselPort('exit_ports', ['v_sum', 'u'], ['None', 'multiply'], [null, 3])])
    const leaf = buildNode('leaf', 'file:leaf', [vesselPort('entrance_ports', ['v', 'u'], ['multiply', 'None'], [2, null])])

    const math = componentOf(await flatten([hub, leaf], [connect(hub, leaf)]), 'generated_multiplications')
    expect(math).toMatch(/<ci>scaled_v<\/ci>\s*<apply>\s*<times\/>\s*<cn cellml:units="dimensionless">2<\/cn>/)
    expect(math).toMatch(/<ci>scaled_u<\/ci>\s*<apply>\s*<times\/>\s*<cn cellml:units="dimensionless">3<\/cn>/)
  })

  it('adds multiplied variables to a sum', async () => {
    const hub = buildNode('hub', 'file:hub', [vesselPort('exit_ports', ['v_sum', 'u'], ['sum', 'True'])])
    const leaves = ['leaf_1', 'leaf_2'].map((id) =>
      buildNode(id, 'file:leaf', [vesselPort('entrance_ports', ['v', 'u'], ['multiply', 'None'], 2)])
    )

    const math = await summationMath([hub, ...leaves], leaves.map((leaf) => connect(hub, leaf)))
    expect(math.match(/<ci>op_scaled_v[^<]*<\/ci>/g)).toHaveLength(2)
    expect(math).not.toMatch(/<minus\/>/)
  })

  it.each([
    [['sum', 'True'], ['sum', 'None'], /"v_sum" and "v" are both Sum variables/],
    [['multiply', 'True'], ['multiply', 'None'], /"v_sum" and "v" are both Multiply variables/],
  ])('rejects a pair %j to %j', (hubTypes, leafTypes, message) => {
    const hub = buildNode('hub', 'file:hub', [vesselPort('exit_ports', ['v_sum', 'u'], hubTypes)])
    const leaf = buildNode('leaf', 'file:leaf', [vesselPort('entrance_ports', ['v', 'u'], leafTypes)])
    expect(() => generateFlattenedModel([hub, leaf], [connect(hub, leaf)], store)).toThrow(message)
  })

  it('rejects a sum between ports with different numbers of variables', () => {
    const hub = buildNode('hub', 'file:hub', [vesselPort('exit_ports', ['v_sum', 'u'], ['sum', 'True'])])
    const leaf = buildNode('leaf', 'file:leaf', [vesselPort('entrance_ports', ['v'], 'None')], { u: '1' })
    expect(() => generateFlattenedModel([hub, leaf], [connect(hub, leaf)], store)).toThrow(/same number of variables/)
  })

  it('rejects a variable summed through two ports', () => {
    const hub = buildNode('hub', 'file:hub', [
      { portType: 'exit_ports', label: 'flow', variables: ['v_sum'], multiportType: 'Sum' },
      { portType: 'exit_ports', label: 'drain', variables: ['v_sum'], multiportType: 'Sum' },
    ])
    const leaves = ['leaf_1', 'leaf_2'].map((id) => buildNode(id, 'file:leaf', leafPorts(), { u: '1' }))
    const edges = leaves.map((leaf, i) => ({
      id: `e${i}`,
      source: hub.id,
      target: leaf.id,
      data: { couplings: [{ sourcePort: hub.data.ports[i], targetPort: leaf.data.ports[0] }] },
    }))
    expect(() => generateFlattenedModel([hub, ...leaves], edges, store)).toThrow(
      '"hub" sums "v_sum" through ports "flow" and "drain"; a variable can be summed through one port only.'
    )
  })
})
