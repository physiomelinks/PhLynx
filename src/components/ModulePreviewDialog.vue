<template>
  <Dialog
    v-model:visible="visible"
    modal
    :dismissableMask="true"
    :header="`Preview: ${moduleData?.moduleRef}`"
    :style="{ width: '800px' }"
    :appendTo="'body'"
  >
    <TabView v-if="moduleData" v-model:activeIndex="activeTabIndex" class="w-full">
      <TabPanel header="Variables & Units">
        <DataTable :value="moduleData?.variables" :scrollable="true" scrollHeight="400px" stripedRows>
          <Column field="name" header="Name" style="width: 180px" />
          <Column field="units" header="Units" style="width: 150px" />
          <Column field="access" header="Accessibility" />
          <Column header="Type">
            <template #body="slotProps">
              <Tag>{{ slotProps.data.type }}</Tag>
            </template>
          </Column>
        </DataTable>
      </TabPanel>

      <TabPanel header="Ports">
        <DataTable
          ref="portTable"
          :value="moduleData?.ports"
          :scrollable="true"
          scrollHeight="400px"
          stripedRows
          :sortField="'access'"
          :sortOrder="1"
        >
          <Column field="portType" header="Type" style="width: 200px" sortable>
            <template #body="slotProps">
              <strong>{{ slotProps.data.portType }}</strong>
            </template>
          </Column>

          <Column field="variables" header="Port Variable(s)">
            <template #body="slotProps">
              <div v-if="slotProps.data.variables && slotProps.data.variables.length" class="flex flex-wrap gap-1">
                <MultiportChip v-for="v in slotProps.data.variables" :key="v" :port="slotProps.data" :name="v" />
              </div>
              <span v-else class="text-slate-500">-</span>
            </template>
          </Column>

        </DataTable>
      </TabPanel>
    </TabView>

    <template #footer>
      <Button label="Close" severity="secondary" text @click="visible = false" />
    </template>
  </Dialog>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import Button from 'primevue/button'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import Dialog from 'primevue/dialog'
import TabPanel from 'primevue/tabpanel'
import TabView from 'primevue/tabview'
import Tag from 'primevue/tag'
import MultiportChip from './MultiportChip.vue'

const props = defineProps({
  modelValue: Boolean,
  moduleData: Object, // { moduleRef, variables, ports }
})

const emit = defineEmits(['update:modelValue'])

const portTable = ref(null)
const activeTabIndex = ref(0)

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
})

watch(visible, (newVal) => {
  if (newVal) {
    activeTabIndex.value = 0
    if (portTable.value?.resetSort) {
      portTable.value.resetSort()
    }
  }
})
</script>
