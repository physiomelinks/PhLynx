<template>
  <!-- The math export builds for this instance's Sum and Multiply variables; shown only, never edited -->
  <section v-if="entries.length" :class="['multiport-summary', { 'multiport-summary--sum': hasSum }]" aria-label="Multiport math">
    <button type="button" class="multiport-summary__header" :aria-expanded="!collapsed" @click="toggle">
      <i :class="['pi', collapsed ? 'pi-chevron-right' : 'pi-chevron-down']" aria-hidden="true"></i>
      <i class="pi pi-lock" aria-hidden="true"></i>
      <span class="multiport-summary__title">Multiport math</span>
      <span class="multiport-summary__hint">read-only · generated at export</span>
      <span class="multiport-summary__count">{{ entries.length }}</span>
    </button>
    <ul v-if="!collapsed" class="multiport-summary__body">
      <li v-for="(entry, index) in entries" :key="`${entry.portLabel}:${entry.variable}:${index}`" class="multiport-summary__entry">
        <template v-if="entry.type === 'Sum'">
          <div class="multiport-summary__row">
            <span class="multiport-chip" data-multiport="Sum" v-tooltip.top="`${entry.variable} (port ${entry.portLabel})`">
              {{ entry.variable }}
            </span>
            <span class="multiport-summary__op">=</span>
            <template v-for="(term, t) in entry.terms" :key="t">
              <span v-if="t" class="multiport-summary__op">+</span>
              <component
                :is="navigable ? 'button' : 'span'"
                :type="navigable ? 'button' : undefined"
                class="multiport-chip"
                v-tooltip.top="termSource(term)"
                @click="navigate(term)"
              >
                {{ scaledName(term.factor, term.variable) }}
              </component>
            </template>
            <template v-if="!entry.terms.length">
              <span v-if="entry.pending || entry.connected" class="multiport-summary__ellipsis">…</span>
              <span v-else-if="entry.linkedElsewhere" class="multiport-summary__note">not connected through this port</span>
              <template v-else>
                <span class="multiport-summary__zero">0</span>
                <span class="multiport-summary__note">nothing connected; 0 at export unless it has a value</span>
              </template>
            </template>
          </div>
        </template>
        <template v-else>
          <div v-for="(term, t) in entry.terms" :key="t" class="multiport-summary__row">
            <component
              :is="navigable ? 'button' : 'span'"
              :type="navigable ? 'button' : undefined"
              class="multiport-chip"
              :data-multiport="term.role === 'feedsSum' ? 'Sum' : undefined"
              v-tooltip.top="termSource(term)"
              @click="navigate(term)"
            >
              {{ term.variable }}
            </component>
            <span class="multiport-summary__op">=</span>
            <template v-if="term.role === 'feedsSum'">
              <span class="multiport-summary__ellipsis">…</span>
              <span class="multiport-summary__op">+</span>
            </template>
            <span class="multiport-chip" data-multiport="Multiply" v-tooltip.top="`${entry.variable} (port ${entry.portLabel})`">
              {{ scaledName(term.factor, entry.variable) }}
            </span>
          </div>
          <div v-if="!entry.terms.length" class="multiport-summary__row">
            <span class="multiport-chip" data-multiport="Multiply">{{ scaledName(entry.factor, entry.variable) }}</span>
            <span v-if="!entry.pending && !entry.connected" class="multiport-summary__note">not connected</span>
          </div>
        </template>
        <span v-if="entry.pending" class="multiport-summary__note">connections shown once the port is saved</span>
        <p v-for="issue in entry.issues" :key="issue" class="multiport-summary__issue">
          <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
          {{ issue }}
        </p>
      </li>
    </ul>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  // From multiportSummary (utils/multiport.js).
  entries: { type: Array, default: () => [] },
  // Whether clicking a term asks to go to its instance.
  navigable: { type: Boolean, default: false },
})

const emit = defineEmits(['navigate'])

const COLLAPSED_STORAGE_KEY = 'instanceEditorDialog.multiportSummaryCollapsed'

function readCollapsed() {
  try {
    return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

const collapsed = ref(readCollapsed())
const hasSum = computed(() => props.entries.some((entry) => entry.type === 'Sum'))

function toggle() {
  collapsed.value = !collapsed.value
  try {
    window.localStorage.setItem(COLLAPSED_STORAGE_KEY, String(collapsed.value))
  } catch {
    // Storage unavailable; the panel just forgets its state.
  }
}

/** A variable times its factor, the factor left out when it is 1. */
const scaledName = (factor, variable) => (factor == null || factor === 1 ? variable : `${factor} × ${variable}`)

/** Where a term's variable comes from, for its tooltip. */
const termSource = (term) => `${term.variable} from ${term.nodeName} (port ${term.portLabel})`

function navigate(term) {
  if (props.navigable) emit('navigate', { nodeId: term.nodeId, edgeId: term.edgeId, variable: term.variable })
}
</script>

<style scoped>
.multiport-summary {
  --accent: var(--p-orange-500);
  flex: 0 0 auto;
  margin-bottom: 8px;
  border: 1px dashed var(--p-content-border-color);
  border-left: 3px solid var(--accent);
  border-radius: 6px;
  background-color: color-mix(in srgb, var(--p-content-background) 96%, var(--p-text-color));
  font-size: 0.8125rem;
}

.multiport-summary--sum {
  --accent: var(--p-purple-500);
}

.multiport-summary__header {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 30px;
  padding: 0 10px 0 6px;
  border: 0;
  background: none;
  color: var(--p-text-muted-color);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.multiport-summary__header:hover {
  color: var(--p-text-color);
}

.multiport-summary__header:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.multiport-summary__title {
  color: var(--p-text-color);
  font-weight: 600;
}

.multiport-summary__hint {
  font-style: italic;
}

.multiport-summary__count {
  margin-left: auto;
  padding: 0 6px;
  border-radius: 999px;
  background-color: color-mix(in srgb, var(--accent) 16%, transparent);
  font-size: 11px;
}

.multiport-summary__body {
  max-height: 160px;
  margin: 0;
  padding: 2px 10px 8px 12px;
  overflow-y: auto;
  list-style: none;
  user-select: text;
}

.multiport-summary__entry + .multiport-summary__entry {
  margin-top: 6px;
}

.multiport-summary__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  min-height: 22px;
}

.multiport-summary__op,
.multiport-summary__zero,
.multiport-summary__ellipsis {
  font-family: 'Cambria Math', 'STIX Two Math', serif;
  color: var(--p-text-color);
}

.multiport-summary__note {
  margin-left: 4px;
  color: var(--p-text-muted-color);
  font-size: 11px;
  font-style: italic;
}

.multiport-summary__issue {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 2px 0 0;
  color: var(--p-red-500);
  font-size: 11px;
}
</style>
