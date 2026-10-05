<template>
  <!-- A port's variable chips; the ones past `limit` open from a "+N" chip -->
  <span :class="['port-variable-chips', { 'port-variable-chips--wrap': limit === Infinity }]">
    <span class="port-variable-chips__shown">
      <MultiportChip
        v-for="name in port.variables.slice(0, limit)"
        :key="name"
        :port="port"
        :name="name"
        :editable="isMultiport(port)"
        :invalid="invalid"
        @change="$emit('change')"
      />
    </span>
    <button
      v-if="port.variables.length > limit"
      type="button"
      class="multiport-chip port-variable-chips__more"
      title="More variables"
      @mousedown.stop
      @click.stop="popover.toggle($event)"
    >
      +{{ port.variables.length - limit }}
    </button>
    <Popover ref="popover">
      <div class="more-chips">
        <MultiportChip
          v-for="name in port.variables.slice(limit)"
          :key="name"
          :port="port"
          :name="name"
          :editable="isMultiport(port)"
          :invalid="invalid"
          @change="$emit('change')"
        />
      </div>
    </Popover>
  </span>
</template>

<script setup>
import { ref } from 'vue'
import Popover from 'primevue/popover'
import MultiportChip from './MultiportChip.vue'
import { isMultiport } from '../utils/multiport'

defineProps({
  port: { type: Object, required: true },
  // Chips shown in place; Infinity shows them all, wrapping.
  limit: { type: Number, default: Infinity },
  // Flags a Multiply factor left blank.
  invalid: { type: Boolean, default: false },
})

defineEmits(['change'])

const popover = ref(null)
</script>

<style scoped>
.port-variable-chips {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.port-variable-chips__shown {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
}

.port-variable-chips--wrap,
.port-variable-chips--wrap .port-variable-chips__shown {
  flex-wrap: wrap;
}

/* Never clipped, so the rest of the chips stay in reach */
.port-variable-chips__more {
  flex: none;
}

.more-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  max-width: 240px;
}
</style>
