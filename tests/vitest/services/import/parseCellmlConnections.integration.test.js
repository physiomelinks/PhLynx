import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { parseCellMLConnections } from '../../../../src/services/import/parseCellmlConnections.js'
import { patchUnderscoreTagSelectors } from '../../helpers/happyDom.js'
import { ensureLibCellmlReady } from '../../helpers/libcellml-bootstrap.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const modelFixturePath = path.resolve(__dirname, '../../../resources/model.cellml')

const MATHML = 'xmlns="http://www.w3.org/1998/Math/MathML"'

// Two components: `a` computes x (owns it), `b` imports it. `environment` supplies time.
const CELLML2_CONNECTED = `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.cellml.org/cellml/2.0#" name="m">
  <component name="environment">
    <variable name="time" units="second" interface="public"/>
  </component>
  <component name="a">
    <variable name="t" units="second" interface="public"/>
    <variable name="x" units="dimensionless" interface="public"/>
    <math ${MATHML}>
      <apply><eq/><ci>x</ci><cn>2</cn></apply>
    </math>
  </component>
  <component name="b">
    <variable name="t" units="second" interface="public"/>
    <variable name="x_in" units="dimensionless" interface="public"/>
    <variable name="y" units="dimensionless" initial_value="0"/>
  </component>
  <component name="lonely">
    <variable name="z" units="dimensionless"/>
  </component>
  <connection component_1="environment" component_2="a">
    <map_variables variable_1="time" variable_2="t"/>
  </connection>
  <connection component_1="environment" component_2="b">
    <map_variables variable_1="time" variable_2="t"/>
  </connection>
  <connection component_1="a" component_2="b">
    <map_variables variable_1="x" variable_2="x_in"/>
    <map_variables variable_1="t" variable_2="t"/>
  </connection>
</model>`

const CELLML1_CONNECTED = `<?xml version="1.0"?>
<model xmlns="http://www.cellml.org/cellml/1.1#" name="m1">
  <component name="environment">
    <variable name="time" units="second" interface="public"/>
  </component>
  <component name="src">
    <variable name="out" units="dimensionless" interface="public" initial_value="1"/>
  </component>
  <component name="dst">
    <variable name="inp" units="dimensionless" interface="public"/>
  </component>
  <connection>
    <map_components component_1="src" component_2="dst"/>
    <map_variables variable_1="out" variable_2="inp"/>
  </connection>
</model>`

const CELLML2_NO_CONNECTIONS = `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.cellml.org/cellml/2.0#" name="m">
  <component name="a"><variable name="x" units="dimensionless"/></component>
  <component name="b"><variable name="y" units="dimensionless"/></component>
</model>`

const CELLML1_NO_CONNECTIONS = `<?xml version="1.0"?>
<model xmlns="http://www.cellml.org/cellml/1.1#" name="m">
  <component name="a"><variable name="x" units="dimensionless"/></component>
</model>`

describe('parseCellMLConnections (real libCellML-validated models)', () => {
  let libcellml
  let restoreSelectors

  beforeAll(async () => {
    restoreSelectors = patchUnderscoreTagSelectors()
    ;({ instance: libcellml } = await ensureLibCellmlReady())
  }, 120000)

  afterAll(() => restoreSelectors?.())

  it('uses inline CellML 2.0 that libCellML itself parses without errors', () => {
    for (const content of [CELLML2_CONNECTED, CELLML2_NO_CONNECTIONS]) {
      const parser = new libcellml.Parser(false)
      const model = parser.parseModel(content)
      expect(parser.errorCount()).toBe(0)
      expect(model.componentCount()).toBeGreaterThan(0)
      model.delete()
      parser.delete()
    }
  })

  describe('CellML 2.0 with connections', () => {
    it('yields one edge per component pair, skipping the environment component', () => {
      const result = parseCellMLConnections(CELLML2_CONNECTED, 'm.cellml')

      expect(result.edges).toHaveLength(1)
      expect(result.edges[0]).toMatchObject({ id: 'a--b', source: 'a', target: 'b' })
    })

    it('lists only connected, non-excluded components', () => {
      const result = parseCellMLConnections(CELLML2_CONNECTED, 'm.cellml')

      expect(result.components).toEqual(['a', 'b'])
      expect(result.components).not.toContain('environment')
      expect(result.components).not.toContain('lonely')
      expect(result.nodes.map((n) => n.id)).toEqual(['a', 'b'])
      expect(result.modules.map((m) => m.name)).toEqual(['a', 'b'])
    })

    it('records every raw variable mapping on the edge, dropping only names declared as time in the environment', () => {
      const { edges } = parseCellMLConnections(CELLML2_CONNECTED, 'm.cellml')

      // The environment declares 'time', not 't', so the t<->t mapping between a and b is kept.
      expect(edges[0].data.rawMappings).toEqual([
        { var1: 'x', var2: 'x_in' },
        { var1: 't', var2: 't' },
      ])
    })

    it('names the port after the variable and the component that owns it', () => {
      const { nodes } = parseCellMLConnections(CELLML2_CONNECTED, 'm.cellml')
      const a = nodes.find((n) => n.id === 'a')
      const b = nodes.find((n) => n.id === 'b')

      // x is the left-hand side of an equation in `a`, so `a` owns it.
      expect(a.data.ports).toEqual([
        { portType: 'general_ports', label: 'x__a', multiportType: 'True', variables: ['x'] },
        { portType: 'general_ports', label: 't__a', multiportType: 'True', variables: ['t'] },
      ])
      expect(b.data.ports).toEqual([
        { portType: 'general_ports', label: 'x__a', multiportType: 'True', variables: ['x_in'] },
        { portType: 'general_ports', label: 't__a', multiportType: 'True', variables: ['t'] },
      ])
    })

    it('builds nodes and modules carrying variables, units and module/math references', () => {
      const result = parseCellMLConnections(CELLML2_CONNECTED, 'm.cellml')
      const nodeB = result.nodes.find((n) => n.id === 'b')
      const moduleB = result.modules.find((m) => m.name === 'b')

      expect(result.cellmlModuleSubtype).toMatch(/^cellml_import_[a-z0-9]+$/)
      expect(nodeB.type).toBe('instanceNode')
      expect(nodeB.position).toEqual({ x: 0, y: 0 })
      expect(nodeB.data.moduleRef).toBe(`b:${result.cellmlModuleSubtype}`)
      expect(nodeB.data.mathRef).toBe('m.cellml:b')
      expect(nodeB.data.variables.map((v) => v.name)).toEqual(['t', 'x_in', 'y'])
      expect(nodeB.data.variables[0]).toEqual({
        name: 't',
        value: null,
        units: 'second',
        access: 'access',
        type: 'variable',
        data_reference: null,
      })
      expect(moduleB).toMatchObject({ moduleRef: nodeB.data.moduleRef, mathRef: 'm.cellml:b' })
      expect(moduleB.ports).toEqual(nodeB.data.ports)
    })

    it('generates a fresh module subtype on every call', () => {
      const first = parseCellMLConnections(CELLML2_CONNECTED, 'm.cellml')
      const second = parseCellMLConnections(CELLML2_CONNECTED, 'm.cellml')

      expect(first.cellmlModuleSubtype).not.toBe(second.cellmlModuleSubtype)
    })
  })

  describe('CellML 1.1 with connections', () => {
    it('reads component names from nested map_components and treats initial_value as ownership', () => {
      const result = parseCellMLConnections(CELLML1_CONNECTED, 'old.cellml')

      expect(result.components).toEqual(['src', 'dst'])
      expect(result.edges).toHaveLength(1)
      expect(result.edges[0]).toMatchObject({ id: 'src--dst', source: 'src', target: 'dst' })
      expect(result.edges[0].data.rawMappings).toEqual([{ var1: 'out', var2: 'inp' }])
      // `out` has an initial_value so `src` owns it, even though 'inp' sorts first alphabetically.
      expect(result.nodes.find((n) => n.id === 'dst').data.ports[0]).toMatchObject({
        label: 'out__src',
        variables: ['inp'],
      })
    })
  })

  describe('constants shared through connections', () => {
    // `holder` exports k to two readers. It also has a state, s, a constant nothing reads, c, and q,
    // which `rival` gives an initial value too.
    const SHARED = `<model xmlns="http://www.cellml.org/cellml/1.0#" name="m">
  <component name="holder">
    <variable name="k" units="dimensionless" initial_value=" 0.5 " public_interface="out"/>
    <variable name="s" units="dimensionless" initial_value="1" public_interface="out"/>
    <variable name="c" units="dimensionless" initial_value="3"/>
    <variable name="q" units="dimensionless" initial_value="2" public_interface="out"/>
    <math ${MATHML}><apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>s</ci></apply><ci>c</ci></apply></math>
  </component>
  <component name="r1">
    <variable name="k" units="dimensionless" public_interface="in"/>
    <variable name="s_in" units="dimensionless" public_interface="in"/>
  </component>
  <component name="r2"><variable name="kk" units="dimensionless" public_interface="in"/></component>
  <component name="rival"><variable name="q" units="dimensionless" initial_value="2" public_interface="in"/></component>
  <connection><map_components component_1="holder" component_2="r1"/>
    <map_variables variable_1="k" variable_2="k"/><map_variables variable_1="s" variable_2="s_in"/></connection>
  <connection><map_components component_1="r2" component_2="holder"/><map_variables variable_1="kk" variable_2="k"/></connection>
  <connection><map_components component_1="holder" component_2="rival"/><map_variables variable_1="q" variable_2="q"/></connection>
</model>`

    const rowsOf = (result, name) =>
      Object.fromEntries(result.modules.find((mod) => mod.name === name).variables.map((row) => [row.name, `${row.type}=${row.value}`]))

    it('types the holder of a shared numeric initial value as a constant, keeping its value', () => {
      const result = parseCellMLConnections(SHARED, 'm.cellml')

      expect(rowsOf(result, 'holder')).toEqual({
        k: 'constant=0.5',
        // A state, a constant nothing reads, and a value two components give stay for reconcileRows to type.
        s: 'variable=null',
        c: 'variable=null',
        q: 'variable=null',
      })
      const nodeRows = result.nodes.find((node) => node.id === 'holder').data.variables
      expect(nodeRows.find((row) => row.name === 'k')).toMatchObject({ type: 'constant', value: '0.5' })
    })

    it('leaves the readers untyped, so reconcileRows makes them boundary conditions the constant supplies', () => {
      const result = parseCellMLConnections(SHARED, 'm.cellml')

      expect(rowsOf(result, 'r1')).toEqual({ k: 'variable=null', s_in: 'variable=null' })
      expect(rowsOf(result, 'r2')).toEqual({ kk: 'variable=null' })
      expect(rowsOf(result, 'rival')).toEqual({ q: 'variable=null' })
    })

    it('types no holder when its connected set has another, directly or through a relay', () => {
      // h1.c and h2.c each own a value and a reader; h3.d and h4.d are joined through `relay`.
      const xml = `<model xmlns="http://www.cellml.org/cellml/1.0#" name="m">
  <component name="h1"><variable name="c" units="dimensionless" initial_value="1" public_interface="out"/></component>
  <component name="h2"><variable name="c" units="dimensionless" initial_value="2" public_interface="out"/></component>
  <component name="ra"><variable name="c" units="dimensionless" public_interface="in"/></component>
  <component name="rb"><variable name="c" units="dimensionless" public_interface="in"/></component>
  <component name="h3"><variable name="d" units="dimensionless" initial_value="1" public_interface="out"/></component>
  <component name="h4"><variable name="d" units="dimensionless" initial_value="1" public_interface="out"/></component>
  <component name="relay"><variable name="d" units="dimensionless" public_interface="in"/></component>
  <connection><map_components component_1="h1" component_2="h2"/><map_variables variable_1="c" variable_2="c"/></connection>
  <connection><map_components component_1="h1" component_2="ra"/><map_variables variable_1="c" variable_2="c"/></connection>
  <connection><map_components component_1="h2" component_2="rb"/><map_variables variable_1="c" variable_2="c"/></connection>
  <connection><map_components component_1="h3" component_2="relay"/><map_variables variable_1="d" variable_2="d"/></connection>
  <connection><map_components component_1="relay" component_2="h4"/><map_variables variable_1="d" variable_2="d"/></connection>
</model>`
      const result = parseCellMLConnections(xml, 'm.cellml')

      for (const name of ['h1', 'h2', 'ra', 'rb']) expect(rowsOf(result, name)).toEqual({ c: 'variable=null' })
      for (const name of ['h3', 'h4', 'relay']) expect(rowsOf(result, name)).toEqual({ d: 'variable=null' })
    })
  })

  describe('models without usable connections', () => {
    it.each([
      ['CellML 2.0', CELLML2_NO_CONNECTIONS],
      ['CellML 1.1', CELLML1_NO_CONNECTIONS],
    ])('yields no edges, nodes or components for %s with no connection elements', (_label, content) => {
      const result = parseCellMLConnections(content, 'x.cellml')

      expect(result.edges).toEqual([])
      expect(result.nodes).toEqual([])
      expect(result.modules).toEqual([])
      expect(result.components).toEqual([])
    })

    it('ignores a connection whose only mapping is a time variable', () => {
      const content = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="m">
  <component name="environment"><variable name="time" units="second"/></component>
  <component name="p"><variable name="time" units="second"/></component>
  <component name="q"><variable name="time" units="second"/></component>
  <connection component_1="p" component_2="q"><map_variables variable_1="time" variable_2="time"/></connection>
</model>`

      expect(parseCellMLConnections(content, 'x.cellml').edges).toEqual([])
    })

    it('drops mappings of environment variables flagged as time by their units, and by capitalised Environment', () => {
      const content = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="m">
  <component name="Environment"><variable name="tau" units="millisecond"/></component>
  <component name="p"><variable name="tau" units="millisecond"/><variable name="u" units="dimensionless"/></component>
  <component name="q"><variable name="tau" units="millisecond"/><variable name="v" units="dimensionless"/></component>
  <connection component_1="p" component_2="q">
    <map_variables variable_1="tau" variable_2="tau"/>
    <map_variables variable_1="u" variable_2="v"/>
  </connection>
</model>`

      const { edges } = parseCellMLConnections(content, 'x.cellml')
      expect(edges).toHaveLength(1)
      expect(edges[0].data.rawMappings).toEqual([{ var1: 'u', var2: 'v' }])
    })

    it('keeps only the first connection for a component pair, even when listed in reverse order', () => {
      const content = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="m">
  <component name="p"><variable name="u" units="dimensionless"/><variable name="w" units="dimensionless"/></component>
  <component name="q"><variable name="v" units="dimensionless"/><variable name="z" units="dimensionless"/></component>
  <connection component_1="p" component_2="q"><map_variables variable_1="u" variable_2="v"/></connection>
  <connection component_1="q" component_2="p"><map_variables variable_1="z" variable_2="w"/></connection>
</model>`

      const { edges } = parseCellMLConnections(content, 'x.cellml')
      expect(edges).toHaveLength(1)
      expect(edges[0]).toMatchObject({ id: 'p--q', source: 'p', target: 'q' })
      expect(edges[0].data.rawMappings).toEqual([{ var1: 'u', var2: 'v' }])
    })

    it('ignores a connection with no map_variables or missing component attributes', () => {
      const content = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="m">
  <component name="p"><variable name="u" units="dimensionless"/></component>
  <component name="q"><variable name="v" units="dimensionless"/></component>
  <connection component_1="p" component_2="q"/>
  <connection component_1="p"><map_variables variable_1="u" variable_2="v"/></connection>
</model>`

      const result = parseCellMLConnections(content, 'x.cellml')
      expect(result.edges).toEqual([])
      expect(result.components).toEqual([])
    })
  })

  describe('invalid content', () => {
    it('throws a descriptive error for non-XML garbage', () => {
      expect(() => parseCellMLConnections('this is not xml at all', 'bad.cellml')).toThrow(
        /Failed to parse CellML XML/
      )
    })

    it('throws for malformed XML such as an unclosed element', () => {
      expect(() => parseCellMLConnections('<model><component name="a"></model>', 'bad.cellml')).toThrow(
        /Failed to parse CellML XML/
      )
    })

    it('throws for an empty string', () => {
      expect(() => parseCellMLConnections('', 'empty.cellml')).toThrow(/Failed to parse CellML XML/)
    })
  })

  describe('tests/resources/model.cellml', () => {
    it('extracts the instance-to-parameter edges but never the environment', async () => {
      const content = await readFile(modelFixturePath, 'utf8')
      const result = parseCellMLConnections(content, 'model.cellml')

      expect(result.edges.length).toBeGreaterThan(0)
      expect(result.components).toEqual(expect.arrayContaining(['soma_SN', 'axon_SN', 'var_SN', 'global_parameters', 'instance_parameters']))
      expect(result.components).not.toContain('environment')
      for (const edge of result.edges) {
        expect(edge.source).not.toBe('environment')
        expect(edge.target).not.toBe('environment')
        expect(edge.data.rawMappings.length).toBeGreaterThan(0)
      }
      const globalToSoma = result.edges.find((e) => e.id === 'global_parameters--soma_SN')
      expect(globalToSoma.data.rawMappings.map((m) => m.var1)).toEqual(['R', 'F', 'T'])
      expect(result.nodes).toHaveLength(result.components.length)
    })
  })
})
