<template>
  <div class="protocol-picker">
    <form v-if="mode" class="picker-row" @submit.prevent="confirmName">
      <label :for="inputId" class="picker-label">{{ MODES[mode].label }}</label>
      <InputText
        :id="inputId"
        ref="nameInput"
        v-model="name"
        size="small"
        class="picker-name"
        :invalid="!!problem"
        :aria-describedby="problem || isRenamed ? problemId : undefined"
        @keydown.esc.stop.prevent="stopNaming"
      />
      <Button type="submit" :label="MODES[mode].action" size="small" :disabled="!!problem" />
      <Button label="Cancel" text size="small" severity="secondary" @click="stopNaming" />
      <small v-if="problem" :id="problemId" class="picker-problem" role="status">{{ problem }}</small>
      <small v-else-if="isRenamed" :id="problemId" class="picker-hint" role="status">Shown as “{{ shownName }}”</small>
    </form>

    <div v-else class="picker-row">
      <label :for="selectId" class="picker-label">Protocol</label>
      <!-- Drawn afresh after each pick, so it shows the active protocol still when a switch is called off. -->
      <Select
        :key="pickCount"
        :input-id="selectId"
        :model-value="activeLocation"
        :options="protocols"
        option-label="name"
        option-value="location"
        size="small"
        class="picker-select"
        aria-label="Protocol to edit and run"
        @update:model-value="pick"
      />
      <Button icon="pi pi-plus" label="New" text size="small" v-tooltip.bottom="'A new, empty protocol'" @click="startNaming('create')" />
      <Button icon="pi pi-copy" label="Duplicate" text size="small" v-tooltip.bottom="'A copy of this protocol and its observations'" @click="startNaming('duplicate')" />
      <Button icon="pi pi-pencil" label="Rename" text size="small" @click="startNaming('rename')" />
      <Button icon="pi pi-trash" label="Delete" text size="small" severity="danger" @click="emit('remove')" />
    </div>
  </div>
</template>

<script setup>
/**
 * Which of the workspace's protocols is active, and buttons to add, copy, rename and delete them. Naming one takes
 * over the row until it is confirmed or cancelled.
 */
import { computed, nextTick, ref, useId } from 'vue'

import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'

const MODES = {
  create: { label: 'New protocol', action: 'Create' },
  duplicate: { label: 'Copy as', action: 'Duplicate' },
  rename: { label: 'Rename to', action: 'Rename' },
}

const props = defineProps({
  // The protocols, as `{ location, name }`.
  protocols: { type: Array, required: true },
  activeLocation: { type: String, default: null },
  // Says what is wrong with a name, given the protocol being renamed; empty when it will do.
  checkName: { type: Function, required: true },
  // Gives the name a protocol is shown with once given a name.
  nameProtocol: { type: Function, required: true },
})
const emit = defineEmits(['choose', 'create', 'duplicate', 'rename', 'remove'])

const selectId = useId()
const inputId = useId()
const problemId = useId()
const nameInput = ref(null)
// How many protocols have been picked, to draw the list afresh after each.
const pickCount = ref(0)
// What the name being typed is for, or null while choosing.
const mode = ref(null)
const name = ref('')
const activeName = computed(() => props.protocols.find(({ location }) => location === props.activeLocation)?.name ?? '')
const problem = computed(() => props.checkName(name.value, mode.value === 'rename' ? props.activeLocation : undefined))
// The name as it will be shown, which keeps only some of the characters typed.
const shownName = computed(() => props.nameProtocol(name.value))
const isRenamed = computed(() => shownName.value !== name.value.trim())

/**
 * Asks for another protocol to be the active one.
 *
 * @param {string} location
 */
function pick(location) {
  pickCount.value += 1
  if (location !== props.activeLocation) emit('choose', location)
}

/**
 * Gives a name like the one given that no protocol has, numbering it when one does.
 *
 * @param {string} base
 * @returns {string}
 */
function findFreeName(base) {
  if (!props.checkName(base)) return base
  for (let number = 2; ; number += 1) {
    if (!props.checkName(`${base} ${number}`)) return `${base} ${number}`
  }
}

/**
 * Asks for a name, suggesting one.
 *
 * @param {'create'|'duplicate'|'rename'} nextMode
 */
async function startNaming(nextMode) {
  mode.value = nextMode
  name.value = nextMode === 'rename' ? activeName.value : findFreeName(nextMode === 'create' ? 'Protocol' : `${activeName.value} copy`)
  await nextTick()
  const input = nameInput.value?.$el
  input?.focus()
  input?.select()
}

/** Goes back to choosing, with the protocol list focused, as naming was started from there. */
async function stopNaming() {
  mode.value = null
  await nextTick()
  document.getElementById(selectId)?.focus()
}

/** Hands on the name once it will do. */
function confirmName() {
  if (problem.value) return
  if (mode.value !== 'rename' || shownName.value !== activeName.value) emit(mode.value, name.value.trim())
  stopNaming()
}
</script>

<style scoped>
.protocol-picker {
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--p-content-border-color);
}

.picker-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.picker-label {
  font-size: 0.875rem;
  font-weight: 600;
}

.picker-select,
.picker-name {
  width: 16rem;
  max-width: 100%;
}

.picker-problem {
  color: var(--p-red-500);
}

.picker-hint {
  color: var(--p-text-muted-color);
}
</style>
