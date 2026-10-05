<template>
  <!-- A port variable, coloured by its multiport type; on a multiport, clicking its name moves it to the next type -->
  <span v-if="editable && type === 'Multiply'" class="multiport-chip multiport-chip--factor" :data-multiport="type">
    <button type="button" class="multiport-chip__name" :title="title" @mousedown.stop @click.stop="cycle">
      {{ name }}
    </button>
    <!-- Its factor, edited in place -->
    <span class="multiport-chip__times" aria-hidden="true">&times;</span>
    <input
      :class="['multiport-chip__factor', { 'multiport-chip__factor--invalid': invalid && factor == null }]"
      :value="factor"
      :style="{ width: `${Math.max(String(factor ?? '').length, 1) + 0.5}ch` }"
      inputmode="decimal"
      placeholder="1"
      :aria-label="`${name} multiply factor`"
      @mousedown.stop
      @click.stop
      @keydown.stop
      @keydown.enter="$event.target.blur()"
      @input="$event.target.style.width = `${Math.max($event.target.value.length, 1) + 0.5}ch`"
      @change="setFactor($event.target.value)"
    />
  </span>
  <button
    v-else-if="editable"
    type="button"
    class="multiport-chip"
    :data-multiport="type"
    :title="title"
    @mousedown.stop
    @click.stop="cycle"
  >
    {{ name }}
  </button>
  <span v-else class="multiport-chip" :data-multiport="type" :title="`${name}: ${type}`">
    {{ type === 'Multiply' ? `${name} ×${factor ?? 1}` : name }}
  </span>
</template>

<script setup>
import { computed } from 'vue'
import { cycleMultiportType, setVariableFactor, variableFactor, variableMultiportType } from '../utils/multiport'

const props = defineProps({
  port: { type: Object, required: true },
  name: { type: String, required: true },
  editable: { type: Boolean, default: false },
  // Flags a Multiply factor left blank.
  invalid: { type: Boolean, default: false },
})

const emit = defineEmits(['change'])

const type = computed(() => variableMultiportType(props.port, props.name))
const factor = computed(() => {
  const value = variableFactor(props.port, props.name)
  return value === '' ? null : (value ?? null)
})
const title = computed(() => `${props.name}: ${type.value} (click to change)`)

function cycle() {
  cycleMultiportType(props.port, props.name)
  emit('change')
}

/** Sets the factor typed into the chip; a blank one is left for the editor to flag, anything else not a number is ignored. */
function setFactor(text) {
  const value = text.trim() === '' ? null : Number(text)
  if (value !== null && !Number.isFinite(value)) return
  setVariableFactor(props.port, props.name, value)
  emit('change')
}
</script>

<style scoped>
.multiport-chip__name {
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  color: inherit;
  cursor: pointer;
}

.multiport-chip__name:focus-visible {
  outline: 2px solid var(--chip-color);
  outline-offset: 1px;
}

.multiport-chip__times {
  margin: 0 1px 0 3px;
}

/* Name, × and factor share one text baseline; the input otherwise sits on its own line box */
.multiport-chip--factor {
  align-items: baseline;
}

.multiport-chip__factor {
  --underline: var(--chip-color);
  min-width: 2ch;
  height: auto;
  margin: 0;
  padding: 0 1px;
  line-height: inherit;
  border: 0;
  border-radius: 0;
  /* A dashed underline drawn as a background, so the chip keeps its height */
  background: linear-gradient(to right, var(--underline) 60%, transparent 0) bottom / 4px 1px repeat-x;
  font: inherit;
  color: inherit;
  text-align: center;
}

.multiport-chip__factor:focus {
  outline: none;
  background:
    linear-gradient(var(--underline), var(--underline)) bottom / 100% 1px no-repeat,
    color-mix(in srgb, var(--chip-color) 12%, transparent);
}

.multiport-chip__factor--invalid {
  --underline: var(--p-red-500);
}
</style>
