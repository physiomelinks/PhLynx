import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { beforeAll, describe, expect, it } from 'vitest'
import { parseApiCoords } from '../../../../src/services/annotations/apicoord.js'
import { parseSidecar } from '../../../../src/services/annotations/sidecar.js'
import { suggestCouplings } from '../../../../src/services/annotations/match.js'
import { couplingsToEdges } from '../../../../src/services/annotations/ports.js'

// Unpublished fixtures, gitignored: the test runs only where they are present. The expected edges
// come from private/scripts/gen_expected.py, run on the original workspace.
const PRIVATE = resolve(__dirname, '../../fixtures/annotations/private')
const EXPECTED = resolve(PRIVATE, 'expected.json')
const read = (...path) => readFileSync(resolve(PRIVATE, ...path), 'utf8')
const componentOf = (mathRef) => mathRef.split(':')[1]

const tuples = (edges) =>
  edges.flatMap((edge) => edge.couplings.map(([sv, tv]) => `${edge.source}.${sv} -> ${edge.target}.${tv}`)).sort()
const suggestedTuples = (suggestions) =>
  suggestions
    .flatMap((s) =>
      s.couplings.map((c) => `${s.sourceName}.${c.source.variable} -> ${s.targetName}.${c.target.variable}`)
    )
    .sort()

describe.skipIf(!existsSync(EXPECTED))('regeneration from private fixtures', () => {
  let expected, instances, context, lyphNames, couplingCount

  beforeAll(async () => {
    expected = JSON.parse(read('expected.json'))
    couplingCount = expected.edges.reduce((count, edge) => count + edge.couplings.length, 0)
    const apicoords = await parseApiCoords(read('apicoords.ttl'))
    expect(apicoords.warnings).toEqual([])
    context = { coords: apicoords.coords, scopes: apicoords.scopes }

    // Sidecars are keyed by per-file mathRef; the workspace's mathRefs share one file, so match by component.
    const sidecars = new Map()
    for (const component of new Set(expected.instances.map((instance) => componentOf(instance.mathRef)))) {
      const sidecar = await parseSidecar(read('sidecars', `${component}.ttl`), {
        mathRef: `${component}.cellml:${component}`,
        cellml: read('maths', `${component}.cellml`),
      })
      expect(sidecar.warnings).toEqual([])
      sidecars.set(component, sidecar)
    }
    const mathRefs = new Map(expected.instances.map((instance) => [instance.name, instance.mathRef]))
    instances = apicoords.instances.map((instance) => ({
      ...instance,
      sidecar: sidecars.get(componentOf(mathRefs.get(instance.name))),
    }))
    lyphNames = new Set(instances.filter((instance) => instance.coord.kind === 'lyph').map((i) => i.name))
  })

  it('binds every expected instance to a coordinate', () => {
    expect(instances.map((instance) => instance.name).sort()).toEqual(expected.instances.map((i) => i.name).sort())
    expect(instances.every((instance) => instance.sidecar)).toBe(true)
  })

  it('reproduces the expected edges and couplings with the reservoirs held constant', () => {
    const heldConstant = new Set(instances.filter((i) => ['layer', 'lyph'].includes(i.coord.kind)).map((i) => i.name))
    const { suggestions, conflicts } = suggestCouplings(instances, { ...context, heldConstant })

    expect(conflicts).toEqual([])
    expect(suggestions).toHaveLength(expected.edges.length)
    expect(suggestions.flatMap((s) => s.couplings)).toHaveLength(couplingCount)
    const orientations = (edges) => edges.map((edge) => `${edge.source} -> ${edge.target}`).sort()
    expect(orientations(suggestions.map((s) => ({ source: s.sourceName, target: s.targetName })))).toEqual(
      orientations(expected.edges)
    )
    expect(suggestedTuples(suggestions)).toEqual(tuples(expected.edges))
    expect(suggestions.flatMap((s) => s.couplings).some((c) => c.ambiguous)).toBe(false)

    const low = suggestions.filter((s) => s.confidence === 'low')
    expect(low).toHaveLength(expected.lowConfidence)
    expect(low.every((s) => lyphNames.has(s.targetName) && s.why)).toBe(true)
    expect(suggestions.filter((s) => lyphNames.has(s.targetName)).every((s) => s.confidence === 'low')).toBe(true)

    // The suggested edges carry annotated ports in the workspace coupling shape.
    const nodes = new Map(instances.map((instance, index) => [instance.name, { id: `node_${index}` }]))
    const edges = couplingsToEdges(suggestions, nodes)
    expect(edges).toHaveLength(expected.edges.length)
    for (const edge of edges) {
      for (const { sourcePort, targetPort } of edge.data.couplings) {
        expect(sourcePort.annotation.property).toBe(targetPort.annotation.property)
        const roles = [sourcePort.annotation.role, targetPort.annotation.role].sort().join('+')
        expect(['owner+reader', 'aggregator+contributor']).toContain(roles)
      }
    }
  })

  it('adds exactly the outer fluxes when nothing is held constant', () => {
    const held = new Set(instances.filter((i) => ['layer', 'lyph'].includes(i.coord.kind)).map((i) => i.name))
    const base = suggestedTuples(suggestCouplings(instances, { ...context, heldConstant: held }).suggestions)
    const { suggestions } = suggestCouplings(instances, context)
    const all = suggestedTuples(suggestions)
    expect(suggestions).toHaveLength(expected.edges.length)
    expect(all).toHaveLength(couplingCount + expected.outerFluxes)
    const extra = all.filter((tuple) => !base.includes(tuple))
    expect(extra).toHaveLength(expected.outerFluxes)
    for (const coupling of suggestions.flatMap((s) => s.couplings)) {
      if (
        !extra.includes(
          `${coupling.source.instance}.${coupling.source.variable} -> ${coupling.target.instance}.${coupling.target.variable}`
        )
      )
        continue
      expect(coupling.kind).toBe('sum')
      const aggregator = coupling.source.role === 'aggregator' ? coupling.source : coupling.target
      const contributor = coupling.source.role === 'aggregator' ? coupling.target : coupling.source
      expect(held.has(aggregator.instance)).toBe(true)
      expect(contributor.variable).toMatch(/_o$/)
    }
  })
})
