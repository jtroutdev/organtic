<script setup lang="ts">
defineProps<{
  /** ok, sug, warn, bad or off. */
  tone: string;
}>();
</script>

<!-- Words only: no dot or icon. -->
<template>
  <span class="pill" :class="tone"><slot /></span>
</template>

<style scoped>
/* The tone's own class gives the text its colour; these are the fills behind it. */
.pill{display:inline-flex;align-items:center;border-radius:var(--radius-full);padding:var(--space-2xs) var(--space-sm);font:var(--font-label-md);white-space:nowrap}
.pill.ok{background:var(--color-success-soft)}
.pill.sug{background:var(--color-accent-soft)}
.pill.warn{background:var(--color-warning-soft)}
.pill.bad{background:var(--color-error-soft)}
.pill.off{background:var(--color-surface);box-shadow:inset 0 0 0 1px var(--color-outline-subtle)}
</style>
