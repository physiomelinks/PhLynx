<template>
  <Popover ref="popover" @show="emit('update:open', true)" @hide="emit('update:open', false)">
    <div class="species-menu" role="dialog" aria-label="Species shown" data-testid="bio-species-menu">
      <fieldset class="species-menu__group">
        <legend>Show</legend>
        <label v-for="option in SCOPES" :key="option.scope" class="species-menu__row">
          <input
            type="radio"
            name="bio-species-scope"
            :value="option.scope"
            :checked="scope === option.scope"
            @change="emit('update:scope', option.scope)"
          />
          {{ option.label }}
        </label>
      </fieldset>

      <fieldset class="species-menu__group">
        <legend>Species</legend>
        <div class="species-menu__all">
          <Button label="All" size="small" text :disabled="!hidden.length" @click="emit('update:hidden', [])" />
          <Button
            label="None"
            size="small"
            text
            :disabled="species.every((entry) => hidden.includes(entry.species))"
            @click="emit('update:hidden', [...new Set([...hidden, ...species.map((entry) => entry.species)])])"
          />
        </div>
        <p v-if="!species.length" class="species-menu__empty">No species to show.</p>
        <label
          v-for="entry in species"
          :key="entry.species"
          class="species-menu__row"
          data-testid="bio-species-menu-item"
          :data-species="entry.species"
        >
          <input type="checkbox" :checked="!hidden.includes(entry.species)" @change="toggle(entry.species)" />
          <span class="species-menu__swatch" :style="{ background: entry.colour }"></span>
          {{ entry.label }}
        </label>
      </fieldset>
    </div>
  </Popover>
</template>

<script setup>
import Button from 'primevue/button'
import Popover from 'primevue/popover'
import { ref } from 'vue'

const props = defineProps({
  /** Every species in scope, hidden ones too: { species (CURIE), label, colour }. */
  species: { type: Array, default: () => [] },
  /** The CURIEs of the species hidden. */
  hidden: { type: Array, default: () => [] },
  /** 'coupled', 'fluxes' or 'all'. */
  scope: { type: String, default: 'coupled' },
})
const emit = defineEmits(['update:hidden', 'update:scope', 'update:open'])

const SCOPES = [
  { scope: 'coupled', label: 'Coupled species' },
  { scope: 'fluxes', label: 'Species with fluxes' },
  { scope: 'all', label: 'All annotated species' },
]

const popover = ref(null)

/** Hides a shown species, or shows a hidden one. */
function toggle(curie) {
  emit(
    'update:hidden',
    props.hidden.includes(curie) ? props.hidden.filter((other) => other !== curie) : [...props.hidden, curie]
  )
}

defineExpose({
  /** Opens the menu by the button clicked, or closes it. */
  toggle: (event) => popover.value?.toggle(event),
})
</script>

<style scoped>
.species-menu {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 13rem;
  max-height: 60vh;
  overflow-y: auto;
  font-size: 0.875rem;
}

.species-menu__group {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin: 0;
  padding: 0;
  border: 0;
}

.species-menu__group legend {
  padding: 0;
  margin-bottom: 0.25rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--p-text-muted-color);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.species-menu__row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}

.species-menu__swatch {
  width: 0.75rem;
  height: 0.75rem;
  border-radius: 50%;
  flex: none;
}

.species-menu__all {
  display: flex;
  gap: 0.25rem;
  margin-left: -0.5rem;
}

.species-menu__empty {
  margin: 0;
  color: var(--p-text-muted-color);
}
</style>
