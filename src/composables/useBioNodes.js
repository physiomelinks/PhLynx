import { computed } from 'vue'
import { useAnnotationStore } from '../stores/annotationStore'
import { useLibraryStore } from '../stores/libraryStore'
import { useSimulationResultsStore } from '../stores/simulationResultsStore'
import { readNodeSeries } from '../services/simulation/variableMapping'
import { flowDirection, transportedSpecies } from '../services/bioView/transport'
import { GLYPH_HEIGHT, GLYPH_WIDTH } from '../services/bioView/geometry'
import { CARD, layoutBioView } from '../services/bioView/layout'
import { resolveBioRole } from '../services/bioView/roles'

/** Stacking: regions under cells under everything drawn on them. */
const Z = { region: -20, cell: -10 }

/**
 * Turns the physiological layout into nodes for the physiological view's flow. Each has the id of the
 * instance it draws, so selection and edits map straight back. Proteins in a membrane and processes in
 * a cell are children of the cell, so they move with it.
 *
 * @param {Array<Object>} nodes - The diagram's nodes.
 * @param {Map<string, Object>} roles - Node id -> resolveBioRole's result.
 * @param {Map<string, Object>} layout - From layoutBioView.
 * @param {Map<string, Array<Object>>} [transport] - Node id -> what its cartoon's arrows show (see useBioNodes).
 * @returns {Array<Object>} vue-flow nodes; parents come before their children.
 */
export function bioFlowNodes(nodes, roles, layout, transport = new Map()) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const base = (id) => {
    const node = byId.get(id)
    return {
      id,
      selected: !!node.selected,
      data: { name: node.data?.name ?? id, domainType: node.data?.domainType ?? null },
    }
  }
  const parents = []
  const children = []

  for (const [id, place] of layout) {
    if (!byId.has(id)) continue
    switch (place.kind) {
      case 'cell': {
        const { x, y, width, height } = place.rect
        parents.push({
          ...base(id),
          type: 'bioCell',
          position: { x, y },
          width,
          height,
          zIndex: Z.cell,
          data: { ...base(id).data, membrane: place.membrane, width, height },
        })
        break
      }
      case 'region': {
        const { x, y, width, height } = place.rect
        parents.push({
          ...base(id),
          type: 'bioRegion',
          position: { x, y },
          width,
          height,
          zIndex: Z.region,
          data: { ...base(id).data, side: place.side, at: place.adjacent?.[0]?.at ?? null },
        })
        break
      }
      case 'protein': {
        const cell = layout.get(place.cell).rect
        children.push({
          ...base(id),
          type: 'bioProtein',
          parentNode: place.cell,
          position: { x: place.x - GLYPH_WIDTH / 2 - cell.x, y: place.y - GLYPH_HEIGHT / 2 - cell.y },
          width: GLYPH_WIDTH,
          height: GLYPH_HEIGHT,
          data: {
            ...base(id).data,
            glyph: roles.get(id)?.glyph ?? 'generic',
            arrows: transport.get(id) ?? [],
            facet: place.facet,
            annotatedFacet: roles.get(id)?.annotatedFacet ?? null,
            rotation: place.rotation,
            outward: place.outward,
            droppable: true,
          },
        })
        break
      }
      case 'tray':
        parents.push({
          ...base(id),
          type: 'bioProtein',
          position: { x: place.x, y: place.y },
          width: GLYPH_WIDTH,
          height: GLYPH_HEIGHT,
          data: {
            ...base(id).data,
            glyph: roles.get(id)?.glyph ?? 'generic',
            arrows: transport.get(id) ?? [],
            annotatedFacet: roles.get(id)?.annotatedFacet ?? null,
            rotation: 0,
            unplaced: true,
            droppable: true,
          },
        })
        break
      case 'cytosolic': {
        const cell = layout.get(place.cell).rect
        children.push({
          ...base(id),
          type: 'bioCard',
          parentNode: place.cell,
          extent: 'parent',
          position: { x: place.x - cell.x, y: place.y - cell.y },
          width: CARD.width,
          height: CARD.height,
        })
        break
      }
      case 'card':
        // Something with no physiological role can be dropped into a membrane to make it a protein.
        parents.push({
          ...base(id),
          type: 'bioCard',
          position: { x: place.x, y: place.y },
          width: CARD.width,
          height: CARD.height,
          data: { ...base(id).data, droppable: true },
        })
        break
      // A membrane is drawn as its cell's outline.
    }
  }
  return [...parents, ...children]
}

/**
 * Works out the bioView fields that keep a node of the physiological view where it was dragged to.
 *
 * @param {Object} bioNode - The bio flow node: type, width, height and data.
 * @param {{x: number, y: number}} at - Its new top-left, in flow coordinates (not relative to a parent).
 * @returns {Object} The bioView fields to set.
 */
export function bioViewForMove(bioNode, at) {
  const { x, y } = at
  if (bioNode.type === 'bioCell' || bioNode.type === 'bioRegion') {
    return { rect: { x, y, width: bioNode.width, height: bioNode.height } }
  }
  return { position: { x, y } }
}

/**
 * The physiological view's nodes, derived from the diagram's. Nothing is written by deriving them.
 *
 * @param {Ref<Array<Object>>} nodes - The diagram's nodes.
 * @returns {{ roles: ComputedRef<Map>, layout: ComputedRef<Map>, bioNodes: ComputedRef<Array<Object>> }}
 */
export function useBioNodes(nodes) {
  const annotationStore = useAnnotationStore()
  const libraryStore = useLibraryStore()
  const simulationResults = useSimulationResultsStore()

  const roles = computed(() => {
    const apiCoords = annotationStore.getApiCoords()
    return new Map(
      nodes.value.map((node) => [
        node.id,
        resolveBioRole(node.data, {
          apiCoords,
          sidecar: node.data?.mathRef ? libraryStore.getParsedModuleAnnotations(node.data.mathRef) : null,
          nodes: nodes.value,
        }),
      ])
    )
  })
  const layout = computed(() => layoutBioView(nodes.value, roles.value))

  // What each membrane protein carries, from its sidecar, and which way, from the latest run.
  const transport = computed(() => {
    const { results, mapping } = simulationResults
    // A sweep's values are one per swept point, not a course over time, so its last says nothing of where a run ended.
    const usable = results && mapping && !results.isSweep
    const arrows = new Map()
    for (const node of nodes.value) {
      if (roles.value.get(node.id)?.role !== 'membraneProtein' || !node.data?.mathRef) continue
      const carried = transportedSpecies(libraryStore.getParsedModuleAnnotations(node.data.mathRef))
      arrows.set(
        node.id,
        carried.map(({ label, inside }) => ({
          label,
          direction: usable ? flowDirection(readNodeSeries(results, mapping, node.id, inside)?.values) : null,
        }))
      )
    }
    return arrows
  })
  const bioNodes = computed(() => bioFlowNodes(nodes.value, roles.value, layout.value, transport.value))

  /** Parses every module's sidecar, so roles from sidecars are known. */
  function loadSidecars() {
    const mathRefs = new Set(nodes.value.map((node) => node.data?.mathRef).filter(Boolean))
    return Promise.all([...mathRefs].map((mathRef) => libraryStore.ensureModuleAnnotations(mathRef)))
  }

  return { roles, layout, bioNodes, loadSidecars }
}
