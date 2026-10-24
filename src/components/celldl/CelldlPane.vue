<template>
  <div class="celldl-pane">
    <div v-if="isPending" class="celldl-pane-pending">
      <ProgressSpinner style="width: 32px; height: 32px" strokeWidth="4" />
      <span>{{ host.isReady.value ? 'Opening the diagram...' : 'Starting the diagram editor...' }}</span>
    </div>
    <Message v-if="host.error.value" class="celldl-pane-error" severity="error" size="small" :closable="false">
      {{ host.error.value }}
    </Message>
    <!-- Hidden while opening, or after failing to, as the editor still shows the last module's diagram. -->
    <div ref="slotRef" class="celldl-pane-slot" :class="{ 'is-hidden': isPending || host.error.value }"></div>
    <div v-if="isLiveShown" class="celldl-live" :data-state="liveState">
      <span class="celldl-live-status" role="status" :title="liveTitle">
        <button
          v-if="issueList.length"
          type="button"
          class="celldl-live-issues"
          aria-haspopup="dialog"
          :aria-expanded="!!issuePopover?.visible"
          @click="toggleIssueList"
        >
          <span>{{ liveStatus }}</span>
          <i class="pi pi-angle-up" aria-hidden="true"></i>
        </button>
        <template v-else>{{ liveStatus }}</template>
      </span>
    </div>
    <Popover ref="issuePopover">
      <ul class="celldl-issue-list" aria-label="Conversion issues">
        <li v-for="(item, index) in issueList" :key="item.key" :data-severity="item.severity">
          <i
            :class="['pi', item.severity === 'error' ? 'pi-times-circle' : 'pi-exclamation-triangle']"
            :aria-label="item.severity === 'error' ? 'Error' : 'Warning'"
          ></i>
          <div class="celldl-issue-text">
            <button
              v-if="item.elementId"
              type="button"
              class="celldl-issue-element"
              :data-element-id="item.elementId"
              :autofocus="index === firstLinkIndex"
              :title="`Show ${item.label} in the diagram`"
              @click="showIssueElement(item)"
            >
              {{ item.label }}
            </button>
            <span class="celldl-issue-message">{{ item.message }}</span>
            <span v-if="missingIds.has(item.elementId)" class="celldl-issue-missing">No longer in the diagram</span>
          </div>
        </li>
      </ul>
    </Popover>
  </div>
</template>

<script setup>
/**
 * The instance editor's CellDL tab: it shows the app's one CellDL editor (useCelldlEditorHost) while mounted,
 * with the source the dialog prepared. Selecting a diagram element emits the variable it plots. Below the diagram,
 * the live conversion (useLiveCelldlConvert) says whether it converts; the math editors show its CellML.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import Message from 'primevue/message'
import Popover from 'primevue/popover'
import ProgressSpinner from 'primevue/progressspinner'

import { useCelldlEditorHost } from '../../composables/useCelldlEditorHost'
import { useLiveCelldlConvert } from '../../composables/useLiveCelldlConvert'
import { variableForElement } from '../../services/celldl/elements'
import { compartmentLocationWarnings, issueItems } from '../../services/celldl/issues'

const props = defineProps({
  /** The instance's variable rows, which an element's variable must have to be plotted. */
  rows: { type: Array, default: () => [] },
  /** The module's component name and math, which the live conversion generates its CellML as. */
  componentName: { type: String, default: undefined },
  mathRef: { type: String, default: null },
})

const emit = defineEmits(['variable-click'])

const host = useCelldlEditorHost()
const live = useLiveCelldlConvert()
const slotRef = ref(null)
const isPending = computed(() => !host.isReady.value || host.isSyncing.value)

// Not for a diagram that failed to open, as the editor still shows the one before.
const isLiveShown = computed(() => live.isAvailable && !host.error.value)

/** The editor's warnings of stores and sources whose location isn't their compartment's. */
const locationWarnings = computed(() => compartmentLocationWarnings(host.elements.value))

/** The live conversion's warnings, with the editor's. */
const warnings = computed(() => [...(live.result.value?.warnings ?? []), ...locationWarnings.value])

/** The live conversion's state: off, converting, ok, warnings or errors. */
const liveState = computed(() => {
  if (live.error.value) return 'off'
  const result = live.result.value
  if (live.isPending.value || !result) return 'converting'
  if (result.errors.length) return 'errors'
  return warnings.value.length ? 'warnings' : 'ok'
})

const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`

const liveStatus = computed(() => {
  switch (liveState.value) {
    case 'off':
      return 'Live conversion is unavailable'
    case 'converting':
      return 'Converting…'
    case 'errors':
      return `${plural(live.issues.value.length + locationWarnings.value.length, 'issue')}, checked again on save`
    case 'warnings':
      return `Converts, with ${plural(warnings.value.length, 'warning')}`
    default:
      // Runs check the saved module, so until the diagram is saved only its conversion is known.
      if (host.isDirty.value) return 'Converts, not yet saved'
      return isRunnable.value ? 'Converts and runs' : 'Converts'
  }
})

/** Whether libCellML found the diagram's CellML runnable. */
const isRunnable = computed(() => live.latest.value?.pass === 'full' && !!live.result.value?.runnable)

const liveTitle = computed(() => {
  if (live.error.value) return live.error.value
  if (live.issues.value.length || locationWarnings.value.length) return ''
  if (live.isChecking.value && !live.isPending.value) return 'Checking with libCellML…'
  if (live.latest.value?.pass !== 'full') return ''
  if (host.isDirty.value && isRunnable.value) return 'Checked with libCellML: it runs once saved'
  return 'Checked with libCellML'
})

/**
 * The live conversion's issues, errors first, then the editor's location warnings, each naming its element by the
 * label the conversion, or else the diagram's annotations, give it.
 */
const issueList = computed(() => {
  const result = live.result.value
  if (!result || live.error.value) return []
  return issueItems(
    { errors: result.errors, warnings: warnings.value },
    { elements: result.elements, annotations: host.annotations.value }
  )
})

const issuePopover = ref(null)
const firstLinkIndex = computed(() => issueList.value.findIndex((item) => item.elementId))
/** The elements issues name that the diagram no longer has, as found on trying to show them. */
const missingIds = ref(new Set())

// A new conversion's issues are listed afresh, and with none left the list closes, as its button goes.
watch(issueList, (list) => {
  missingIds.value = new Set()
  if (!list.length) issuePopover.value?.hide()
})

/**
 * Opens or closes the issue list, forgetting the elements found gone when it last showed.
 *
 * @param {MouseEvent} event
 */
function toggleIssueList(event) {
  if (!issuePopover.value.visible) missingIds.value = new Set()
  issuePopover.value.toggle(event)
}

/**
 * Selects the element an issue names and centres it, at the same zoom, noting it if it has gone since.
 *
 * @param {{elementId: string}} item
 */
async function showIssueElement(item) {
  try {
    const { ok } = await host.revealElement(item.elementId)
    if (!ok) missingIds.value = new Set([...missingIds.value, item.elementId])
  } catch (e) {
    console.error("CellDL element couldn't be shown:", e)
  }
}

watch(
  () => [props.componentName, props.mathRef],
  ([componentName, mathRef]) => live.setModule({ componentName, mathRef }),
  { immediate: true }
)

/**
 * Emits the variable of a selected element: one the instance has, or else, for an element added since the diagram
 * was saved, its own, which saving makes plottable.
 *
 * @param {{type: string, component?: {id: string, annotation?: Object}}} event - The editor's viewer event.
 */
function onViewerEvent(event) {
  if (event?.type !== 'select') return
  const annotation = event.component?.annotation
  const name = variableForElement(annotation, props.rows)
  if (name) return emit('variable-click', name)
  const unsaved = annotation?.primary ?? annotation?.variables?.[0]
  if (unsaved) emit('variable-click', typeof unsaved === 'string' ? unsaved : unsaved.name, { isUnsaved: true })
}

onMounted(() => {
  live.start().catch(() => {})
  host.claim(slotRef.value, onViewerEvent)
  host.sync().catch((error) => {
    host.error.value = error.message
  })
})

onBeforeUnmount(() => host.release(slotRef.value))
</script>

<style scoped>
.celldl-pane {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.celldl-pane-slot {
  flex: 1;
  min-height: 0;
}

.celldl-pane-slot.is-hidden {
  visibility: hidden;
}

.celldl-pane-pending {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  color: var(--p-text-muted-color);
}

.celldl-live {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.25rem 0.5rem;
  border-top: 1px solid var(--p-content-border-color);
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
}

.celldl-live-status {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.celldl-live[data-state='errors'] .celldl-live-status,
.celldl-live[data-state='warnings'] .celldl-live-status {
  color: var(--p-orange-500);
}

.celldl-live-issues {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  max-width: 100%;
  padding: 0;
  border: none;
  border-radius: 2px;
  background: none;
  font: inherit;
  color: inherit;
  cursor: pointer;
}

.celldl-live-issues span {
  overflow: hidden;
  text-overflow: ellipsis;
}

.celldl-live-issues .pi {
  font-size: 0.7rem;
}

.celldl-live-issues:hover span {
  text-decoration: underline;
}

.celldl-live-issues:focus-visible,
.celldl-issue-element:focus-visible {
  outline: 2px solid var(--p-primary-color);
  outline-offset: 2px;
}

.celldl-issue-list {
  max-width: 26rem;
  max-height: 20rem;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
  font-size: 0.8125rem;
}

.celldl-issue-list li {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  padding: 0.25rem 0;
}

.celldl-issue-list li + li {
  border-top: 1px solid var(--p-content-border-color);
}

.celldl-issue-list .pi {
  flex: none;
  font-size: 0.75rem;
}

.celldl-issue-list [data-severity='error'] .pi {
  color: var(--p-red-600);
}

.celldl-issue-list [data-severity='warning'] .pi {
  color: var(--p-orange-600);
}

/* Not :global(.p-dark) …, which compiles to a bare .p-dark rule, colouring the whole page. */
.p-dark .celldl-issue-list [data-severity='error'] .pi {
  color: var(--p-red-400);
}

.p-dark .celldl-issue-list [data-severity='warning'] .pi {
  color: var(--p-orange-400);
}

.celldl-issue-text {
  min-width: 0;
  overflow-wrap: anywhere;
}

.celldl-issue-element {
  margin-right: 0.375rem;
  padding: 0;
  border: none;
  border-radius: 2px;
  background: none;
  font: inherit;
  font-weight: 600;
  color: var(--p-primary-color);
  cursor: pointer;
}

.celldl-issue-element:hover {
  text-decoration: underline;
}

.celldl-issue-missing {
  display: block;
  font-style: italic;
  color: var(--p-text-muted-color);
}

.celldl-pane-error {
  margin-bottom: 0.5rem;
}
</style>
