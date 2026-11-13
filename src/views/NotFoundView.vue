<template>
  <div class="flex flex-col items-center justify-center min-h-screen p-12 pb-32 text-center">
    
    <svg class="w-24 h-24 mb-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
    
    <p class="mb-6 text-base text-gray-500">Page Not Found</p>

    <Button label="Back to Workspace" @click="$router.push('/')" />
  </div>
</template>

<script setup>
  import Button from 'primevue/button'
</script>

<style lang="css" scoped>
  :deep(.p-button) {
    padding: 9px 20px;
    border-radius: 4px;
    font-size: 14px;
  }
</style>
