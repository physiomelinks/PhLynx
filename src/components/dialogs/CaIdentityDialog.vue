<template>
  <Dialog
    :visible="!!question"
    modal
    header="Name Super-module for Circulatory Autogen"
    :style="{ width: '440px', maxWidth: '95vw' }"
    @update:visible="(visible) => !visible && prompt.answer(null)"
    @mousedown.stop
    @wheel.stop
  >
    <form v-if="question" class="ca-identity-form" @submit.prevent="handleConfirm">
      <p class="ca-identity-message">
        <template v-if="question.reason === 'changed'">
          Super-module '{{ question.name }}' no longer matches library super-module {{ question.from }}, so it needs a
          circulatory_autogen identity of its own.
        </template>
        <template v-else>Super-module '{{ question.name }}' needs a circulatory_autogen identity to be written as one.</template>
        It is kept for later exports.
      </p>
      <label for="ca-identity-type">module_type</label>
      <InputText id="ca-identity-type" v-model="moduleType" autofocus :invalid="!!problem" />
      <label for="ca-identity-subtype">module_subtype</label>
      <InputText id="ca-identity-subtype" v-model="moduleSubtype" :invalid="!!problem" aria-describedby="ca-identity-hint" />
      <small id="ca-identity-hint" :class="['ca-identity-hint', { 'ca-identity-hint--error': problem }]">
        {{ problem ?? 'Cancel writes its super instances as their modules.' }}
      </small>
    </form>

    <template #footer>
      <div class="dialog-footer">
        <Button label="Export flat" text @click="prompt.answer(null)" />
        <Button label="Name" :disabled="!!problem" @click="handleConfirm" />
      </div>
    </template>
  </Dialog>
</template>

<script setup>
/**
 * Asks for a super-module's circulatory_autogen identity, module_type and module_subtype, before the native CA export
 * writes it (see useCaIdentityPrompt). Offers its name and a free `phlynx_v<n>`; cancelling writes it flat.
 */
import { computed, ref, watch } from 'vue'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'

import { useCaIdentityPrompt } from '../../composables/useCaIdentityPrompt'

const prompt = useCaIdentityPrompt()
const question = prompt.question

const moduleType = ref('')
const moduleSubtype = ref('')
const identity = computed(() => ({ module_type: moduleType.value.trim(), module_subtype: moduleSubtype.value.trim() }))
const problem = computed(() => (question.value ? question.value.problemOf(identity.value) : null))

// Each question offers its own suggestion.
watch(question, (asked) => {
  moduleType.value = asked?.suggestion?.module_type ?? ''
  moduleSubtype.value = asked?.suggestion?.module_subtype ?? ''
})

function handleConfirm() {
  if (!problem.value) prompt.answer(identity.value)
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
