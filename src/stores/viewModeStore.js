import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

/**
 * Which view of the workspace the canvas shows: the module diagram, or the physiological view drawn
 * from the same instances. Never saved: a workspace always opens as a diagram.
 */
export const useViewModeStore = defineStore('viewMode', () => {
  /** 'diagram' or 'bio'. */
  const mode = ref('diagram')
  /** Whether the physiological view draws the coupling edges over its artwork. */
  const showCouplings = ref(false)
  /** The physiological view's pan and zoom, kept while the diagram is shown. */
  const bioViewport = ref(null)

  const isBio = computed(() => mode.value === 'bio')

  return { mode, showCouplings, bioViewport, isBio }
})
