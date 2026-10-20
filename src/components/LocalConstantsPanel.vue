<template>
  <div class="local-constants-panel">
    <h5 class="local-constants-title">Local constants ({{ declarations.length }})</h5>
    <p class="hint">
      Constants this super-module's own modules share: set a module's row type to "local" to use one. Values here are
      the super-module's defaults; each super instance can override them.
    </p>

    <ul v-if="declarations.length" class="local-constants-list" aria-label="Local constants">
      <li v-for="declaration in declarations" :key="declaration.name" class="local-constant" :data-local-constant="declaration.name">
        <span class="local-constant-name" :title="declaration.name">{{ declaration.name }}</span>
        <InputText
          :model-value="declaration.value"
          size="small"
          class="local-constant-value"
          placeholder="Value..."
          :aria-label="`Value of ${declaration.name}`"
          @change="setValue(declaration, $event.target.value)"
        />
        <span class="local-constant-units" :title="declaration.units">{{ declaration.units || '—' }}</span>
        <span class="local-constant-uses" v-tooltip.top="{ value: usesText(declaration), showDelay: 300 }">
          ×{{ usageOf(smId, declaration.name).length }}
        </span>
        <Button
          icon="pi pi-trash"
          text
          rounded
          size="small"
          severity="danger"
          :aria-label="`Remove ${declaration.name}`"
          v-tooltip.left="{ value: 'Remove local constant', showDelay: 300 }"
          @click="onRemove(declaration)"
        />
      </li>
    </ul>

    <form class="local-constant-add" @submit.prevent="onDeclare">
      <Select
        v-model="draft.name"
        :options="candidates"
        option-label="name"
        option-value="name"
        editable
        size="small"
        class="local-constant-add-name"
        placeholder="Name"
        aria-label="New local constant name"
        @change="onPickName"
      />
      <!-- In the list's columns: value, then units. -->
      <InputText v-model="draft.value" size="small" class="local-constant-add-value" placeholder="Value" aria-label="New local constant value" />
      <InputText v-model="draft.units" size="small" class="local-constant-add-units" placeholder="Units" aria-label="New local constant units" />
      <Button type="submit" icon="pi pi-plus" size="small" :disabled="!draft.name?.trim()" aria-label="Declare local constant" v-tooltip.left="'Declare'" />
    </form>
    <label v-if="bindableCount" class="local-constant-bind">
      <Checkbox v-model="bind" binary input-id="local-constant-bind" />
      <span>Use it for the {{ bindableCount }} {{ bindableCount === 1 ? 'module' : 'modules' }} with a constant of that name</span>
    </label>
    <p v-if="problem" class="local-constant-problem" role="alert">{{ problem }}</p>
  </div>
</template>

<script setup>
/**
 * A super-module's local constants, for its interface node's sidebar: declare one (from its modules' constants, or a
 * new name), set a declared value, or remove one, which asks first when modules use it. Each change is one undo step.
 */
import { computed, reactive, ref } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import Button from 'primevue/button'
import Checkbox from 'primevue/checkbox'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'

import { useConfirmDialog } from '../composables/useConfirmDialog'
import { useLocalConstants } from '../composables/useLocalConstants'
import { FLOW_IDS } from '../utils/constants'
import { localConstantsOf } from '../services/hierarchy/localConstants'

const props = defineProps({
  smId: { type: String, required: true },
})

const { findNode } = useVueFlow(FLOW_IDS.MAIN)
const { candidatesOf, usageOf, nameProblemOf, declare, update, remove } = useLocalConstants()
const { confirm } = useConfirmDialog()

const declarations = computed(() => localConstantsOf(findNode(props.smId)))
const candidates = computed(() => candidatesOf(props.smId))

const draft = reactive({ name: '', units: '', value: '' })
const bind = ref(true)
const problem = ref('')

// The modules a new constant of the draft's name would be used for.
const bindableCount = computed(() => {
  const candidate = candidates.value.find((entry) => entry.name === draft.name?.trim())
  return candidate && (!draft.units || !candidate.units || candidate.units === draft.units) ? candidate.count : 0
})

/** @returns {string} Which modules use a local constant. */
function usesText(declaration) {
  const names = usageOf(props.smId, declaration.name).map((node) => node.data?.name)
  return names.length ? `Used by ${names.join(', ')}` : 'No module uses it yet'
}

/** Fills in the units and value of a picked module constant. */
function onPickName() {
  const candidate = candidates.value.find((entry) => entry.name === draft.name)
  if (!candidate) return
  draft.units = candidate.units
  draft.value = candidate.value
}

async function onDeclare() {
  problem.value = nameProblemOf(props.smId, draft.name) ?? ''
  if (problem.value) return
  await declare(props.smId, { ...draft, name: draft.name.trim() }, { bind: bind.value && bindableCount.value > 0 })
  Object.assign(draft, { name: '', units: '', value: '' })
}

function setValue(declaration, value) {
  if (String(declaration.value ?? '') !== value) update(props.smId, declaration.name, { value })
}

async function onRemove(declaration) {
  const users = usageOf(props.smId, declaration.name)
  if (users.length) {
    const isOne = users.length === 1
    const proceed = await confirm({
      header: 'Remove local constant?',
      message: `${isOne ? 'One module uses' : `${users.length} modules use`} "${declaration.name}". Removing it makes ${isOne ? 'its row a constant' : 'their rows constants'} with the value each super instance has now.`,
      severity: 'warning',
      acceptLabel: 'Remove',
      rejectLabel: 'Cancel',
    })
    if (!proceed) return
  }
  await remove(props.smId, declaration.name)
}
</script>

<style scoped>
.local-constants-title {
  margin: 0.75rem 0 0.25rem;
  font-size: 13px;
}

.hint {
  margin: 0 0 0.5rem;
  font-size: 12px;
  color: var(--p-text-muted-color);
}

.local-constants-list {
  margin: 0 0 0.5rem;
  padding: 0;
  list-style: none;
  font-size: 13px;
}

.local-constant,
.local-constant-add {
  /* One grid for the rows and the add row, so their columns line up: name, value, units, uses, action. */
  display: grid;
  grid-template-columns: minmax(0, 1fr) 5.5rem 5rem 2rem 2rem;
  align-items: center;
  gap: 0.35rem;
  margin-bottom: 0.25rem;
}

.local-constant-name {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: var(--p-font-family-mono, monospace);
}

.local-constant-value,
.local-constant-add-value,
.local-constant-add-name,
.local-constant-add-units {
  width: 100%;
  min-width: 0;
}

.local-constant-units,
.local-constant-uses {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 12px;
  color: var(--p-text-muted-color);
}

/* The add row has no uses: its button takes the action column. */
.local-constant-add > :last-child {
  grid-column: 5;
}

.local-constant-bind {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 12px;
}

.local-constant-problem {
  margin: 0.25rem 0 0;
  font-size: 12px;
  color: var(--p-red-500);
}
</style>
