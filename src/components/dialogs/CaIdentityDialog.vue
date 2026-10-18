<template>
  <Dialog
    :visible="!!question"
    modal
    header="Circulatory Autogen Identities"
    :style="{ width: '640px' }"
    @update:visible="(visible) => !visible && prompt.answer(null)"
    @mousedown.stop
    @wheel.stop
  >
    <form v-if="question" class="ca-identity-form" @submit.prevent="handleConfirm">
      <p class="ca-identity-message">
        {{ rows.length === 1 ? 'This super-module needs' : 'These super-modules need' }} a circulatory_autogen identity,
        a module_type and module_subtype, to be written as {{ rows.length === 1 ? 'a super-module' : 'super-modules' }}.
        Identities are kept for later exports.
      </p>
      <table class="ca-identity-table">
        <thead>
          <tr>
            <th scope="col">Super-module</th>
            <th scope="col">module_type</th>
            <th scope="col">module_subtype</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="(row, index) in rows" :key="row.smId">
            <tr>
              <th scope="row" class="ca-identity-name">
                {{ row.name }}
                <small v-if="row.reason === 'changed'" class="ca-identity-changed">changed from {{ row.from }}</small>
              </th>
              <td>
                <InputText
                  :id="`ca-identity-type-${index}`"
                  v-model="row.module_type"
                  :autofocus="index === 0"
                  :invalid="!!problems.get(row.smId)"
                  :aria-label="`${row.name} module_type`"
                  fluid
                />
              </td>
              <td>
                <InputText
                  :id="`ca-identity-subtype-${index}`"
                  v-model="row.module_subtype"
                  :invalid="!!problems.get(row.smId)"
                  :aria-label="`${row.name} module_subtype`"
                  :aria-describedby="problems.get(row.smId) ? `ca-identity-problem-${index}` : undefined"
                  fluid
                />
              </td>
            </tr>
            <tr v-if="problems.get(row.smId)">
              <td colspan="3">
                <small :id="`ca-identity-problem-${index}`" class="ca-identity-hint ca-identity-hint--error">{{ problems.get(row.smId) }}</small>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
      <small class="ca-identity-hint">
        Export flat writes {{ rows.length === 1 ? 'its super instances' : 'their super instances' }} as their modules,
        keeping no identity; Cancel stops the export.
      </small>
      <!-- Enter submits the form. -->
      <button type="submit" hidden />
    </form>

    <template #footer>
      <div class="dialog-footer">
        <Button label="Cancel" text severity="secondary" @click="prompt.answer(null)" />
        <Button label="Export flat" text @click="prompt.answer(new Map())" />
        <Button label="Keep identities and export" :disabled="hasProblem" @click="handleConfirm" />
      </div>
    </template>
  </Dialog>
</template>

<script setup>
/**
 * Asks, in one table, for the circulatory_autogen identity, module_type and module_subtype, of each super-module the
 * native CA export needs one for (see useCaIdentityPrompt). Offers each its name and a free `phlynx_v<n>`. Its answer
 * names them, exports them flat, or, from Cancel, the close button or Escape, cancels the export.
 */
import { computed, ref, watch } from 'vue'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'

import { useCaIdentityPrompt } from '../../composables/useCaIdentityPrompt'

const prompt = useCaIdentityPrompt()
const question = prompt.question

const rows = ref([])
const identities = computed(
  () => new Map(rows.value.map((row) => [row.smId, { module_type: row.module_type.trim(), module_subtype: row.module_subtype.trim() }]))
)
const problems = computed(() => (question.value ? question.value.problemsOf(identities.value) : new Map()))
const hasProblem = computed(() => [...problems.value.values()].some(Boolean))

// Each question offers its own suggestions.
watch(
  question,
  (asked) => {
    rows.value = (asked?.requests ?? []).map((request) => ({
      ...request,
      module_type: request.suggestion?.module_type ?? '',
      module_subtype: request.suggestion?.module_subtype ?? '',
    }))
  },
  { immediate: true }
)

function handleConfirm() {
  if (!hasProblem.value) prompt.answer(identities.value)
}
</script>

<style scoped>
.ca-identity-form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.ca-identity-message {
  margin: 0 0 0.5rem;
  line-height: 1.5;
}

.ca-identity-table {
  width: 100%;
  border-collapse: collapse;
}

.ca-identity-table th,
.ca-identity-table td {
  padding: 0.25rem;
  text-align: left;
  vertical-align: middle;
}

.ca-identity-name {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.ca-identity-changed {
  display: block;
  font-weight: normal;
  color: var(--p-text-muted-color);
}

.ca-identity-hint {
  color: var(--p-text-muted-color);
}

.ca-identity-hint--error {
  color: var(--p-red-500);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}
</style>
