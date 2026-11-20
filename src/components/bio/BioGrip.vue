<template>
  <!-- A grip on a piece that is no node of its own: a fold's far end, a tube's end or its bend, or the far edge of a
       compartment docked along one side -->
  <div
    :class="['bio-grip', `bio-grip--${data.grip}`]"
    :title="TITLES[data.grip]"
    data-testid="bio-grip"
    :data-grip="data.grip"
    :data-piece="data.piece"
  ></div>
</template>

<script setup>
defineProps({
  data: { type: Object, required: true },
})

const TITLES = {
  fold: 'Drag to move the fold along its side, or change how deep it is',
  bend: 'Drag to bend the tube through here',
  start: 'Drag onto another compartment to join this end of the tube to it',
  end: 'Drag onto another compartment to join this end of the tube to it',
  reach: 'Drag to set how far the compartment reaches, or onto another membrane or fold to dock it there too',
}
</script>

<style scoped>
.bio-grip {
  width: 100%;
  height: 100%;
  border: 2px solid var(--p-primary-color);
  border-radius: 50%;
  background: var(--p-content-background);
  cursor: grab;
  opacity: 0.55;
  transition: opacity 0.15s;
}

.bio-grip:hover {
  opacity: 1;
}

/* A compartment's far edge: a bar along it. */
.bio-grip--reach {
  border-radius: 4px;
}

/* A tube's ends are joined to compartments: square, to tell them from its bend. */
.bio-grip--start,
.bio-grip--end {
  border-radius: 3px;
}
</style>
