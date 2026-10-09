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
import { multiportSummary } from '../../../src/utils/multiport.js'
import { interpretUnitExpression } from '../../../src/utils/unitExpression.js'
import { resolveBoundaryValues } from '../../../src/services/export/boundaryValues.js'
import { applyParameterOverrides, buildScopedModel, checkScope, resolveScope } from '../../../src/services/simulation/scopedModel.js'
import { buildVariableMapping, mapInspectionModules, mappingKey, readNodeSeries } from '../../../src/services/simulation/variableMapping.js'
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
// A tank filled through v_in: dq/dt = v_in - q.
const TANK_XML = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="tank">
  <component name="tank">
    <variable name="t" units="second" interface="public"/>
    <variable name="q" units="dimensionless" initial_value="q_init" interface="public"/>
    <variable name="q_init" units="dimensionless" initial_value="0" interface="public"/>
    <variable name="v_in" units="per_second" interface="public"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/>
        <apply><diff/><bvar><ci>t</ci></bvar><ci>q</ci></apply>
        <apply><minus/><ci>v_in</ci><apply><times/><cn cellml:units="per_second" xmlns:cellml="http://www.cellml.org/cellml/2.0#">1</cn><ci>q</ci></apply></apply>
      </apply>
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

  it('summarises the same sum the export builds', async () => {
    const hub = buildNode('hub', 'file:hub', [vesselPort('exit_ports', ['v_sum', 'u'], ['sum', 'True'])])
    const leaves = [
      buildNode('leaf_1', 'file:leaf', [vesselPort('entrance_ports', ['v', 'u'], ['multiply', 'None'], 2)]),
      buildNode('leaf_2', 'file:leaf', [vesselPort('entrance_ports', ['v', 'u'], 'None')]),
    ]
    const edges = leaves.map((leaf) => connect(hub, leaf))
    const ownPorts = hub.data.ports.map((port) => ({ original: port, current: port }))

    const [entry] = multiportSummary('hub', edges, { ownPorts })
    const math = await summationMath([hub, ...leaves], edges)
    expect(math.match(/<ci>op_[^<]*<\/ci>/g)).toHaveLength(entry.terms.length)
    expect(math.match(/<ci>op_scaled_v[^<]*<\/ci>/g)).toHaveLength(entry.terms.filter((term) => term.factor === 2).length)
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

describe('scoped models', () => {
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

  afterEach(() => vi.restoreAllMocks())

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

  /** A hub summing the flows of two leaves, each given the hub's pressure. */
  function buildNetwork(leafValues = {}) {
    const hub = buildNode('hub', 'file:hub', [
      { portType: 'exit_ports', label: 'vessel', variables: ['v_sum', 'u'], multiportType: ['sum', 'True'] },
    ])
    const leaves = ['leaf_1', 'leaf_2'].map((id) =>
      buildNode(id, 'file:leaf', [{ portType: 'entrance_ports', label: 'vessel', variables: ['v', 'u'], multiportType: 'None' }], leafValues)
    )
    const edges = leaves.map((leaf) => ({
      id: `hub_${leaf.id}`,
      source: hub.id,
      target: leaf.id,
      data: { couplings: resolvePortCouplings(hub.data.ports, leaf.data.ports) },
    }))
    return { nodes: [hub, ...leaves], edges }
  }

  const componentOf = (text, name) => text.match(new RegExp(`<component name="${name}">[\\s\\S]*?</component>`))?.[0] ?? ''

  it('stops a selection with nothing to integrate, which the build would reject', () => {
    const { nodes, edges } = buildNetwork()
    const scope = resolveScope(['leaf_1'], nodes, edges)
    const report = checkScope(scope, store)

    expect(report.errors).toEqual([expect.stringMatching(/no instance in this selection has a differential equation/i)])
    expect(report.zeroedBoundaries).toEqual([{ nodeId: 'leaf_1', nodeName: 'leaf_1', variableName: 'u' }])
    expect(report.canBuild).toBe(false)
    expect(() => buildScopedModel(scope, store)).toThrow()
  })

  it('sets a boundary condition the cut leaves without a value to 0', async () => {
    store.addMath('file:tank', TANK_XML)
    const tank = buildNode('tank', 'file:tank', [{ portType: 'entrance_ports', label: 'inflow', variables: ['v_in'], multiportType: 'None' }])
    const source = buildNode('source', 'file:hub', [{ portType: 'exit_ports', label: 'inflow', variables: ['u'], multiportType: 'None' }])
    const edges = [{ id: 'e', source: 'source', target: 'tank', data: { couplings: resolvePortCouplings(source.data.ports, tank.data.ports) } }]
    const scope = resolveScope(['tank'], [source, tank], edges)

    const report = checkScope(scope, store)
    expect(report.canBuild).toBe(true)
    expect(report.zeroedBoundaries).toEqual([{ nodeId: 'tank', nodeName: 'tank', variableName: 'v_in' }])

    const text = await buildScopedModel(scope, store).text()
    expect(text).toMatch(/<variable name="v_in"[^>]*initial_value="0"/)
    expect(tank.data.variables.find((row) => row.name === 'v_in').value).toBeFalsy()
  })

  it('flattens a single instance on its own', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { nodes, edges } = buildNetwork()
    const scope = resolveScope(['hub'], nodes, edges)
    expect(checkScope(scope, store).canBuild).toBe(true)

    const text = await buildScopedModel(scope, store).text()
    expect(text).toMatch(/<component name="hub">/)
    expect(text).not.toMatch(/<component name="leaf_/)
  })

  it('sums only the terms inside the scope, and warns about the one left out', async () => {
    const { nodes, edges } = buildNetwork()
    const scope = resolveScope(['hub', 'leaf_1'], nodes, edges)

    const report = checkScope(scope, store)
    expect(report.canBuild).toBe(true)
    expect(report.lostSumTerms).toEqual([{ nodeId: 'hub', nodeName: 'hub', variableName: 'v_sum', lost: 1 }])

    const math = componentOf(await buildScopedModel(scope, store).text(), 'generated_summations')
    expect(math.match(/<ci>op_v[^<]*<\/ci>/g)).toHaveLength(1)
  })

  it('keeps an inspection module’s variables inside the scope', async () => {
    const { nodes, edges } = buildNetwork()
    const total = {
      name: 'total_flow',
      units: 'per_second',
      variables: ['leaf_1', 'leaf_2'].map((nodeId) => ({ nodeId, variableName: 'v', units: 'per_second', sign: 1 })),
    }
    const scope = resolveScope(['hub', 'leaf_1'], nodes, edges, [total])
    expect(scope.trimmedModules).toEqual([{ name: 'total_flow', removed: 1, isLeftOut: false }])

    const math = componentOf(await buildScopedModel(scope, store).text(), 'inspection_modules')
    expect(math.match(/<variable name="op_v[^"]*"/g)).toHaveLength(1)
  })

  it('stops an empty selection, which the build would reject', () => {
    const scope = resolveScope([], [], [])
    expect(checkScope(scope, store).canBuild).toBe(false)
    expect(() => buildScopedModel(scope, store)).toThrow()
  })

  it('flattens the whole model as the scope of every node', async () => {
    const { nodes, edges } = buildNetwork()
    const scope = resolveScope(null, nodes, edges)
    expect(checkScope(scope, store).lostSumTerms).toEqual([])

    const math = componentOf(await buildScopedModel(scope, store).text(), 'generated_summations')
    expect(math.match(/<ci>op_v[^<]*<\/ci>/g)).toHaveLength(2)
  })
})

describe('mapping a scoped run’s results back to instances', () => {
  let store, libcellml

  beforeAll(async () => {
    ;({ instance: libcellml } = await ensureLibCellmlReady())
  }, 120000)

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    store.addUnitsFile({ componentFile: 'units.cellml', model: UNITS })
    store.addMath('file:hub', HUB_XML)
    store.addMath('file:leaf', LEAF_XML)
  })

  /** A hub summing the flows of two leaves, each given the hub's pressure, flattened as a scope. */
  async function buildFlattenedNetwork() {
    const node = (id, mathRef, ports) => ({
      id,
      type: 'instanceNode',
      data: {
        name: id,
        mathRef,
        // Port inputs are boundary conditions, as the editor types them.
        variables: reconcileRows(analyzeMathXml(store.availableMath.get(mathRef)), [], { defaults: store.getMathDefaults(mathRef) }).map((row) =>
          row.type === 'constant' && ports.some((port) => port.variables.includes(row.name)) ? { ...row, type: 'boundary_condition' } : row
        ),
        ports,
      },
    })
    const hub = node('hub', 'file:hub', [{ portType: 'exit_ports', label: 'vessel', variables: ['v_sum', 'u'], multiportType: ['sum', 'True'] }])
    const leaves = ['leaf_1', 'leaf_2'].map((id) => node(id, 'file:leaf', [{ portType: 'entrance_ports', label: 'vessel', variables: ['v', 'u'], multiportType: 'None' }]))
    const edges = leaves.map((leaf) => ({ id: `hub_${leaf.id}`, source: 'hub', target: leaf.id, data: { couplings: resolvePortCouplings(hub.data.ports, leaf.data.ports) } }))
    const scope = resolveScope(null, [hub, ...leaves], edges)
    return { scope, cellml: await buildScopedModel(scope, store).text() }
  }

  /** Results reporting values under the given names, as the engine returns them. */
  const resultsFor = (names) => ({
    voi: { name: 'environment/time', unit: 'second', values: new Float64Array([0, 1]) },
    variables: new Map(names.map((name, i) => [name, { kind: 'algebraic', unit: '', values: new Float64Array([i, i]) }])),
  })

  it('maps each row to whichever member of its equivalent variables the run reported', async () => {
    const { scope, cellml } = await buildFlattenedNetwork()
    const results = resultsFor(['hub/q', 'hub/u', 'leaf_1/v', 'leaf_2/v', 'instance_parameters/leaf_1_k', 'instance_parameters/leaf_2_k'])

    const mapping = buildVariableMapping({ libcellml, cellml, nodes: scope.nodes, results })

    expect(mapping.get(mappingKey('hub', 't'))).toBe('environment/time')
    expect(mapping.get(mappingKey('hub', 'u'))).toBe('hub/u')
    expect(mapping.get(mappingKey('leaf_1', 'u'))).toBe('hub/u')
    expect(mapping.get(mappingKey('leaf_2', 'u'))).toBe('hub/u')
    expect(mapping.get(mappingKey('leaf_1', 'v'))).toBe('leaf_1/v')
    expect(mapping.get(mappingKey('leaf_2', 'k'))).toBe('instance_parameters/leaf_2_k')
    expect(readNodeSeries(results, mapping, 'leaf_2', 'u')).toMatchObject({ name: 'hub/u', kind: 'algebraic' })
    expect(readNodeSeries(results, mapping, 'hub', 't')).toMatchObject({ name: 'environment/time', kind: 'voi' })
  })

  it('follows the run when it reports another member of the same variables', async () => {
    const { scope, cellml } = await buildFlattenedNetwork()
    const results = resultsFor(['hub/q', 'leaf_2/u'])

    const mapping = buildVariableMapping({ libcellml, cellml, nodes: scope.nodes, results })

    expect(mapping.get(mappingKey('hub', 'u'))).toBe('leaf_2/u')
    expect(mapping.get(mappingKey('leaf_1', 'u'))).toBe('leaf_2/u')
  })

  it('finds each inspection module’s output under the name the flatten gave it', async () => {
    const { scope } = await buildFlattenedNetwork()
    const sumOfLeaves = (name) => ({
      id: name,
      name,
      units: 'per_second',
      variables: ['leaf_1', 'leaf_2'].map((nodeId) => ({ nodeId, variableName: 'v', units: 'per_second', sign: 1 })),
    })
    // The second module's name collides with the first's terms, op_v and op_v_1.
    const modules = [sumOfLeaves('total flow'), sumOfLeaves('op_v')]
    const scoped = resolveScope(null, scope.nodes, scope.internalEdges, modules)
    const text = await buildScopedModel(scoped, store).text()
    const inspection = text.match(/<component name="inspection_modules">[\s\S]*?<\/component>/)[0]
    const declared = [...inspection.matchAll(/<variable name="([^"]+)"/g)].map(([, name]) => `inspection_modules/${name}`)
    const results = resultsFor(declared)

    const outputs = mapInspectionModules(scoped.inspectionModules, scoped.nodes, results)

    expect(outputs).toEqual([
      { id: 'total flow', name: 'total flow', units: 'per_second', reportedName: 'inspection_modules/total_flow' },
      { id: 'op_v', name: 'op_v', units: 'per_second', reportedName: 'inspection_modules/op_v_2' },
    ])
    expect(mapInspectionModules(scoped.inspectionModules, scoped.nodes, resultsFor([]))).toEqual([])
  })

  it('leaves out rows whose values the run didn’t report', async () => {
    const { scope, cellml } = await buildFlattenedNetwork()
    const results = resultsFor(['hub/q'])

    const mapping = buildVariableMapping({ libcellml, cellml, nodes: scope.nodes, results })

    expect(mapping.has(mappingKey('leaf_1', 'v'))).toBe(false)
    expect(readNodeSeries(results, mapping, 'leaf_1', 'v')).toBeNull()
    expect(readNodeSeries(results, mapping, 'missing', 'v')).toBeNull()
  })
})

describe('trying out parameter values', () => {
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

  /** A decay node with its rows from the math, as a new instance has. */
  function buildNode() {
    const rows = reconcileRows(analyzeMathXml(store.availableMath.get(MATH_REF)), [{ name: 'g', type: 'global_constant' }], {
      defaults: store.getMathDefaults(MATH_REF),
    })
    return { id: 'n1', type: 'instanceNode', data: { name: 'decay_1', mathRef: MATH_REF, variables: rows, ports: [] } }
  }

  it('flattens with overridden constants, initial values and global constants, changing neither', async () => {
    const node = buildNode()
    const scope = resolveScope(null, [node], [])
    const overrides = { rows: new Map([['n1::k', 0.9], ['n1::x_init', 4]]), globals: new Map([['g', 0.3]]) }

    const applied = applyParameterOverrides(scope, store, overrides)
    const text = await buildScopedModel(applied.scope, applied.libraryStore).text()

    expect(text).toMatch(/<variable name="k"[^>]*initial_value="0\.9"/)
    expect(text).toMatch(/<variable name="x_init"[^>]*initial_value="4"/)
    expect(text).toMatch(/<variable name="g"[^>]*initial_value="0\.3"/)
    expect(node.data.variables.find((row) => row.name === 'k').value).toBe('0.5')
    expect(store.getGlobalConstant('g').value).toBe('0.1')
  })

  it('leaves the scope and library as they are without overrides', () => {
    const scope = resolveScope(null, [buildNode()], [])
    const applied = applyParameterOverrides(scope, store)
    expect(applied.scope.nodes[0]).toBe(scope.nodes[0])
    expect(applied.libraryStore).toBe(store)
  })
})
