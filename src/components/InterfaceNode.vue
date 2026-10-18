<template>
  <div class="interface-node" :class="{ selected }" @contextmenu.stop.prevent="openContextMenu">
    <div class="interface-header">
      <i class="pi pi-sign-in interface-icon" aria-hidden="true"></i>
      <span class="interface-title">Interface</span>
      <span aria-hidden="true">·</span>
      <span class="interface-name" :title="supermoduleName">{{ supermoduleName }}</span>
    </div>
    <ol v-if="ports.length" class="interface-port-list" :aria-label="`Ports of ${supermoduleName}`">
      <li
        v-for="(port, i) in ports"
        :key="port.exposedPortId"
        :aria-label="`${port.label}${indices[i] ?? ''} — ${describe(port)}`"
        v-tooltip.top="{ value: describe(port), showDelay: 300 }"
      >
        <span class="interface-port-type" aria-hidden="true">{{ portTypeLetter(port.portType) }}</span>
        <span class="interface-port-label">{{ port.label }}</span>
        <sup v-if="indices[i]" class="interface-port-index">{{ indices[i] }}</sup>
      </li>
    </ol>
    <div v-else class="interface-ports">
      No exposed ports yet
      <span class="interface-hint">Connect a module to this card to expose its ports.</span>
    </div>

    <NodeHandles :id="id" :handles="data.handles" :selected="selected" />
  </div>
</template>

<script setup>
/**
 * A super-module's interface node: the record of the super-module, shown inside it. Names the super-module and lists,
 * in order, the ports its exposure edges expose, as its super instances get them: a type badge and label each, numbered
 * when labels repeat, with the child it is on, its type and variables on hover. Its handles are only where exposure
 * edges attach, as on any node; it can't be deleted from the canvas. Right-click asks for its context menu.
 */
import { computed } from 'vue'

import NodeHandles from './NodeHandles.vue'
import { describeExposedPort, duplicateIndex, portTypeLetter, useExposedPortOwners } from '../composables/useExposure'
import { useSupermodules } from '../composables/useSupermodules'

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
  }, // { scope, localId, supermodule: { name, … }, handles }
})

const emit = defineEmits(['open-context-menu'])

const { portsOf } = useSupermodules()
const ownersOf = useExposedPortOwners()

const supermoduleName = computed(() => props.data.supermodule?.name ?? props.id)
const ports = computed(() => portsOf(props.id))
// Each exposed port's child, so two of the same name read apart.
const owners = computed(() => ownersOf(props.id))
const indices = computed(() => duplicateIndex(ports.value))
const describe = (port) => describeExposedPort(owners.value.get(port.exposedPortId), port)

/** @param {MouseEvent} event - A right-click on the card. */
function openContextMenu(event) {
  emit('open-context-menu', { clientX: event.clientX, clientY: event.clientY, id: props.id })
}
</script>

<style lang="scss" scoped>
@import '../assets/vueflowhandle.css';

.interface-node {
  min-width: 160px;
  max-width: 220px;
  min-height: 60px;
  padding: 0.4rem 0.6rem;
  border: 2px dashed color-mix(in srgb, var(--p-text-color) 30%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--p-primary-color) 6%, var(--p-content-background));
  color: var(--p-text-color);
}

.interface-node.selected {
  border-color: var(--p-primary-color);
}

.interface-header {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding-bottom: 0.3rem;
  border-bottom: 1px solid color-mix(in srgb, var(--p-text-color) 15%, transparent);
  font-size: 0.7rem;
  color: color-mix(in srgb, var(--p-text-color) 70%, transparent);
}

.interface-icon {
  font-size: 0.7rem;
}

.interface-title {
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.interface-name {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-weight: 600;
  color: var(--p-text-color);
}

.interface-port-list {
  margin: 0.3rem 0 0;
  padding: 0;
  list-style: none;
  font-size: 0.75rem;
}

.interface-port-list li {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
  line-height: 1.5;
}

/* As the port type select shows it. */
.interface-port-type {
  flex-shrink: 0;
  width: 1.1rem;
  border: 1px solid var(--p-content-border-color);
  border-radius: 4px;
  background: var(--p-content-background);
  font-size: 0.65rem;
  font-weight: 600;
  line-height: 1.2;
  text-align: center;
  color: color-mix(in srgb, var(--p-text-color) 75%, transparent);
}

.interface-port-label {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.interface-port-index {
  flex-shrink: 0;
  margin-left: -0.3rem;
  font-size: 0.6rem;
  color: color-mix(in srgb, var(--p-text-color) 60%, transparent);
}

.interface-ports {
  margin-top: 0.3rem;
  font-size: 0.75rem;
  color: color-mix(in srgb, var(--p-text-color) 70%, transparent);
}

.interface-hint {
  display: block;
  margin-top: 0.2rem;
  font-size: 0.7rem;
  font-style: italic;
  color: var(--p-text-muted-color);
}
</style>
