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
  /**
   * The species token clicked, which the selection plot shows in place of the selection:
   * { nodeId, species, label, scope } (scope: the instances a Selection run needs). Cleared when the selection
   * changes or the view goes.
   */
  const focusedSpecies = ref(null)

  const isBio = computed(() => mode.value === 'bio')

  return { mode, bioViewport, speciesScope, focusedSpecies, isBio }
})
