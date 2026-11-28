<template>
  <!-- Three bars that morph into a tapering tornado while open. -->
  <svg
    class="hamburger-tornado"
    :class="{ 'hamburger-tornado--open': open, 'hamburger-tornado--right': side === 'right' }"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <line
      v-for="(y, index) in [7, 12, 17]"
      :key="y"
      :class="`hamburger-tornado__line hamburger-tornado__line--${index + 1}`"
      :x1="side === 'right' ? 20 : 4"
      :y1="y"
      :x2="side === 'right' ? 4 : 20"
      :y2="y"
      pathLength="100"
    />
  </svg>
</template>

<script setup>
defineProps({
  /** Shows the tornado; closed, the hamburger. */
  open: { type: Boolean, default: false },
  /** The edge the tornado tapers from: 'left' draws it from the left, so it narrows to the right; 'right' mirrors it. */
  side: { type: String, default: 'left' },
})
</script>

<style scoped>
/* Users size it and weight its lines through these variables, so their own rules need not out-rank these. */
.hamburger-tornado {
  width: var(--hamburger-tornado-size, 1.25rem);
  height: var(--hamburger-tornado-size, 1.25rem);
  overflow: visible;
}

/* Each line is drawn as one dash along a 0–100 path, so the dash's length and
   offset can shorten and shift it while the round caps stay round. */
.hamburger-tornado__line {
  fill: none;
  stroke: currentColor;
  stroke-width: var(--hamburger-tornado-stroke-width, 2);
  stroke-linecap: round;
  stroke-dasharray: 100 200;
  stroke-dashoffset: 0;
  transform-box: view-box;
  transform: translateX(0);
  transition:
    stroke-dasharray 260ms cubic-bezier(0.5, 0, 0.2, 1),
    stroke-dashoffset 260ms cubic-bezier(0.5, 0, 0.2, 1),
    transform 260ms cubic-bezier(0.5, 0, 0.2, 1);
}

.hamburger-tornado__line--2 {
  transition-delay: 40ms;
}

.hamburger-tornado__line--3 {
  transition-delay: 80ms;
}

/* Tornado: each line shorter than the one above, drifting away from the drawn-from
   edge (bars 16 units long, so 100 path units = 16). */
.hamburger-tornado--open .hamburger-tornado__line--1 {
  transform: translateX(-1px);
}

.hamburger-tornado--open .hamburger-tornado__line--2 {
  stroke-dasharray: 62 200;
  stroke-dashoffset: -22;
  transform: translateX(0.5px);
}

.hamburger-tornado--open .hamburger-tornado__line--3 {
  stroke-dasharray: 25 200;
  stroke-dashoffset: -50;
  transform: translateX(1.5px);
}

/* Mirrored drift for the right-hand tornado. */
.hamburger-tornado--right.hamburger-tornado--open .hamburger-tornado__line--1 {
  transform: translateX(1px);
}

.hamburger-tornado--right.hamburger-tornado--open .hamburger-tornado__line--2 {
  transform: translateX(-0.5px);
}

.hamburger-tornado--right.hamburger-tornado--open .hamburger-tornado__line--3 {
  transform: translateX(-1.5px);
}

@media (prefers-reduced-motion: reduce) {
  .hamburger-tornado__line {
    transition: none;
  }
}
</style>
