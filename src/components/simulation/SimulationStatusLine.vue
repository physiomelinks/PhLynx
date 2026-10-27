<template>
  <div class="simulation-status" :class="`simulation-status--${status.severity}`" role="status" aria-live="polite">
    <button v-if="status.details.length" type="button" class="status-text status-button" @click="(event) => popover.toggle(event)">
      <i v-if="status.icon" :class="['pi', status.icon]" aria-hidden="true"></i>
      <span>{{ status.text }}</span>
      <i class="pi pi-angle-down status-more" aria-hidden="true"></i>
    </button>
    <p v-else class="status-text">
      <i v-if="status.icon" :class="['pi', status.icon]" aria-hidden="true"></i>
      <span>{{ status.text }}</span>
    </p>
    <InfoTip v-if="status.notes?.length" class="status-note" :text="status.notes.join('\n')" :label="`Notes: ${status.notes.join(' ')}`" />
    <Popover ref="popover">
      <div class="status-details">
        <section v-for="section in status.details" :key="section.title">
          <h6>{{ section.title }}</h6>
          <ul>
            <li v-for="line in section.lines" :key="line">{{ line }}</li>
          </ul>
        </section>
      </div>
    </Popover>
  </div>
</template>

<script setup>
/**
 * One line saying what the simulation is doing or what needs attention, with the full lists a click away, and any
 * notes on what is expected in a tooltip.
 */
import { ref } from 'vue'

import Popover from 'primevue/popover'

import InfoTip from './InfoTip.vue'

defineProps({
  // { text, severity: 'info' | 'warn' | 'error', icon, details: [{ title, lines }], notes?: string[] }
  status: { type: Object, required: true },
})

const popover = ref(null)
</script>

<style scoped>
.simulation-status {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 0.8125rem;
  color: var(--p-text-muted-color);
}

.status-text {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
  margin: 0;
}

.status-text span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-button {
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  color: inherit;
  cursor: pointer;
  text-align: left;
}

.status-button:hover span {
  text-decoration: underline;
}

.simulation-status--warn {
  color: var(--p-orange-600);
}

.simulation-status--error {
  color: var(--p-red-600);
}

.p-dark .simulation-status--warn {
  color: var(--p-orange-400);
}

.p-dark .simulation-status--error {
  color: var(--p-red-400);
}

.status-details {
  max-width: 24rem;
  max-height: 20rem;
  overflow-y: auto;
  font-size: 0.8125rem;
}

.status-details h6 {
  margin: 0 0 4px;
  font-size: 0.8125rem;
}

.status-details ul {
  margin: 0 0 8px;
  padding-left: 18px;
}
</style>
