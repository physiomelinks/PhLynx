import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

/**
 * Which view of the workspace the canvas shows: the module diagram, or the physiological view drawn
 * from the same instances. Never saved: a workspace always opens as a diagram.
 */
export const useViewModeStore = defineStore('viewMode', () => {
  /** 'diagram' or 'bio'. */
  const mode = ref('diagram')
  /** The physiological view's pan and zoom, kept while the diagram is shown. */
  const bioViewport = ref(null)
  /**
   * Which species species mode shows: 'coupled' (those coupled to their compartment), 'fluxes' (those coupled with
   * a path through a protein) or 'all' annotated.
   */
  const speciesScope = ref('coupled')
  /** The species species mode leaves out, by CURIE: each is hidden in every compartment, with its paths. */
  const hiddenSpecies = ref([])
  /**
   * The species token clicked, which the selection plot shows in place of the selection:
   * { nodeId, species, label, scope } (scope: the instances a Selection run needs). Cleared when the selection
   * changes or the view goes.
   */
  const focusedSpecies = ref(null)

  /**
   * The build tile clicked and waiting for a click on the physiological view to place it: { kind, template? }. The
   * tiles are in the library's Build tab and the view places them, so what is carried between the two is kept here.
   */
  const armedTile = ref(null)
  /** The build tile being dragged, as a drag's data can't be read until it is dropped. */
  const draggedTile = ref(null)
  /** Counts the requests to load a template from a file, which the physiological view answers. */
  const templateFileRequests = ref(0)

  const isBio = computed(() => mode.value === 'bio')

  return { mode, bioViewport, speciesScope, hiddenSpecies, focusedSpecies, armedTile, draggedTile, templateFileRequests, isBio }
})
