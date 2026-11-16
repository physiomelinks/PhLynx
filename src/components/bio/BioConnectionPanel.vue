<template>
  <!-- One instance's couplings to another in the edge dialog's chips: this instance's ports left, the other's right -->
  <div class="bio-connection-panel" :title="`Select ${connection.name}`">
    <div class="bio-connection-panel__head">
      <NodeSideChip :label="connection.ownName" side="source" />
      <span class="bio-connection-panel__arrow">⇄</span>
      <NodeSideChip :label="connection.name" side="target" />
    </div>
    <div v-if="!connection.couplings.length" class="bio-connection-panel__empty">No couplings on this connection</div>
    <div v-for="(coupling, index) in connection.couplings" :key="index" class="bio-connection-panel__row">
      <span class="bio-connection-panel__port">
        <NodeSideChip :label="coupling.mine.name" side="source" />
        <span v-if="coupling.mine.annotation" class="bio-connection-panel__annotation">
          {{ coupling.mine.annotation }}
        </span>
      </span>
      <span
        class="bio-connection-panel__arrow"
        :title="coupling.outgoing ? 'From this instance' : 'Into this instance'"
      >
        {{ coupling.outgoing ? '→' : '←' }}
      </span>
      <span class="bio-connection-panel__port">
        <NodeSideChip :label="coupling.theirs.name" side="target" />
        <span v-if="coupling.theirs.annotation" class="bio-connection-panel__annotation">
          {{ coupling.theirs.annotation }}
        </span>
      </span>
    </div>
  </div>
</template>

<script setup>
import NodeSideChip from '../NodeSideChip.vue'

defineProps({
  // From connectionsMenu: { ownName, id, name, couplings }, `name` being the other instance's.
  connection: { type: Object, required: true },
})
</script>

<style scoped>
.bio-connection-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  min-width: 340px;
  max-height: 60vh;
  overflow-y: auto;
  cursor: pointer;
}
.bio-connection-panel__head {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--p-content-border-color, #ddd);
}
.bio-connection-panel__row {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.bio-connection-panel__port {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-width: 0;
}
.bio-connection-panel__row .bio-connection-panel__port:last-child {
  align-items: flex-end;
}
.bio-connection-panel__annotation {
  font-size: 11px;
  color: var(--p-text-muted-color, #909399);
}
.bio-connection-panel__arrow {
  color: var(--p-text-muted-color, #909399);
  font-size: 16px;
}
.bio-connection-panel__empty {
  font-size: 12px;
  color: var(--p-text-muted-color, #909399);
}
</style>

<style>
/* With no room on the right, PrimeVue moves a submenu left by its parent's width, over the instance list: this
   panel's goes fully left of that list instead. */
.p-contextmenu-submenu:has(> .bio-connection-item)[style*='inset-inline-start: -100%'] {
  inset-inline-start: auto !important;
  inset-inline-end: 100%;
}
</style>
