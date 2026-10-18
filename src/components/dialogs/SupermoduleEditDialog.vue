<template>
  <Dialog
    :visible="!!question"
    modal
    header="Change Super-module?"
    :style="{ width: '440px', maxWidth: '95vw' }"
    @update:visible="(visible) => !visible && guard.answer('cancel')"
    @mousedown.stop
    @wheel.stop
  >
    <p v-if="question" class="supermodule-edit-message">
      This changes super-module '{{ question.name }}' in the library, used by {{ question.count }} super
      instance{{ question.count === 1 ? '' : 's' }}.
    </p>

    <template #footer>
      <div class="dialog-footer">
        <Button label="Cancel" text @click="guard.answer('cancel')" />
        <Button label="Make this one a new super-module" severity="secondary" @click="guard.answer('new')" />
        <Button :label="changeAllLabel" autofocus @click="guard.answer('all')" />
      </div>
    </template>
  </Dialog>
</template>

<script setup>
/**
 * Asks what the first structural edit inside a shared or library super-module does (see useSupermoduleEditGuard):
 * change it for all its super instances, make this super instance a new super-module, or cancel the edit. Closing it
 * cancels.
 */
import { computed } from 'vue'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'

import { useSupermoduleEditGuard } from '../../composables/useSupermoduleEditGuard'

const guard = useSupermoduleEditGuard()
const question = guard.question

const changeAllLabel = computed(() => {
  const count = question.value?.count ?? 0
  return count > 1 ? `Change all ${count}` : 'Change it'
})
</script>

<style scoped>
.supermodule-edit-message {
  margin: 0;
  line-height: 1.5;
}

.dialog-footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
}
</style>
