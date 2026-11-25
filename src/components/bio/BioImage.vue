<template>
  <!-- An image of the pieces: a picture on the canvas, only to look at; with none yet, a placeholder to choose one. -->
  <div
    :class="['bio-image', { 'bio-image--selected': selected, 'bio-image--empty': !picture }]"
    data-testid="bio-image"
    :data-piece="data.piece"
    :data-empty="!picture || undefined"
    :title="data.name"
  >
    <img
      v-if="picture"
      class="bio-image__picture"
      :src="picture.data"
      :alt="data.name"
      :style="{ opacity: data.opacity ?? 1 }"
      draggable="false"
    />
    <template v-else>
      <i class="pi pi-image bio-image__icon" aria-hidden="true"></i>
      <span class="bio-image__note">{{ data.image ? 'Picture missing' : data.name }}</span>
      <!-- nodrag: a press on it is a click, not the start of a drag of the image. -->
      <button
        type="button"
        class="bio-image__choose nodrag"
        data-testid="bio-image-choose"
        @click.stop="pick(data.piece)"
      >
        Choose picture…
      </button>
    </template>
    <BioPieceResize
      v-if="data.resize && id"
      :node-id="id"
      :position="data.resize.position"
      :keep-aspect="!!picture && !!data.resize.keepAspect"
    />
  </div>
</template>

<script setup>
import { computed, inject } from 'vue'

import BioPieceResize from './BioPieceResize.vue'
import { useBioPiecesStore } from '../../stores/bioPiecesStore'

const props = defineProps({
  /** Its node id, for its resize handle. */
  id: { type: String, default: null },
  data: { type: Object, required: true },
  selected: { type: Boolean, default: false },
})

const pieces = useBioPiecesStore()
/** Its picture, from the pieces' image store; null with none yet, or none in the store by its id. */
const picture = computed(() => (props.data.image ? pieces.imageOf(props.data.image) : null))

/** The view's `(pieceId) => void`, which asks for a picture file and gives the image it. */
const pick = inject('bioImagePick', () => {})
</script>

<style scoped>
.bio-image {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
}

.bio-image__picture {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
  user-select: none;
}

.bio-image--selected {
  outline: 2px solid var(--p-primary-color);
  outline-offset: 1px;
}

.bio-image--empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1.5px dashed var(--p-text-muted-color);
  border-radius: 6px;
  background: color-mix(in srgb, var(--p-content-background) 70%, transparent);
}

.bio-image__icon {
  font-size: 20px;
  color: var(--p-text-muted-color);
}

.bio-image__note {
  max-width: 90%;
  overflow: hidden;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--p-text-muted-color);
}

.bio-image__choose {
  padding: 3px 10px;
  border: 1px solid var(--p-primary-color);
  border-radius: 4px;
  background: var(--p-content-background);
  color: var(--p-primary-color);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.bio-image__choose:hover {
  background: color-mix(in srgb, var(--p-primary-color) 10%, var(--p-content-background));
}
</style>
