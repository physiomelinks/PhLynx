<template>
  <VueFlow
    :id="FLOW_IDS.BIO"
    :nodes="bioNodes"
    :edges="[]"
    class="bio-flow"
    :max-zoom="1.5"
    :min-zoom="0.1"
    :delete-key-code="null"
    :elevate-nodes-on-select="false"
    :nodes-connectable="false"
    @nodes-change="onNodesChange"
    @node-drag-stop="onNodeDragStop"
    @node-double-click="onNodeDoubleClick"
    @nodes-initialized="onNodesInitialized"
  >
    <Background :size="2" :gap="20" />
    <MiniMap :pannable="true" :zoomable="true" class="mini-map" />
    <Controls>
      <ControlButton title="Export image of the physiological view" @click="emit('export-image', { root: vueFlowRef, viewport })">
        <i class="pi pi-image"></i>
      </ControlButton>
    </Controls>
    <template #node-bioCell="props">
      <BioCell :data="props.data" :selected="props.selected" :width="props.data.width" :height="props.data.height" />
    </template>
    <template #node-bioRegion="props">
      <BioRegion :data="props.data" :selected="props.selected" />
    </template>
    <template #node-bioProtein="props">
      <BioProtein :data="props.data" :selected="props.selected" />
    </template>
    <template #node-bioCard="props">
      <BioCard :data="props.data" :selected="props.selected" />
    </template>
  </VueFlow>
</template>

<script setup>
import { onBeforeUnmount, onMounted } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { ControlButton, Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import BioCard from './BioCard.vue'
import BioCell from './BioCell.vue'
import BioProtein from './BioProtein.vue'
import BioRegion from './BioRegion.vue'
import { bioViewForMove, useBioNodes } from '../../composables/useBioNodes'
import { useNodeDataHistory } from '../../composables/useNodeDataHistory'
import { useViewModeStore } from '../../stores/viewModeStore'
import { FLOW_IDS } from '../../utils/constants'

const emit = defineEmits(['open-instance-editor', 'export-image'])

// The diagram's flow is the one source of truth: selection and edits go there, and this view follows.
// Only this component, outside the bio <VueFlow>, reaches the main flow, so its nodes' handles never do.
const main = useVueFlow(FLOW_IDS.MAIN)
const { recordEdit } = useNodeDataHistory(FLOW_IDS.MAIN)
const { findNode, fitView, setViewport, viewport, vueFlowRef } = useVueFlow(FLOW_IDS.BIO)
const viewMode = useViewModeStore()
const { bioNodes, loadSidecars } = useBioNodes(main.nodes)

onMounted(() => loadSidecars())
onBeforeUnmount(() => (viewMode.bioViewport = { ...viewport.value }))

function onNodesInitialized() {
  if (viewMode.bioViewport) setViewport(viewMode.bioViewport)
  else fitView({ padding: 0.15 })
}

function onNodesChange(changes) {
  for (const change of changes) {
    if (change.type !== 'select') continue
    const node = main.findNode(change.id)
    if (node) node.selected = change.selected
  }
}

/** Keeps dragged nodes where they were put, as one undo step in the diagram's history. */
function onNodeDragStop({ nodes }) {
  const moves = nodes.map((node) => ({ id: node.id, fields: bioViewForMove(findNode(node.id) ?? node, findNode(node.id)?.computedPosition ?? node.position) }))
  const ids = moves.map((move) => move.id).filter((id) => main.findNode(id))
  if (!ids.length) return
  recordEdit({
    type: 'bio-layout',
    nodeIds: ids,
    keys: ['bioView'],
    apply: () =>
      moves.forEach(({ id, fields }) => {
        const node = main.findNode(id)
        if (node) main.updateNodeData(id, { bioView: { ...node.data.bioView, ...fields } })
      }),
  })
}

function onNodeDoubleClick({ node }) {
  const instance = main.findNode(node.id)
  if (!instance) return
  const { name, mathRef, variables, ports, handles } = instance.data
  emit('open-instance-editor', { id: instance.id, name, mathRef, variables, ports, handles, defaultTab: 'parameters' })
}
</script>

<style scoped>
.bio-flow {
  width: 100%;
  height: 100%;
}
</style>
