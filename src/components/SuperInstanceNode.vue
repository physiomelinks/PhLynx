<template>
  <div
    class="instance-node super-instance-node"
    :id="id"
    :class="{ selected: selected, 'instance-node--simulated': isSimulated }"
    @contextmenu.stop.prevent="openContextMenu"
    @mousedown.capture="stopDragWhileEditing"
    @dblclick="onNodeDoubleClick"
  >
    <NodeResizer min-width="200" min-height="120" :is-visible="selected" />

    <div :class="['instance-card', 'super-instance-card', { 'has-category': categoryStyle }]" :style="categoryStyle">
      <div class="card-header-actions">
        <div class="instance-details">
          <div class="detail-item">
            <i class="pi pi-sitemap detail-icon"></i>
            <span v-if="supermodule" class="detail-value super-instance-supermodule" :title="`Super-module ${supermodule.label}`">
              {{ supermodule.label }}
            </span>
            <span v-else class="detail-value super-instance-supermodule super-instance-supermodule--missing">
              Missing super-module
            </span>
          </div>
          <div class="detail-item">
            <i class="pi pi-arrows-h detail-icon"></i>
            <span
              class="detail-value super-instance-ports"
              v-tooltip.top="{ value: portsTooltip, showDelay: 300 }"
            >{{ portCount }} port{{ portCount === 1 ? '' : 's' }}</span>
          </div>
        </div>
        <div style="flex-grow: 1; min-width: 1.5em"></div>
        <div v-if="problemCount" class="status-indicator super-instance-problems">
          <i
            class="pi pi-exclamation-triangle warning-icon"
            :aria-label="problemsTooltip"
            v-tooltip.top="problemsTooltip"
          ></i>
        </div>
        <Button
          rounded
          iconOnly
          size="small"
          severity="secondary"
          class="instance-button super-instance-open"
          icon="pi pi-sign-in"
          aria-label="Open super instance"
          :disabled="!supermodule"
          @click="open"
          @dblclick.stop
          v-tooltip.bottom="{ value: 'Open super instance', showDelay: 300 }"
        />
      </div>

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
/**
 * A super instance on the canvas: one instance of a super-module. Shows its name, its super-module and its ports, each
 * with the child it is on; double-click or Open shows the super-module's nodes, as this super instance's.
 */
import { computed } from 'vue'
import { NodeResizer } from '@vue-flow/node-resizer'
import Button from 'primevue/button'

import NodeHandles from './NodeHandles.vue'
import SanitisedInput from './SanitisedInput.vue'
import { useCanvasLevel } from '../composables/useCanvasLevel'
import { useExposedPortOwners } from '../composables/useExposure'
import { useSuperInstanceProblems } from '../composables/useModuleProblems'
import { useNodeChrome } from '../composables/useNodeChrome'
import { useSupermodules } from '../composables/useSupermodules'
import { sanitiseName } from '../utils/identifiers'

import '../assets/vueflownode.css'

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
  }, // { name, smId, ports, handles, overrides }
})

const emit = defineEmits(['open-context-menu'])

const {
  flowId,
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
} = useNodeChrome(props, emit, {
  onDoubleClick: () => open(),
  isSuperInstance: true,
  nameTakenMessage: 'A node here already has this name.',
})
const canvasLevel = useCanvasLevel(flowId)
const { find } = useSupermodules(flowId)
const ownersOf = useExposedPortOwners(flowId)
const problemsOf = useSuperInstanceProblems(flowId)

// Its super-module's entry: name and label; undefined when missing.
const supermodule = computed(() => find(props.data.smId))
const portCount = computed(() => props.data.ports?.length ?? 0)
// Its ports, in order, one a line, each with the child it is on, so two of the same name read apart.
const portsTooltip = computed(() => {
  const owners = ownersOf(props.data.smId)
  return (props.data.ports ?? [])
    .map((port) => (owners.get(port.exposedPortId) ? `${port.label} — ${owners.get(port.exposedPortId)}` : port.label))
    .join('\n')
})

// How many modules inside, as this placement expands, have a parameter without a value or units not defined.
const problemCount = computed(() => problemsOf(props.id))
const problemsTooltip = computed(() =>
  problemCount.value === 1
    ? '1 module inside is missing a parameter value or units'
    : `${problemCount.value} modules inside are missing parameter values or units`
)

/** Shows the super-module's nodes, as this super instance's. */
function open() {
  canvasLevel.enter(props.id)
}
</script>

<style lang="scss" scoped>
@use '../assets/nodechrome.scss';
@import '../assets/vueflowhandle.css';

/* A second edge just inside the instance card's own, so it reads as nested at exactly an instance card's size. */
.super-instance-card {
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--p-text-color) 22%, transparent),
    0 1px 2px color-mix(in srgb, var(--p-text-color) 6%, transparent);
}

.super-instance-card:hover {
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--p-text-color) 22%, transparent),
    0 4px 10px color-mix(in srgb, var(--p-text-color) 12%, transparent);
}

.selected .super-instance-card {
  box-shadow:
    inset 0 0 0 1px #409eff, /* the selection border, vueflownode.css */
    0 1px 2px color-mix(in srgb, var(--p-text-color) 6%, transparent);
}

.super-instance-supermodule--missing {
  color: var(--p-orange-500);
}
</style>
