<template>
  <div
    class="instance-node"
    :id="id"
    ref="instanceNode"
    :class="{ selected: selected, 'instance-node--simulated': isSimulated }"
    @contextmenu.stop.prevent="openContextMenu"
    @mousedown.capture="stopDragWhileEditing"
    @dblclick="onNodeDoubleClick"
  >
    <NodeResizer min-width="200" min-height="120" :is-visible="selected" />

    <div :class="['instance-card', { 'has-category': categoryStyle }]" :style="categoryStyle">
      <!-- Top Actions Row -->
      <div class="card-header-actions">
        <div class="instance-details">
          <div class="detail-item">
            <i class="pi pi-box detail-icon"></i>
            <span class="detail-value">{{ componentName }}</span>
          </div>
          <div class="detail-item">
            <i class="pi pi-file detail-icon"></i>
            <span class="detail-value">{{ mathFile }}</span>
          </div>
        </div>
        <div style="flex-grow: 1; min-width: 1.5em;"></div> <!-- Spacer to push buttons to the right -->
        <div v-if="isMissingParameters || isMissingUnits" class="status-indicator">
          <i
            class="pi pi-exclamation-triangle warning-icon"
            v-tooltip.top="`At least one ${isMissingParameters ? 'parameter' : 'unit'} has not been ${isMissingParameters ? 'assigned a value' : 'given a valid definition'}`"
          ></i>
        </div>
        <Button
          rounded
          iconOnly
          size="small"
          severity="secondary"
          class="instance-button"
          icon="pi pi-pencil"
          @click="openInstanceEditor('parameters')"
          @dblclick.stop
          v-tooltip.bottom="{ value: 'Edit instance', showDelay: 300 }"
        />
      </div>

      <!-- Node Title Block -->
      <div class="instance-name">
        <!-- Not a <button>: the SVG export leaves buttons out, and the name must be drawn. -->
        <span
          v-if="!isEditing"
          role="button"
          tabindex="0"
          class="name-text"
          :aria-label="`Rename ${data.name}`"
          @click="onNameClick"
          @keydown.enter.prevent="startEditing"
          @keydown.space.prevent="startEditing"
        >{{ data.name }}</span>
        <SanitisedInput
          v-else
          ref="nameInputRef"
          v-model="editingName"
          :sanitise="sanitiseName"
          floating
          class="nodrag"
          @dblclick.stop="onNameInputDoubleClick"
          @commit="saveEdit"
          @revert="cancelEdit"
        />
      </div>
    </div>

    <NodeHandles :id="id" :handles="data.handles" :selected="selected" :disabled="isEditing" />
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { NodeResizer } from '@vue-flow/node-resizer'
import Button from 'primevue/button'

import NodeHandles from './NodeHandles.vue'
import SanitisedInput from './SanitisedInput.vue'
import { useLibraryStore } from '../stores/libraryStore'
import { sanitiseName } from '../utils/identifiers'
import { moduleProblems } from '../composables/useModuleProblems'
import { useNodeChrome } from '../composables/useNodeChrome'

import '../assets/vueflownode.css'

const libraryStore = useLibraryStore()

const props = defineProps({
  id: {
    type: String,
    required: true,
  },
  selected: {
    type: Boolean,
    default: false,
  },
  data: {
    type: Object,
    required: true,
  }, // { handles, variables, mathRef, moduleRef, ports, name }
})

const emit = defineEmits([
  'open-instance-editor',
  'open-context-menu',
])

// Name editing, theme, simulated outline and context menu, shared with SuperInstanceNode.
const {
  isSimulated,
  categoryStyle,
  isEditing,
  editingName,
  nameInputRef,
  onNameClick,
  onNodeDoubleClick,
  onNameInputDoubleClick,
  startEditing,
  stopDragWhileEditing,
  saveEdit,
  cancelEdit,
  openContextMenu,
} = useNodeChrome(props, emit, { onDoubleClick: () => openInstanceEditor('parameters') })

function openInstanceEditor(defaultTab = 'parameters') {
  emit('open-instance-editor', {
    id: props.id,
    name: props.data.name,
    mathRef: props.data.mathRef,
    variables: props.data.variables,
    ports: props.data.ports,
    handles: props.data.handles,
    defaultTab,
  })
}

// Computed, so the card follows a save that moves the node to new math.
const componentName = computed(() => props.data.mathRef.split(':')[1])

const mathFile = computed(() => props.data.mathRef.split(':')[0])

// A local constant's value is its super-module's.
const problems = computed(() => moduleProblems(props.data.variables, libraryStore, { skipLocalConstants: true }))
const isMissingParameters = computed(() => problems.value.missingParameters)
const isMissingUnits = computed(() => problems.value.missingUnits)

const portMenuRef = ref(null)

function togglePortMenu(event) {
  portMenuRef.value?.toggle(event)
}
</script>

<style lang="scss" scoped>
@use '../assets/nodechrome.scss';
@import '../assets/vueflowhandle.css';
</style>

<style>
.content-fit-menu {
  width: max-content !important; 
  min-width: 0 !important; 
}
.vue-flow__node {
  background: transparent !important;
}
</style>
